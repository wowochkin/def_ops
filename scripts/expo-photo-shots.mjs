// Снимки архивных фотографий: отдельный процесс ядра, живой сеанс посетителя не используется.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';

const url = process.env.EXPO_URL ?? 'http://127.0.0.1:5179';
const core = agentsProcess(), browser = await chromium.launch();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, idleSeconds: 600, timer: { on: false, seconds: 30 } }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem('def_ops.portable.setup.v1', '1'));
await page.route('**/api/portable/library', route => route.fulfill({ status: 404, body: '' }));
await page.route('**/api/portable/stress', route => route.fulfill({ status: 404, body: '' }));
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
const shot = async (name, selector) => {
  await page.locator(selector).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(selector => [...document.querySelectorAll(`${selector} img`)].every(img => img.complete && img.naturalWidth), selector);
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(document.querySelector('.expo-header').getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  await page.screenshot({ path: `docs/img/${name}.jpg`, type: 'jpeg', quality: 90 });
  console.log(`ok снимок docs/img/${name}.jpg`);
};
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await page.locator('.expo-gis [data-id]').first().waitFor({ state: 'attached', timeout: 90000 });
  await page.waitForTimeout(300);
  await shot('expo-attract', '.expo-reel');
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('button', { name: /1-й Белорусский/ }).click();
  await page.getByRole('button', { name: 'Начать операцию' }).click();
  await page.locator('.expo[data-phase="briefing"]').waitFor();
  await page.evaluate(() => dispatchEvent(new CustomEvent('expo-lens', { detail: { count: 3, window: 0 } })));
  await shot('expo-brief-photo', '.expo-brief-photo');
  await page.evaluate(() => dispatchEvent(new CustomEvent('expo-lens', { detail: { count: 3, window: 2 } })));
  await shot('expo-note-photo', '.expo-note-photo');
  await page.evaluate(() => dispatchEvent(new CustomEvent('expo-lens', { detail: { count: 2, window: 1 } })));
  await shot('expo-brief-pair-photo', '.expo-brief-pair .expo-note-photo');
  assert.deepEqual(errors, [], 'Ошибки страницы');
} catch (error) {
  await page.screenshot({ path: '/tmp/expo-photo-shots-fail.jpg', type: 'jpeg', quality: 90 });
  throw error;
} finally { await browser.close(); core.stop(); }
