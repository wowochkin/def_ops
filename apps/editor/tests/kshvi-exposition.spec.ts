import { test, expect, type Page } from 'playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { createService } from '@def-ops/service-kit';
import type { AgentEvaluation } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { buildRouter } from '../../../services/kshvi/src/app';
import { InMemorySessionStore, SessionManager } from '../../../services/kshvi/src/auth/sessions';
import { registerExpositionRoutes } from '../../../services/kshvi/src/http/exposition-routes';
import { ExpositionSessionService } from '../../../services/kshvi/src/exposition/exposition-session-service';
import { InMemoryExpositionRepository, sealOfficialExpositionArchive } from '../../../services/kshvi/src/exposition/exposition-repository';
import { SystemAgentExpositionCalculator } from '../../../services/kshvi/src/exposition/system-agent-calculator';
import { createProjectorProfile } from '../../../services/kshvi/src/exposition/exposition-projection';

let vite: ViteDevServer;
let api: ReturnType<typeof createService>;
const agentCalls: string[] = [];
const base = 'http://127.0.0.1:4193';

async function login(page: Page, username: 'presenter' | 'projector'): Promise<void> {
  const response = await page.context().request.post(`${base}/api/kshvi/auth/login`, {
    data: { username, password: 'secret123' },
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { csrfToken: string };
  const cookie = response.headers()['set-cookie'] ?? '';
  const token = /kshvi_session=([^;]+)/.exec(cookie)?.[1];
  expect(token).toBeTruthy();
  const role = await page.context().request.post(`${base}/api/kshvi/auth/role`, {
    data: { roleId: username === 'presenter' ? 'presenter-role' : 'projector-role' },
    headers: { 'X-CSRF-Token': body.csrfToken, Authorization: `Bearer ${decodeURIComponent(token!)}` },
  });
  expect(role.status()).toBe(200);
  await page.addInitScript(csrf => sessionStorage.setItem('def_ops.kshvi.csrf', csrf), body.csrfToken);
}

test.beforeAll(async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'presenter-user', username: 'presenter', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'presenter-role', role: 'DIRECTOR', sideId: null, authorities: ['exposition:present', 'exposition:edit', 'exposition:export'] }],
  });
  await sessions.createAccount({
    userId: 'exposition-projector', username: 'projector', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'projector-role', role: 'AUDIENCE_PROJECTOR', sideId: null, authorities: ['exposition:project'] }],
  });
  const source = officialArchive();
  const map: Record<string, unknown> = { ...source.map };
  map.terrain = {
    summary: 'Лес и рубеж высоты',
    geojson: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Лесной массив', kind: 'forest' }, geometry: { type: 'Polygon', coordinates: [[[29.8, 50.1], [30.25, 50.05], [30.35, 50.35], [29.95, 50.42], [29.8, 50.1]]] } },
      { type: 'Feature', properties: { name: 'Река', kind: 'water' }, geometry: { type: 'LineString', coordinates: [[29.7, 49.8], [29.95, 50.02], [30.2, 50.25], [30.55, 50.45]] } },
    ] },
  };
  map.logistics = {
    summary: 'Склад и маршрут подвоза',
    geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Склад МТО', kind: 'depot' }, geometry: { type: 'Point', coordinates: [29.95, 49.92] } }] },
  };
  map.routes = {
    geojson: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Маршрут подвоза' },
        geometry: { type: 'LineString', coordinates: [[29.95, 49.92], [30.08, 50.02], [30.25, 50.14]] },
      }],
    },
  };
  map.modernSymbols = [{ id: 'training-battalion', label: 'Батальон', side: 'BLUE', position: [30.25, 50.14] }];
  const archive = sealOfficialExpositionArchive({ ...source, map });
  const program = { ...expositionProgram(), layers: [...expositionProgram().layers, 'routes'] as const };
  const service = new ExpositionSessionService({
    repository: new InMemoryExpositionRepository({ archive, program }),
    calculator: new SystemAgentExpositionCalculator({
      engine: {
        async evaluateChoices(request): Promise<AgentEvaluation> {
          agentCalls.push(`${request.projection.instanceId}:${request.projection.agentId}:${request.seed}`);
          const advance = request.seed % 2n === 0n;
          return {
            selected: { id: advance ? 'advance' : 'hold', kind: advance ? 'ADVANCE' : 'HOLD', label: 'Решение агента', commandType: null },
            options: [{ id: 'choice', utility: 1 }], unknown: [], forkHashes: ['isolated'], destroyedForks: 1,
            orders: [], reports: [], trace: { purpose: 'EXPOSITION' },
          };
        },
      },
      profileFor: side => ({
        ...side,
        id: side.agentId,
        version: side.profileVersion,
        source: { era: 'modern', kind: 'ASSUMPTION', reference: 'Playwright system profile', version: '1' },
        risk: 0.5, persistence: 0.5, ambition: 0.5, lossTolerance: 0.5, obedience: 0.5,
        motives: { task: 1, rival: 1, preserve: 1, noEncircle: 1, destroy: 1, hold: 1, save: 1 },
        weights: { uncertainty: 1, losses: 1, persistence: 1, obedience: 1 },
        searchDepth: 1, optionCount: 2, horizonTicks: 1, reviewCycleTicks: 1, initiative: 0.5,
        onInsufficientData: 'HOLD', minAdvanceConfidence: 0, maxAdvanceStress: 1, maxAdvanceThreat: 1,
        minSupplyFraction: 0, minMovementFactor: 0, communicationDelayTicks: 0,
      }),
    }),
    policy: createAudiencePolicy({
      id: 'playwright-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
      showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'],
      publicExplanationIds: ['explanation-public'], publicDecisionIds: [],
    }),
    projectors: [createProjectorProfile({ id: 'exposition-projector', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'routes'] })],
  });
  const router = buildRouter({ sessions });
  registerExpositionRoutes(router, { service, sessions });
  api = createService({ name: 'exposition-playwright-api', port: 0, router });
  const apiPort = await api.listen();
  vite = await createServer({
    root: resolve('apps/editor'), configFile: resolve('apps/editor/vite.config.ts'),
    server: {
      host: '127.0.0.1', port: 4193, strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') } },
    },
    logLevel: 'error',
  });
  await vite.listen();
});

