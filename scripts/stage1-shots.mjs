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
  /** Колонка у левого края: легенда и график состязания не пересекаются при любых сочетаниях; скорости 1…48 ч/с. */
  async dock() {
    await replayAgents();
    await page.evaluate(() => window.__replayCard('su_1bf'));
    await page.locator('.ag-tabs button', { hasText: 'Командующий' }).click();
    await page.locator('.map-dock > .cm-chart').waitFor();
    const isOpen = (sel) => page.evaluate((q) => { const e = document.querySelector(q); return !!e && !e.classList.contains('closed'); }, sel);
    const setState = async (sel, btnSel, want) => { if ((await isOpen(sel)) !== want) { await page.locator(btnSel).click(); await page.waitForTimeout(200); } };
    const rects = () => page.evaluate(() => {
      const r = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return { lg: r('.map-dock > .legend'), ch: r('.map-dock > .cm-chart'), map: r('.rp-map') };
    });
    let bad = '';
    for (const lg of [true, false]) for (const ch of [true, false]) {
      await setState('.map-dock > .legend', '.map-dock > .legend .lg-h', lg);
      await setState('.map-dock > .cm-chart', '[data-action="map.chart"]', ch);
      const { lg: a, ch: c, map } = await rects();
      const cross = a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
      const inside = (x) => x.l >= map.l - 1 && x.r <= map.r + 1 && x.t >= map.t - 1 && x.b <= map.b + 1;
      if (cross || !inside(a) || !inside(c)) bad += ` легенда ${lg ? 'раскрыта' : 'свёрнута'}, график ${ch ? 'раскрыт' : 'свёрнут'}: ${cross ? 'пересекаются' : 'вне карты'};`;
      await shot(`dock-${lg ? 'open' : 'closed'}-${ch ? 'open' : 'closed'}.jpg`);
    }
    if (bad) return fail('dock', bad);
    ok('dock', '4 сочетания без пересечения');
    // узкое окно: график не уже 380 px, легенда и график не пересекаются
    await page.setViewportSize({ width: 1200, height: 900 });
    await setState('.map-dock > .legend', '.map-dock > .legend .lg-h', true);
    await setState('.map-dock > .cm-chart', '[data-action="map.chart"]', true);
    await page.waitForTimeout(300);
    const nr = await rects();
    const cw = nr.ch.r - nr.ch.l;
    const ncross = nr.lg.l < nr.ch.r && nr.ch.l < nr.lg.r && nr.lg.t < nr.ch.b && nr.ch.t < nr.lg.b;
    await shot('dock-narrow.jpg');
    await page.setViewportSize({ width: 1440, height: 900 });
    if (cw < 379 || ncross) return fail('dock', `окно 1200: ширина графика ${Math.round(cw)}${ncross ? ', легенда и график пересекаются' : ''}`);
    ok('dock', `окно 1200×900: график ${Math.round(cw)} px, без пересечения`);
    const speeds = () => page.locator('.player select option').allInnerTexts();
    const want_ = ['1 ч/с', '3 ч/с', '6 ч/с', '12 ч/с', '24 ч/с', '48 ч/с'];
    const inReplayList = await speeds();
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-passive"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.player select option').first().waitFor({ state: 'attached', timeout: 600000 });
    const inGame = await speeds();
    if (inReplayList.join() !== want_.join() || inGame.join() !== want_.join()) return fail('dock', `скорости: переигровка ${inReplayList}; игра ${inGame}`);
    ok('dock', 'скорости 1,3,6,12,24,48 в переигровке и в игре');
  },
};

try {
  for (const [name, fn] of Object.entries(parts)) if (want(name)) await fn().catch((e) => fail(name, String(e).split('\n')[0]));
  for (const n of ONLY ?? []) if (!parts[n] && !['dock', 'zones', 'staffs', 'orders', 'fly', 'umpire', 'bounds', 'manning'].includes(n)) fail(n, 'неизвестная часть');
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
