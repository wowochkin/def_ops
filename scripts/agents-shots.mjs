// Снимки командования по ступеням (docs/img, окно 1440×900, JPEG) в браузере с мостом к ядру агентной модели
// (scripts/agents-bridge.mjs): переигровка Берлинской на агентной модели — уровни карты, окно передачи командования
// с режимом (штабы-агенты), вкладка «Штабы», пункт управления Ставки и армии, журнал документов после хода.
//
//   node scripts/agents-shots.mjs [--url http://localhost:5173] [--out docs/img] [--doc]
// --doc — и снимки уровней карты на нынешней модели и на агентной для описания (replay-*.jpg).
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
/** Вперёд на n суток от начала операции (кнопка «Вперёд на сутки»). */
const day = async (n) => {
  await page.locator('.player .ic[title="Назад на сутки"]').click({ clickCount: 20 });
  for (let k = 0; k < n; k++) await page.locator('.player .ic[title="Вперёд на сутки"]').click();
};
const level = async (t, at) => { await page.locator('.lvl-sw button', { hasText: t }).click(); await page.evaluate((c) => window.__replayEngine?.setView({ center: c }), at); };
try {
  await page.goto(`${URL_}/#replay`);
  if (process.argv.includes('--doc')) {
    // уровни карты на нынешней модели (Берлинская, итог пяти прогонов): дивизия и фронт — 23.04, Ставка — 20 и 25.04
    await page.locator('[data-action="replay.calc"]').click();
    await page.locator('.rp-go.primary[data-action="replay.calc"]').waitFor({ timeout: 900000 });
    await page.locator('.take-btn').waitFor({ timeout: 600000 });
    await page.getByText('Условные обозначения').first().click();
    await day(7);
    // дивизии — обзорно, мельче интервала уровня: рядом с переключателем — «масштаб вне …»
    await level('Дивизия', [13.85, 52.5]); await page.evaluate(() => window.__replayEngine?.setView({ zoom: 9.4 })); await shot('replay-tactical.jpg');
    await level('Фронт', [13.7, 52.5]); await shot('replay-operational.jpg');
    await level('Армия', [13.7, 52.5]); await shot('replay-army.jpg');
    await day(4); await level('Ставка', [13.9, 52.55]); await shot('replay-strategic.jpg');
    await day(9); await level('Ставка', [13.7, 52.55]); await shot('replay-strategic-late.jpg');
  }
  await page.locator('.rp-form select').first().selectOption('agents', { timeout: 60000 });
  await page.locator('[data-action="replay.calc"]').click();
  // расчёт закончен — кнопка «Рассчитать» снова на месте
  await page.locator('.rp-go.primary[data-action="replay.calc"]').waitFor({ timeout: 900000 });
  await page.locator('.take-btn').waitFor({ timeout: 600000 });
  // легенда свёрнута (на нынешней модели — уже)
  if (!process.argv.includes('--doc')) await page.getByText('Условные обозначения').first().click();
  if (process.argv.includes('--doc')) { await day(4); await level('Фронт', [14.0, 52.45]); await shot('replay-agents.jpg'); }
  // уровни карты: третьи сутки операции, Зееловские высоты
  const track = await page.locator('.pl-track').boundingBox();
  await page.mouse.click(track.x + track.width * 0.17, track.y + track.height / 2);
  for (const [t, f, at] of [['Армия', 'levels-army.jpg', [14.35, 52.55]]]) {
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
  // пункт управления Ставки: директива 1-му Белорусскому фронту — ось главного удара и рубеж ближайшей задачи на карте
  const at = async (ll) => { const [x, y] = await page.evaluate((p) => window.__cmdEngine.project(p), ll); const b = await page.locator('.rp-map').boundingBox(); await page.mouse.click(b.x + x, b.y + y); await page.waitForTimeout(150); };
  await page.locator('.lvl-sw button', { hasText: 'Ставка' }).click();
  await page.evaluate(() => window.__cmdEngine?.setView({ center: [14.0, 52.55] }));
  await page.locator('.cmd-tabs button', { hasText: 'Приказы' }).click();
  await page.locator('.subtabs button', { hasText: 'Пункт управления' }).click();
  await page.locator('.post-subs button', { hasText: '1-й Белорусский' }).click();
  await page.locator('.post-pts', { hasText: 'Главный удар' }).locator('button', { hasText: 'на карте' }).click();
  for (const p of [[14.55, 52.6], [14.1, 52.55], [13.45, 52.52]]) await at(p);
  await page.locator('.post-pts', { hasText: 'Главный удар' }).locator('button', { hasText: 'Готово' }).click();
  await page.locator('.post-pts', { hasText: 'Ближайшая' }).locator('button', { hasText: 'на карте' }).click();
  for (const p of [[14.05, 52.75], [14.0, 52.55], [14.05, 52.35]]) await at(p);
  await page.locator('.post-pts', { hasText: 'Ближайшая' }).locator('button', { hasText: 'Готово' }).click();
  await page.locator('.post-chk label', { hasText: '8' }).first().locator('input').check();
  await page.locator('.post-form textarea').fill('Овладеть рубежом Врицен — Мюнхеберг, далее на Берлин');
  await shot('command-post-stavka.jpg');
  await page.locator('[data-action="command.dir.give"]').click();
  // пункт управления армии: 8-я гв. армия взята — боевой приказ корпусу
  await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).click();
  await page.locator('.staffs-row', { hasText: '8-я гвардейская' }).first().locator('button', { hasText: 'взять' }).click();
  await page.locator('.cmd-tabs button', { hasText: 'Приказы' }).click();
  await page.evaluate(() => window.__cmdEngine?.setView({ center: [14.4, 52.55] }));
  const corps = page.locator('.post-subs button').first();
  await corps.click();
  await page.locator('.post-form .seg button', { hasText: 'Второй эшелон' }).click();
  await page.locator('.post-pts', { hasText: 'Ближайшая' }).locator('button', { hasText: 'на карте' }).click();
  for (const p of [[14.42, 52.62], [14.38, 52.55]]) await at(p);
  await page.locator('.post-pts', { hasText: 'Ближайшая' }).locator('button', { hasText: 'Готово' }).click();
  await shot('command-post-army.jpg');
  await page.locator('[data-action="command.dir.give"]').click();
  // решение на ход (все поля) и ход; затем журнал документов
  await page.locator('.cmd-tabs button', { hasText: 'Решение' }).click();
  for (const t of await page.locator('.cmd-body textarea').all()) await t.fill('Директивы Ставки на операцию поданы; 8 гв. армия закрепляется.');
  await page.locator('[data-action="command.turn"]').click();
  await page.locator('.cmd-date span', { hasText: 'ход 2' }).waitFor({ timeout: 900000 });
  // донесения за ход: исполненные команды управления и отказы
  await page.locator('.cmd-tabs button', { hasText: 'Доклады' }).click();
  for (const t of await page.locator('.dispatch li').allInnerTexts()) if (/Управление|не исполнена|не принят/.test(t)) console.log('  донесение:', t);
  await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).click();
  await page.locator('.staffs-docs').scrollIntoViewIfNeeded();
  await shot('command-docs.jpg');
} finally {
  core.stop();
  await browser.close();
}
