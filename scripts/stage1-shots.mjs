// Проверка доработок этапа 1 в браузере с мостом к ядру агентной модели (scripts/agents-bridge.mjs): снимки в evals-out/stage1
// (окно 1440×900, JPEG) и проверки по частям. Каждая часть печатает «ok <часть>: <что проверено>» или «FAIL <часть>: <что>»;
// при любом FAIL процесс завершается с кодом 1.
//
//   node scripts/stage1-shots.mjs [--url http://localhost:5173] [--out evals-out/stage1] [--only commander,dock,…]
// Части: commander, dock, zones, staffs, orders, fly, umpire, bounds, manning.
// Нужны: сервер разработки редактора (cd apps/editor && npx vite) и target/release/agents-game.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAgentsBridge } from './agents-bridge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://localhost:5173');
const OUT = resolve(ROOT, arg('--out', 'evals-out/stage1'));
const ONLY = arg('--only', '') ? arg('--only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
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
  localStorage.setItem('def_ops.mapLevel5', 'stavka');
  localStorage.setItem('def_ops.agents.command', 'commanders');
});
const page = await ctx.newPage();
await attachAgentsBridge(page);
const shot = async (name) => { await page.waitForTimeout(800); await page.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 82 }); };
let failed = 0;
const ok = (part, what) => console.log(`ok ${part}: ${what}`);
const fail = (part, what) => { failed++; console.log(`FAIL ${part}: ${what}`); };
const want = (part) => !ONLY || ONLY.includes(part);

/** Переигровка на агентной модели: рассчитать и дождаться кнопки «Взять командование». */
async function replayAgents() {
  await page.goto(`${URL_}/#replay`);
  await page.locator('[data-action="replay.calc"]').click();
  await page.locator('.rp-go.primary[data-action="replay.calc"]').waitFor({ timeout: 900000 });
  await page.locator('.take-btn').waitFor({ timeout: 600000 });
}

const parts = {
  /** Вкладка «Командующий» не дрожит: ширины колонок картины неизменны при проигрывании по часу. */
  async commander() {
    await replayAgents();
    await page.evaluate(() => window.__replayCard('su_1bf'));
    await page.locator('.ag-tabs button', { hasText: 'Командующий' }).click();
    await page.locator('.cm-pic th').first().waitFor();
    const widths = () => page.evaluate(() => [...document.querySelectorAll('.cm-pic th')].map((e) => Math.round(e.getBoundingClientRect().width * 100) / 100));
    const first = await widths();
    await shot('commander-before.jpg');
    const slider = page.locator('.pl-track input[type=range]');
    for (let k = 0; k < 12; k++) {
      await slider.evaluate((el) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(+el.value + 1));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(150);
      const w = await widths();
      if (w.length !== first.length || w.some((x, i) => x !== first[i])) return fail('commander', `ширины колонок изменились на ${k + 1}-м часе: ${first} → ${w}`);
    }
    const text = await page.locator('.cm-pic').innerText();
    if (/задержка \d+[.,]\d/.test(text)) return fail('commander', `дробь в задержке: ${text}`);
    await shot('commander-after.jpg');
    ok('commander', 'ширины колонок неизменны за 12 ч');
  },
};

try {
  for (const [name, fn] of Object.entries(parts)) if (want(name)) await fn().catch((e) => fail(name, String(e).split('\n')[0]));
  for (const n of ONLY ?? []) if (!parts[n] && !['dock', 'zones', 'staffs', 'orders', 'fly', 'umpire', 'bounds', 'manning'].includes(n)) fail(n, 'неизвестная часть');
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