test.afterAll(async () => { await vite.close(); await api.close(); });
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'ru-RU' });
test.setTimeout(60_000);

test('AC-28 UI: авторизованные ARCHIVE/AUTONOMOUS, active handoff, часы, карта и слои', async ({ page, browser }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) externalRequests.push(request.url());
  });
  await login(page, 'presenter');
  await page.goto(`${base}/src/modern/kshvi/exposition/index.html`);
  await expect(page.getByRole('heading', { name: 'Демонстрация «Рубеж»', level: 1 })).toBeVisible();
  await expect(page.getByText('Архивный показ', { exact: true }).last()).toBeVisible();
  await expect(page.getByTestId('exposition-maplibre')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
  await expect(page.getByTestId('audience-projection').locator('svg')).toHaveCount(0);
  await expect(page.getByText('Погода: Пасмурно, видимость 8 км')).toBeVisible();
  await expect(page.getByText('Местность: Лес и рубеж высоты')).toBeVisible();
  await expect(page.getByText('МТО: Склад и маршрут подвоза')).toBeVisible();
  await expect(page.getByText('Батальон', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Запустить показ' }).click();
  await expect(page.getByRole('button', { name: 'Приостановить показ' })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId('exposition-maplibre').getAttribute('data-zoom'))).toBeGreaterThan(6);
  await page.getByRole('button', { name: 'Приостановить показ' }).click();
  await page.getByRole('button', { name: 'Ускорить ×2' }).click();
  await expect(page.getByText('Темп: 2×', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Развитие действий' }).click();
  const mapView = page.getByTestId('exposition-maplibre');
  await expect(mapView).toHaveAttribute('data-center', '31,51');
  await expect(mapView).toHaveAttribute('data-zoom', '7');
  await expect(mapView).toHaveAttribute('data-heading', '45');
  await page.getByRole('button', { name: 'Открыть решение' }).click();
  await expect(page.getByText('Закрытое обоснование решения')).toBeVisible();

  await page.getByRole('button', { name: 'Предпросмотр аудитории' }).click();
  await expect(page.getByText('Закрытое обоснование решения')).toHaveCount(0);
  await expect(page.getByText('Проекторный профиль: presenter-preview', { exact: true })).toBeVisible();
  await expect(page.getByText('Пояснение для аудитории', { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const back = page.getByRole('button', { name: 'Вернуться к ведущему' });
  await back.focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });

  await page.getByRole('button', { name: 'Редактор программы' }).click();
  await page.getByLabel('Погода').click();
  await expect(page.getByLabel('Погода')).not.toBeChecked();
  await page.getByRole('button', { name: 'Ведущий показ' }).click();
  await expect(page.getByText('Погода: Пасмурно, видимость 8 км')).toHaveCount(0);

  await page.getByRole('button', { name: 'Автономный расчёт' }).click();
  await expect(page.getByText(/RNG: exposition-rng-v1/)).toBeVisible();
  expect(agentCalls.length).toBe(4);
  const audiencePage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark', locale: 'ru-RU' });
  const audienceErrors: string[] = [];
  const audiencePayloads: string[] = [];
  audiencePage.on('pageerror', error => audienceErrors.push(error.message));
  audiencePage.on('response', response => {
    if (response.url().includes('/projector')) void response.text().then(text => audiencePayloads.push(text)).catch(() => undefined);
  });
  await login(audiencePage, 'projector');
  await audiencePage.goto(`${base}/src/modern/kshvi/exposition/projector.html`);
  await expect(audiencePage.getByRole('heading', { name: 'Демонстрация «Рубеж»', level: 2 })).toBeVisible();
  const initialActiveId = await audiencePage.getByTestId('audience-projection').getAttribute('data-session-id');
  const presenterActiveId = await page.getByTestId('audience-projection').getAttribute('data-session-id');
  expect(initialActiveId).toBe(presenterActiveId);

  await page.getByRole('button', { name: 'Продолжить от контрольной точки' }).click();
  await expect(page.getByText(/RNG: exposition-rng-v1/)).toBeVisible();
  expect(agentCalls.length).toBe(6);
  await expect.poll(() => audiencePage.getByTestId('audience-projection').getAttribute('data-session-id')).not.toBe(initialActiveId);
  expect(await audiencePage.getByTestId('audience-projection').getAttribute('data-session-id'))
    .toBe(await page.getByTestId('audience-projection').getAttribute('data-session-id'));
  const continuedActiveId = await audiencePage.getByTestId('audience-projection').getAttribute('data-session-id');

  await page.getByRole('button', { name: 'Повторить сохранённую линию' }).click();
  await expect.poll(() => audiencePage.getByTestId('audience-projection').getAttribute('data-session-id')).not.toBe(continuedActiveId);
  expect(agentCalls.length).toBe(6);
  const replayActiveId = await audiencePage.getByTestId('audience-projection').getAttribute('data-session-id');
  await page.getByRole('button', { name: 'Новая ветвь' }).click();
  await expect.poll(() => audiencePage.getByTestId('audience-projection').getAttribute('data-session-id')).not.toBe(replayActiveId);
  expect(agentCalls.length).toBe(10);

  await expect(audiencePage.locator('.maplibregl-canvas')).toBeVisible();
  await expect(audiencePage.getByText('Закрытое обоснование решения')).toHaveCount(0);
  await expect.poll(() => audiencePayloads.length).toBeGreaterThan(0);
  for (const payload of audiencePayloads) {
    for (const forbidden of ['sourceArchive', 'official-assessment-1', 'serviceIntent', 'hiddenRationale', 'Закрытое обоснование', 'Скрытый служебный замысел']) {
      expect(payload).not.toContain(forbidden);
    }
  }
  expect(await audiencePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(audienceErrors).toEqual([]);
  await expect(audiencePage).toHaveScreenshot('exposition-projector-1920x1080.png', { fullPage: true, animations: 'disabled' });
  await audiencePage.close();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('AC-28 negative: проектор и аноним не открывают presenter/export/program, CSRF обязателен', async ({ page, browser }) => {
  await login(page, 'presenter');
  await page.goto(`${base}/src/modern/kshvi/exposition/index.html`);
  await expect(page.getByTestId('audience-projection')).toBeVisible();
  const sessionId = await page.getByTestId('audience-projection').getAttribute('data-session-id');
  expect(sessionId).toBeTruthy();
  const badCsrf = await page.evaluate(async id => (await fetch(`/api/kshvi/expositions/${id}/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'wrong' }, body: JSON.stringify({ type: 'PAUSE' }),
  })).status, sessionId);
  expect(badCsrf).toBe(403);

  const projector = await browser.newPage();
  await login(projector, 'projector');
  await projector.goto(`${base}/src/modern/kshvi/exposition/projector.html`);
  await expect(projector.getByTestId('audience-projection')).toBeVisible();
  const statuses = await projector.evaluate(async id => {
    const program = await (await fetch(`/api/kshvi/expositions/${id}/projector`)).json();
    return {
      presenter: (await fetch(`/api/kshvi/expositions/${id}/presenter`)).status,
      exported: (await fetch(`/api/kshvi/expositions/${id}/exports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionStorage.getItem('def_ops.kshvi.csrf') ?? '' }, body: JSON.stringify({ archiveId: 'attack' }),
      })).status,
      update: (await fetch(`/api/kshvi/expositions/${id}/program`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionStorage.getItem('def_ops.kshvi.csrf') ?? '' }, body: JSON.stringify(program),
      })).status,
    };
  }, sessionId);
  expect(statuses).toEqual({ presenter: 403, exported: 403, update: 403 });

  const anonymous = await browser.newContext();
  const anonymousStatus = await anonymous.request.get(`${base}/api/kshvi/expositions/${sessionId}/presenter`);
  expect(anonymousStatus.status()).toBe(401);
  await anonymous.close();
  await projector.close();
});
