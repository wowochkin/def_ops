import { test, expect, type Page } from 'playwright/test';
import { resolve } from 'node:path';

const baseUrl = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
const exercise = {
  id: 'e1', title: 'Сквозное учение', revision: 2, state: 'SEALED', validation: 'OK', scale: 'operational', purpose: 'planned',
  ownerId: 'leader-1', startsAt: null, endsAt: null, readiness: 100, archivedAt: null, createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z', lastSessionId: null,
};
const expositionSession = {
  sessionId: 'exposition-s1', branchId: 'exposition-branch-s1', purpose: 'EXPOSITION', label: 'Экспозиция', source: 'ARCHIVE',
  playback: { status: 'PAUSED', chapterId: 'chapter-1', atMs: 0, tempo: 1 },
  program: {
    id: 'program-s1', title: 'Показ сквозного учения', chapters: [{ id: 'chapter-1', title: 'Официальный журнал', startMs: 0, endMs: 3000, frameIds: ['frame-1'], pauseAfterMs: 0 }],
    frames: [{ id: 'frame-1', atMs: 3000, title: 'Завершение', caption: 'Сеанс завершён' }],
    cameraRoute: { keyframes: [{ id: 'camera-1', atMs: 0, center: [30, 50], zoom: 6, heading: 0 }] },
    layers: ['weather', 'terrain', 'logistics', 'modern-symbols'], tempo: 1, pauseMs: 0,
    captions: [{ id: 'caption-1', atMs: 0, text: 'Официальный архив' }], explanations: [], branches: [], allowedCheckpointIds: [], planFact: [],
  },
  map: { weather: { summary: 'Снимок погоды' }, terrain: { summary: 'Снимок местности' }, logistics: { summary: 'Снимок МТО' }, modernSymbols: [] },
  journal: [], checkpoints: [], world: { scenarioId: 'e1', resources: {}, marks: [] }, officialAssessments: [], officialAssessmentCreated: false,
  sourceArchive: { manifestHash: 'b'.repeat(64) }, seed: null, randomOutcomesCreated: 0,
};
const expositionProjection = {
  sessionId: 'exposition-s1', branchId: 'exposition-branch-s1', purpose: 'EXPOSITION', label: 'Экспозиция', source: 'ARCHIVE',
  playback: expositionSession.playback, projectorProfile: { id: 'audience-1', kind: 'AUDIENCE_PROJECTOR' },
  program: expositionSession.program, map: expositionSession.map, planFact: [], decision: null,
};

async function mockApi(page: Page): Promise<void> {
  let session = { id: 's1', exerciseId: 'e1', scenarioRevisionId: 'r2', revision: 2, state: 'ACTIVE', mode: 'NETWORK', authority: 'SERVER', confirmedRevision: 0, createdBy: 'leader-1', createdAt: '2030-01-01T00:00:00Z' };
  let archived = false;
  await page.route('**/api/kshvi/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/kshvi', '');
    const method = request.method();
    const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/auth/me') return fulfill({ userId: 'leader-1', activeRole: 'LEADER', organizationId: 'org-1', authorities: ['exercise:read', 'exercise:create', 'exercise:conduct', 'exercise:archive', 'TRUTH_READ', 'archive.export', 'kshvi:admin'] });
    if (path === '/exercises') return fulfill({ items: archived ? [] : [exercise] });
    if (path === '/exercises/e1/sessions' && method === 'POST') return fulfill(session, 201);
    if (path === '/exercises/e1/sessions/s1/commands') {
      const body = request.postDataJSON() as { command: string };
      session = { ...session, state: body.command === 'PAUSE' ? 'PAUSED' : body.command === 'RESUME' ? 'ACTIVE' : 'COMPLETED', confirmedRevision: session.confirmedRevision + 1 };
      return fulfill(session);
    }
    if (path === '/exercises/e1/sessions/s1/replay') return fulfill({ sequence: 3, operationalAt: '2030-01-01T03:00:00Z', wallClockAt: '2030-01-01T09:00:00Z', perspective: 'PARTICIPANT', source: 'RECORDED_PARTICIPANT_PROJECTION', stateHash: 'a'.repeat(64), domains: { Map: { sequence: 3 }, Weather: { sequence: 3 } }, events: [{ eventId: 'event-3', type: 'time.change', sequence: 3 }], maxSequence: 3 });
    if (path === '/exercises/e1/sessions/s1/debrief') return fulfill({ scope: 'GENERAL', revision: 2, audience: ['GENERAL'], referenceIntent: 'Замысел руководства' });
    if (path === '/archives' && method === 'POST') return fulfill({ archiveId: 'archive-s1', manifestSha256: 'b'.repeat(64), mode: 'AUTONOMOUS', missing: [] }, 201);
    if (path === '/exercises/e1/archive') { archived = true; return fulfill({ ...exercise, state: 'ARCHIVED' }); }
    if (path === '/expositions/archive-s1') return fulfill({ purpose: 'EXPOSITION', session: expositionSession, projection: expositionProjection });
    if (path === '/admin/overview') return fulfill({ accounts: [], assignments: [], events: [], versions: [], datasets: [], retention: { activeDays: 30, archiveDays: 365, backupDays: 90, auditDays: 730, allowedMedia: ['encrypted-local-disk'], responsibleUserIds: ['security-1'] }, snapshot: { health: 'HEALTHY', readiness: { ready: true, reasons: [] }, generatedAt: '2030-01-01T10:00:00Z', services: { kshvi: 'UP', database: 'UP', environment: 'UP' }, connections: { active: 1, idle: 0, disconnected: 0, total: 1 }, queues: { events: 0, jobs: 0, heavyJobs: 0 }, latencyMs: { commandP95: 1, sseP95: 1, mapP95: 1 }, storage: { freeBytes: 1024, journalBytes: 128 }, backups: { status: 'VALID', lastVerifiedAt: '2030-01-01T09:00:00Z' }, clock: { serverTime: '2030-01-01T10:00:00Z', ntpSynchronized: true, offsetMs: 0 }, versions: { kshvi: '1' }, errors: [], alerts: [] } });
    return fulfill({ error: { message: `Неизвестный маршрут ${method} ${path}` } }, 404);
  });
}

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

