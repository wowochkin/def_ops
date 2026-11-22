import { test, expect } from 'playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { createService, Router } from '@def-ops/service-kit';
import type { AgentEvaluation } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import { registerExpositionRoutes } from '../../../services/kshvi/src/http/exposition-routes';
import { createTrainingExpositionService } from '../../../services/kshvi/src/exposition/training-exposition';

let vite: ViteDevServer;
let api: ReturnType<typeof createService>;
const agentCalls: string[] = [];

test.beforeAll(async () => {
  const router = new Router();
  registerExpositionRoutes(router, createTrainingExpositionService({
    async evaluateChoices(request): Promise<AgentEvaluation> {
      agentCalls.push(`${request.projection.instanceId}:${request.projection.agentId}:${request.seed}`);
      const advance = request.seed % 2n === 0n;
      return {
        selected: { id: advance ? 'advance' : 'hold', kind: advance ? 'ADVANCE' : 'HOLD', label: 'Решение агента', commandType: null },
        options: [{ id: 'choice', utility: 1 }], unknown: [], forkHashes: ['isolated'], destroyedForks: 1,
        orders: [], reports: [], trace: { purpose: 'EXPOSITION' },
      };
    },
  }));
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

test('AC-28 UI: серверные ARCHIVE/AUTONOMOUS, часы, карта, слои, checkpoints и отдельный проектор', async ({ page, browser }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) externalRequests.push(request.url());
  });

  await page.goto('http://127.0.0.1:4193/src/modern/kshvi/exposition/index.html');
  await expect(page.getByRole('heading', { name: 'Демонстрация «Рубеж»', level: 1 })).toBeVisible();
  await expect(page.getByText('Архивный показ', { exact: true }).last()).toBeVisible();
  await expect(page.getByTestId('exposition-maplibre')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
  await expect(page.getByTestId('audience-projection').locator('svg')).toHaveCount(0);
  await expect(page.getByText('Погода: Пасмурно, видимость 8 км')).toBeVisible();
  await expect(page.getByText('Местность: Лесной массив и рубеж высоты')).toBeVisible();
  await expect(page.getByText('МТО: Склад и маршрут подвоза')).toBeVisible();
  await expect(page.getByText('Батальон', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /официальн.*оцен|оцен.*обучаем/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'Запустить показ' }).click();
  await expect(page.getByRole('button', { name: 'Приостановить показ' })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId('exposition-maplibre').getAttribute('data-zoom'))).toBeGreaterThan(9);
  await page.getByRole('button', { name: 'Приостановить показ' }).click();
  await page.getByRole('button', { name: 'Ускорить ×2' }).click();
  await expect(page.getByText('Темп: 2×', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Развитие действий' }).click();
  await expect(page.getByText('Текущая глава: Развитие действий', { exact: true })).toBeVisible();
  const map = page.getByTestId('exposition-maplibre');
  await expect(map).toHaveAttribute('data-center', '30.175,50.120000000000005');
  await expect(map).toHaveAttribute('data-zoom', '10');
  await expect(map).toHaveAttribute('data-heading', '22.5');
  await page.getByRole('button', { name: 'Открыть решение' }).click();
  await expect(page.getByText('Закрытое обоснование решения')).toBeVisible();

  await page.getByRole('button', { name: 'Предпросмотр аудитории' }).click();
  await expect(page.getByText('Закрытое обоснование решения')).toHaveCount(0);
  await expect(page.getByText('Служебный замысел ведущего')).toHaveCount(0);
  await expect(page.getByText('Проекторный профиль: exposition-projector', { exact: true })).toBeVisible();
  await expect(page.getByText('Пояснение для аудитории', { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const back = page.getByRole('button', { name: 'Вернуться к ведущему' });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Запустить показ' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });

  await page.getByRole('button', { name: 'Редактор программы' }).click();
  await page.getByLabel('Погода').click();
  await expect(page.getByLabel('Погода')).not.toBeChecked();
  await page.getByRole('button', { name: 'Ведущий показ' }).click();
  await expect(page.getByText('Погода: Пасмурно, видимость 8 км')).toHaveCount(0);
  await expect(page.getByText('Местность: Лесной массив и рубеж высоты')).toBeVisible();

  await page.getByRole('button', { name: 'Автономный расчёт' }).click();
  await expect(page.getByText(/RNG: exposition-rng-v1/)).toBeVisible();
  expect(agentCalls.length).toBe(4);
  await expect(page.getByLabel('Контрольная точка')).toContainText('cp-1');
  await page.getByRole('button', { name: 'Продолжить от контрольной точки' }).click();
  await expect(page.getByText(/RNG: exposition-rng-v1/)).toBeVisible();
  expect(agentCalls.length).toBe(6);
  await page.getByRole('button', { name: 'Повторить сохранённую линию' }).click();
  await expect(page.getByText(/RNG: exposition-rng-v1/)).toBeVisible();
  expect(agentCalls.length).toBe(6);
  await page.getByRole('button', { name: 'Новая ветвь' }).click();
  await expect(page.getByText(/RNG: exposition-rng-v1/)).toBeVisible();
  expect(agentCalls.length).toBe(10);

  const sessionId = await page.getByTestId('audience-projection').getAttribute('data-session-id');
  expect(sessionId).toBeTruthy();
  const audiencePage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark', locale: 'ru-RU' });
  const audienceErrors: string[] = [];
  const audiencePayloads: string[] = [];
  audiencePage.on('pageerror', error => audienceErrors.push(error.message));
  audiencePage.on('response', response => {
    if (response.url().includes('/projector')) void response.text().then(text => audiencePayloads.push(text)).catch(() => undefined);
  });
  await audiencePage.goto(`http://127.0.0.1:4193/src/modern/kshvi/exposition/projector.html?session=${encodeURIComponent(sessionId!)}`);
  await expect(audiencePage.getByRole('heading', { name: 'Демонстрация «Рубеж»', level: 2 })).toBeVisible();
  await expect(audiencePage.locator('.maplibregl-canvas')).toBeVisible();
  await expect(audiencePage.getByText('Закрытое обоснование решения')).toHaveCount(0);
  await expect(audiencePage.getByRole('button', { name: 'Открыть решение' })).toHaveCount(0);
  await expect.poll(() => audiencePayloads.length).toBeGreaterThan(0);
  for (const payload of audiencePayloads) {
    for (const forbidden of ['sourceArchive', 'officialAssessments', 'serviceIntent', 'hiddenRationale', 'Закрытое обоснование', 'Скрытый служебный замысел']) {
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
