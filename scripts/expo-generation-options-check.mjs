// Сохранение переключателей и полный сеанс без комментариев/разбора: настоящее изолированное ядро.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const url = process.env.EXPO_URL ?? 'http://127.0.0.1:5178';
const core = agentsProcess();
const browser = await chromium.launch();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, timer: { on: false, seconds: 30 }, idleSeconds: 600, resultSeconds: 120 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  localStorage.setItem('def_ops.portable.setup.v1', '1');
  const native = window.__expoNative;
  window.__expoNative = (cmd, args) => {
    if (cmd === 'expo_settings_write' && !args.bad) localStorage.setItem('test-expo-settings', args.text);
    if (cmd === 'expo_settings_read' && localStorage.getItem('test-expo-settings')) return localStorage.getItem('test-expo-settings');
    return native(cmd, args);
  };
});
await page.route('**/api/portable/library', route => route.fulfill({ status: 404, body: '' }));
await page.route('**/api/portable/stress', route => route.fulfill({ contentType: 'application/json', body: readFileSync('apps/editor/src/expo/bank-data/stress.json', 'utf8') }));
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
await page.routeWebSocket('ws://127.0.0.1:47645/**', socket => socket.close());
const open = async () => {
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
};
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await open();
  for (const name of ['Комментарии после решений', 'Итоговый разбор']) {
    assert.equal(await page.getByRole('checkbox', { name, exact: true }).isChecked(), true);
    await page.getByRole('checkbox', { name, exact: true }).click();
    await page.waitForFunction(label => ![...document.querySelectorAll('.expo-check')].find(l => l.textContent.trim() === label)?.querySelector('input')?.checked, name);
  }
  await page.getByRole('group', { name: 'Генерация и озвучка' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/img/expo-operator.jpg', type: 'jpeg', quality: 90 });
  await page.reload();
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await open();
  for (const name of ['Комментарии после решений', 'Итоговый разбор']) assert.equal(await page.getByRole('checkbox', { name, exact: true }).isChecked(), false);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  console.log('ok независимые переключатели сохранены и пережили перезагрузку');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('button', { name: /1-й Украинский/ }).click();
  await page.getByRole('button', { name: 'Начать операцию' }).click();
  await page.getByRole('button', { name: 'К решениям' }).click();
  for (const n of [1, 2, 3]) {
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    if (n < 3) await page.waitForFunction(turn => document.querySelector('.expo-header')?.textContent.includes(`Перелом ${turn} из 3`), n + 1, { timeout: 90000 });
  }
  await page.locator('.expo[data-phase="result"]').waitFor({ timeout: 90000 });
  assert.equal(await page.getByRole('heading', { name: 'Итог расчёта' }).count(), 1);
  assert.equal(await page.getByText(/Задачи и шкалы появятся вместе с речью/).count(), 0);
  assert.equal(await page.getByText('Готовим итог', { exact: true }).count(), 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500); // Снимок после окончания перехода между сценами.
  await page.screenshot({ path: 'docs/img/expo-result-silent.jpg', type: 'jpeg', quality: 90 });
  assert.deepEqual(errors, []);
  console.log('ok три перелома завершились без комментариев/подготовки разбора; итоговые цифры показаны сразу');
} finally {
  await browser.close(); core.stop();
}