test('единый маршрут КШВИ, соседние карта/погода и справочник знаков', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
    localStorage.setItem('def_ops.kshvi.section', 'library');
    localStorage.setItem('def_ops.modern.weather.region', '{"bounds":[1,2,3,4]}');
  });
  await page.goto(`${baseUrl}/`);
  await expect(page.getByRole('heading', { name: 'КШВИ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Создать учение' }).click();
  for (const purpose of ['planned', 'special', 'inspection', 'research', 'exposition', 'custom']) await expect(page.getByLabel('Назначение учения').locator(`option[value="${purpose}"]`)).toHaveCount(1);
  for (const scale of ['tactical', 'operational', 'strategic', 'custom']) await expect(page.getByLabel('Масштаб учения').locator(`option[value="${scale}"]`)).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить создание' }).click();

  await page.getByRole('button', { name: 'Карта и погода', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Карта и погода', exact: true })).toBeVisible();
  const mapRegion = await page.evaluate(() => localStorage.getItem('def_ops.modern.weather.region'));
  expect(mapRegion).not.toBeNull();
  await page.getByRole('button', { name: 'КШВИ', exact: true }).click();
  await page.getByRole('button', { name: 'Рабочий цикл Сквозное учение' }).click();
  await expect(page.getByRole('heading', { name: 'Подготовка официального сеанса' })).toBeVisible();
  await page.getByRole('button', { name: 'Запустить официальный сеанс' }).click();
  await expect(page.getByRole('heading', { name: 'Руководитель учения' })).toBeVisible();
  for (const [command, confirmation] of [['Пауза', 'Подтвердить: Пауза'], ['Продолжить', 'Подтвердить: Продолжить'], ['Завершение', 'Подтвердить: Завершение']]) {
    await page.getByRole('button', { name: command, exact: true }).click();
    await page.getByRole('button', { name: confirmation, exact: true }).click();
  }
  await expect(page.getByText('Фактический результат: Серверная ревизия 3: COMPLETED')).toBeVisible();
  await expect(page.locator('.kshvi-conduct-workspace')).toHaveCSS('background-color', 'rgb(13, 28, 33)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-conduct.jpg'), type: 'jpeg', quality: 88, fullPage: false });
  await page.getByRole('button', { name: 'Реплей', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизированный реплей' })).toBeVisible();
  await page.getByRole('button', { name: 'Разбор', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Общий разбор' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Оценка с доказательствами' })).toBeVisible();
  await page.getByRole('button', { name: 'Архивировать и перейти в архив' }).click();
  await expect(page.getByRole('heading', { name: 'Архив archive-s1' })).toBeVisible();
  await page.getByRole('button', { name: 'Показ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Показ сквозного учения', level: 1 })).toBeVisible();
  await expect(page.locator('.exposition-presenter')).toHaveCSS('background-color', 'rgb(11, 17, 16)');
  await expect(page.locator('.exposition-presenter-header')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-exposition.jpg'), type: 'jpeg', quality: 88, fullPage: false });
  await page.getByRole('button', { name: 'Администрирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Техническая эксплуатация' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Локальные учётные записи' })).toBeVisible();
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-admin.jpg'), type: 'jpeg', quality: 88, fullPage: false });
  await page.getByRole('button', { name: 'Условные знаки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Условные знаки' }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('def_ops.modern.weather.region'))).toBe(mapRegion);
  expect(errors).toEqual([]);
});
