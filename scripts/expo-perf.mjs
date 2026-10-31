// Замер быстродействия стенда: заставка и прокрутка после решения — кадры/с, длинные задачи, коммиты React на кадр.
// Сначала: cargo build --release -p agents-core --bin agents-game. Затем:
// EXPO_URL=http://localhost:5180 node scripts/expo-perf.mjs [--size 1920x1080] [--cpu 4] (замедление процессора — машина стенда слабее)
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const i = process.argv.indexOf('--size');
const [width, height] = (i > 0 ? process.argv[i + 1] : '1920x1080').split('x').map(Number);
const j = process.argv.indexOf('--cpu');
const cpu = j > 0 ? Number(process.argv[j + 1]) : 4;
const url = process.env.EXPO_URL ?? 'http://localhost:5180';
const core = agentsProcess();
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, timer: { on: false, seconds: 30 } }, viewport: { width, height } });
await page.addInitScript(() => {
  // счётчик коммитов React через крючок инструментов разработчика (его React вызывает на каждый коммит)
  const w = window;
  w.__perf = { commits: 0, long: [] };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject: () => 1, onCommitFiberRoot: () => w.__perf.commits++, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {}, checkDCE: () => {} };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__perf.long.push(e.duration))).observe({ type: 'longtask', buffered: true });
});
/** Окно замера: кадры по requestAnimationFrame, длинные задачи и коммиты за `ms`. */
const measure = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const p = window.__perf;
        const c0 = p.commits, l0 = p.long.length;
        let frames = 0, worst = 0, last = performance.now();
        const t0 = last;
        const tick = (now) => {
          frames++;
          worst = Math.max(worst, now - last);
          last = now;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else {
            const long = p.long.slice(l0);
            done({ fps: +((frames * 1000) / (now - t0)).toFixed(1), worstFrameMs: Math.round(worst), longTasks: long.length, longestMs: Math.round(Math.max(0, ...long)), commitsPerFrame: +((p.commits - c0) / frames).toFixed(2) });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const out = {};
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('heading', { name: /Приказ — за вами/ }).waitFor({ timeout: 120000 });
  // карта заставки — когда её документ собран (переигровка «как было» в ядре и воркер карты)
  await page.locator('.expo-gis [data-id]').first().waitFor({ state: 'attached', timeout: 90000 });
  await page.waitForTimeout(2000);
  out.attract = await measure(6000);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  // на выборе фронта посетитель читает карточки — пара секунд, как у человека
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /1-й Белорусский/ }).click();
  await page.waitForTimeout(500);
  out.briefing = await measure(4000);
  await page.getByRole('button', { name: 'К решениям' }).click();
  const card = page.getByRole('button', { name: 'Карточка 1', exact: true });
  await card.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.expo-card [disabled][aria-label="Карточка 1"]'), null, { timeout: 60000 });
  await card.click();
  await page.locator('.expo-reveal h3, .expo-order-reveal').first().waitFor({ timeout: 60000 });
  out.scroll = await measure(8000);
  console.log(JSON.stringify({ size: `${width}x${height}`, cpu, ...out }, null, 1));
} finally {
  await browser.close();
  core.stop();
}
