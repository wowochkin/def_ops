// Снимки командования по ступеням (docs/img, окно 1440×900, JPEG) в браузере с мостом к ядру агентной модели
// (scripts/agents-bridge.mjs): переигровка Берлинской на агентной модели — уровни карты, окно передачи командования
// с режимом (штабы-агенты), вкладка «Штабы», форма приказа, журнал документов после хода.
//
//   node scripts/agents-shots.mjs [--url http://localhost:5173] [--out docs/img]
// Нужны: сервер разработки редактора (cd apps/editor && npx vite) и target/release/agents-game.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAgentsBridge } from './agents-bridge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://localhost:5173');
const OUT = resolve(ROOT, arg('--out', 'docs/img'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('shots.init')) return;
  sessionStorage.setItem('shots.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.intro', 'off');
  localStorage.setItem('def_ops.tour.seen', JSON.stringify(['replay', 'command', 'editor', 'maps', 'knowledge', 'modeling']));
  localStorage.setItem('def_ops.command.mode', 'agents');
  localStorage.setItem('def_ops.mapLevel', 'stavka');
});
const page = await ctx.newPage();
const core = await attachAgentsBridge(page);
const shot = async (name) => { await page.waitForTimeout(1500); await page.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 82 }); console.log(name); };
try {
  await page.goto(`${URL_}/#replay`);
  await page.locator('.rp-form select').first().selectOption('agents', { timeout: 60000 });
  await page.locator('[data-action="replay.calc"]').click();
  await page.locator('.take-btn').waitFor({ timeout: 600000 });
  // уровни карты: третьи сутки операции, Зееловские высоты; легенда свёрнута
  await page.getByText('Условные обозначения').first().click();
  const track = await page.locator('.pl-track').boundingBox();
  await page.mouse.click(track.x + track.width * 0.17, track.y + track.height / 2);
  for (const [t, f, at] of [['Ставка', 'levels-stavka.jpg', [14.3, 52.6]], ['Фронт', 'levels-front.jpg', [14.3, 52.55]], ['Армия', 'levels-army.jpg', [14.35, 52.55]], ['Дивизия', 'levels-division.jpg', [14.45, 52.55]]]) {
    await page.locator('.lvl-sw button', { hasText: t }).click();
    await page.evaluate((c) => window.__replayEngine?.setView({ center: c }), at);
    await shot(f);
  }
  // передача командования: режим
  await page.locator('.take-btn').click();
  await page.locator('.modal.take').waitFor();
  await page.locator('[data-hl="enemy-passive"]').click();
  await shot('take-mode.jpg');
  await page.locator('.modal.take button.primary').click();
  await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
  await page.locator('.cmd-body .cmd-sec, .cmd-body .staffs').first().waitFor({ timeout: 600000 });
  await page.locator('.lvl-sw button', { hasText: 'Ставка' }).click();
  await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).click();
  await shot('command-staffs.jpg');
  // форма приказа: армии — приказ (подготовленный)
  await page.locator('.cmd-tabs button', { hasText: 'Доклады' }).click();
  const card = page.locator('.ucard').filter({ has: page.locator('.ucard-n', { hasText: /^8(-я)? гв/ }) }).first();
  await card.locator('.ucard-h').click();
  await card.locator('button.link', { hasText: 'приказ' }).click();
  await page.locator('.oform').waitFor({ timeout: 30000 });
  await page.locator('.oedit select').first().selectOption('defend');
  await page.locator('.oform button', { hasText: 'Приказ' }).click();
  await shot('command-order-form.jpg');
  // решение на ход (все поля) и ход; затем журнал документов
  await page.locator('.cmd-tabs button', { hasText: 'Решение' }).click();
  for (const t of await page.locator('.cmd-body textarea').all()) await t.fill('Директивы Ставки на операцию поданы; 8 гв. армия закрепляется.');
  await page.locator('[data-action="command.turn"]').click();
  await page.locator('.cmd-date span', { hasText: 'ход 2' }).waitFor({ timeout: 900000 });
  await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).click();
  await page.locator('.staffs-docs').scrollIntoViewIfNeeded();
  await shot('command-docs.jpg');
} finally {
  core.stop();
  await browser.close();
}
