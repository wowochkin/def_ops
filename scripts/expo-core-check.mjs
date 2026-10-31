// Проверка каркаса с настоящим процессом Rust; оконные команды Tauri заменены одноконным стендом проверки.
// Сначала: cargo build --release -p agents-core --bin agents-game. Затем EXPO_URL=… node scripts/expo-core-check.mjs
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const core = agentsProcess();
const browser = await chromium.launch();
const calls = [];
const cfg = { ...EXPO_CFG, aiMode: 'ai', input: 'touch' };
const page = await expoPage(browser, { core, cfg, calls, voice: 'off', voiceMs: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${process.env.EXPO_URL ?? 'http://localhost:5173'}/?expo=0`);
  await page.locator('.expo-startup').waitFor();
  await page.screenshot({ path: 'docs/img/expo-startup.jpg', type: 'jpeg', quality: 85 });
  await page.getByRole('heading', { name: /Приказ — за вами/ }).waitFor({ timeout: 120000 });
  if (!calls.includes('game_start') || !calls.includes('game_stop')) throw Error('Нет пробного запуска ядра');
  // сеанс с настоящим ядром: три перелома 1-го Белорусского, прокрутки и итог по осям
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('button', { name: /1-й Белорусский/ }).click();
  await page.getByRole('button', { name: 'К решениям' }).click();
  const shot = (name) => page.screenshot({ path: `docs/img/${name}.jpg`, type: 'jpeg', quality: 85 });
  for (const n of [1, 2, 3]) {
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 60000 });
    await page.locator('.expo-card-main strong').first().filter({ hasNotText: 'Карточка готовится' }).waitFor({ timeout: 60000 });
    if (n === 1) {
      // «Спросить ИИ» без модели: готовый ответ с источником — в полосе «Штаб ИИ» под картой
      await page.getByRole('button', { name: 'Спросить ИИ' }).click();
      await page.getByRole('menuitem', { name: 'Какой вариант лучше?' }).click();
      await page.locator('.expo-subs .expo-source').waitFor({ timeout: 10000 });
      await shot('expo-ask');
    }
    await page.getByRole('button', { name: `Карточка ${n === 2 ? 2 : 1}`, exact: true }).click();
    await page.locator('.expo-reveal h3').waitFor({ timeout: 60000 });
    if (n === 2) {
      await page.waitForTimeout(3000);
      await shot('expo-scroll');
    }
  }
  await page.locator('.expo-rank').waitFor({ timeout: 60000 });
  await shot('expo-result');
  const rank = await page.locator('.expo-rank').innerText();
  const forecast = await page.locator('.expo-paper-head').innerText();
  if (!calls.includes('game_turn')) throw Error('Нет хода ядра');
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Время выбора, с: больше' }).click();
  await page.waitForTimeout(200);
  if (await page.getByRole('alert').count()) throw Error(await page.getByRole('alert').innerText());
  if (!calls.includes('expo_settings_write')) throw Error('В резервном режиме не сохранились настройки');
  console.log(JSON.stringify({ ok: true, rank, forecast, coreCalls: [...new Set(calls.filter((c) => !c.startsWith('expo')))], errors }));
  if (errors.length) process.exitCode = 1;
} catch (e) {
  await page.screenshot({ path: '/tmp/expo-core-check-fail.jpg', type: 'jpeg', quality: 70 }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  core.stop();
}
