import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createService } from '@def-ops/service-kit';
import { SessionManager, InMemorySessionStore } from '../services/kshvi/src/auth/sessions.ts';
import { ensureDevelopmentAccount } from '../services/kshvi/src/auth/development-account.ts';
import { buildRouter } from '../services/kshvi/src/app.ts';
import { InMemoryExerciseStore } from '../services/kshvi/src/store/exercise-store.ts';
import { EnvironmentSnapshotStore } from '../services/kshvi/src/environment/snapshot-store.ts';
import { CartographyEnvironmentProvider } from '../services/kshvi/src/environment/cartography-provider.ts';

const origin = process.env.KSHVI_PREVIEW_URL ?? 'http://127.0.0.1:5173';
const title = 'Учебный сценарий';
const artifacts = process.env.KSHVI_SCREEN_DIR ?? 'docs/img';
process.env.HOST = '127.0.0.1';
const folder = await mkdtemp(join(tmpdir(), 'kshvi-layout-'));
let service;
let browser;
try {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await ensureDevelopmentAccount(sessions, { KSHVI_DEVELOPMENT_AUTH: '1' });
  const environment = new EnvironmentSnapshotStore(folder);
  const environmentProvider = new CartographyEnvironmentProvider({
    baseUrl: 'http://127.0.0.1:8080/api/cartography', store: environment,
  });
  service = createService({ name: 'preparation-browser', port: 0, router: buildRouter({
    sessions, environmentProvider, exerciseStore: new InMemoryExerciseStore({ environment }),
    localLogin: { userId: 'local-leader', roleId: 'local-director-role', origins: [origin] },
  }) });
  const port = await service.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
  });
  await context.route('**/api/kshvi/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname.replace(/^\/api/, '')}${url.search}` });
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
  const button = name => page.getByRole('button', { name, exact: true });
  const screenshot = async name => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, `${name}.jpg`), type: 'jpeg', quality: 88, animations: 'disabled' });
  };

  await page.goto(origin);
  await page.getByText('Локальный режим · local-leader · Руководитель учения', { exact: true }).waitFor();
  await button('Проведение').click();
  await page.getByRole('heading', { name: 'Активный сеанс не выбран' }).waitFor();
  await screenshot('kshvi-conduct-empty');
  await button('Открыть библиотеку').click();
  await button('Создать учение').click();
  await page.getByLabel('Название учения').fill(title);
  await button('Сохранить на сервере').click();
  await button(`Архивировать ${title}`).click();
  await page.getByText('Учение архивировано на сервере', { exact: true }).waitFor();
  await button('Архив').click();
  await button(`Создать рабочую копию ${title}`).click();
  await page.getByRole('heading', { name: `Копия — ${title}`, exact: true }).waitFor();
  await button('Архив').click();
  await button('Удалить из архива').click();
  assert.equal(await button('Подтвердить удаление').isEnabled(), false);
  await page.getByLabel('Повторите название').fill(title);
  await page.getByLabel('Основание удаления').fill('Повторная карточка');
  await screenshot('modern-kshvi-library-archive');
  await button('Подтвердить удаление').click();
  await page.getByRole('heading', { name: 'Архив пуст' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Архив пуст' }).waitFor();
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await service?.close();
  await rm(folder, { recursive: true, force: true });
}
