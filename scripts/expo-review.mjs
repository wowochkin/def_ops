// Обзор сцен стенда при заданном окне: снимки каждой сцены и проверка вёрстки (обрезанный или вылезший текст).
// Сначала: cargo build --release -p agents-core --bin agents-game. Затем:
// EXPO_URL=http://localhost:5180 node scripts/expo-review.mjs --size 1024x660 --out /tmp/expo-review
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const [width, height] = arg('size', '1024x660').split('x').map(Number);
const out = arg('out', '/tmp/expo-review');
const url = process.env.EXPO_URL ?? 'http://localhost:5180';
mkdirSync(out, { recursive: true });
const core = agentsProcess();
const browser = await chromium.launch();
const report = [];
const errors = [];

/** Обрезанный текст (рамка с прокруткой или скрытием), вылезший за родителя и за край холста. */
const audit = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector('.expo')?.getBoundingClientRect();
    const area = document.querySelector('.expo-content')?.getBoundingClientRect();
    const name = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}«${(el.textContent ?? '').trim().slice(0, 30)}»`;
    const bad = [];
    for (const el of document.querySelectorAll('.expo *')) {
      if (el.closest('svg') || el.closest('.expo-sr') || el.closest('.expo-film') || el.closest('.expo-gis') || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2) bad.push(`не влезает по высоте: ${name(el)} ${el.scrollHeight}>${el.clientHeight}`);
      if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 2) bad.push(`не влезает по ширине: ${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
      const r = el.getBoundingClientRect(), pr = el.parentElement?.getBoundingClientRect();
      if (pr && el.parentElement.closest('.expo') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && (r.bottom > pr.bottom + 3 || r.right > pr.right + 3))
        bad.push(`вылезает из ${name(el.parentElement)}: ${name(el)}`);
      if (area && el.closest('.expo-content') && r.height > 0 && r.bottom > area.bottom + 2) bad.push(`ниже области сцены: ${name(el)}`);
      if (stage && (r.right > stage.right + 1 || r.bottom > stage.bottom + 1 || r.left < stage.left - 1 || r.top < stage.top - 1)) bad.push(`за холстом: ${name(el)}`);
    }
    return [...new Set(bad)];
  });

async function run({ cfg, front, scenes, tag = '' }) {
  const page = await expoPage(browser, { core, cfg, viewport: { width, height }, voiceMs: scenes.includes('startup') ? 8000 : 0, firstOnly: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = async (name, settle = 900) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${name}${tag}.jpg`, type: 'jpeg', quality: 85 });
    report.push({ scene: `${name}${tag}`, issues: await audit(page) });
  };
  const ready = () => page.locator('.expo-card-main strong').first().filter({ hasNotText: 'Карточка готовится' }).waitFor({ timeout: 60000 });
  await page.goto(`${url}/?expo=0`);
  if (scenes.includes('startup')) {
    await page.locator('.expo-startup').waitFor();
    await shot('01-startup', 0);
  }
  await page.getByRole('heading', { name: /Приказ — за вами/ }).waitFor({ timeout: 120000 });
  // карта заставки — после переигровки «как было» в ядре и сборки её документа
  await page.locator('.expo-gis svg').first().waitFor({ state: 'attached', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (scenes.includes('attract')) await shot('02-attract');
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor();
  if (scenes.includes('welcome')) await shot('03-welcome');
  await page.getByRole('button', { name: new RegExp(front) }).click();
  await page.getByRole('img', { name: 'Обстановка к 16 апреля 1945' }).waitFor();
  await page.waitForTimeout(scenes.includes('motion') ? 4500 : 500);
  await shot('04-briefing');
  await page.getByRole('button', { name: 'К решениям' }).click();
  await page.locator('.expo-roles').waitFor();
  await page.waitForTimeout(1500);
  await shot('05-explain');
  await ready();
  await shot('06-choose');
  if (cfg.input !== 'touch') {
    await page.locator('.expo-card').nth(1).hover();
    await page.waitForTimeout(1800);
    await shot('07-choose-hover');
  }
  await page.getByRole('button', { name: 'Подробнее о карточке 2' }).click();
  await page.waitForTimeout(1800);
  await shot('08-choose-expanded');
  await page.getByRole('button', { name: 'Свернуть' }).click();
  if (!scenes.includes('session')) return page.context().close();
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await shot('15-operator');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Спросить ИИ' }).click();
  await shot('09-ask-menu');
  await page.getByRole('menuitem', { name: 'Какие силы участвуют?' }).click();
  await page.locator('.expo-subs .expo-source').waitFor({ timeout: 15000 });
  await shot('10-ask-answer');
  await page.getByRole('button', { name: 'Карточка 2', exact: true }).click();
  await page.locator('.expo-reveal h3').waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot('11-scroll');
  await page.waitForTimeout(6000);
  await shot('12-scroll-end');
  for (const n of [2, 3]) {
    await ready();
    if (n === 3) await shot('13-choose-turn3');
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).click();
  }
  await page.locator('.expo-rank').waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  await shot('14-result');
  await page.context().close();
}

try {
  await run({ cfg: { ...EXPO_CFG, timer: { on: true, seconds: 90 } }, front: '1-й Белорусский', scenes: ['startup', 'attract', 'welcome', 'motion', 'session'] });
  await run({ cfg: { ...EXPO_CFG, input: 'touch', timer: { on: false, seconds: 30 } }, front: '1-й Украинский', scenes: [], tag: '-1uf-touch-notimer' });
} finally {
  await browser.close();
  core.stop();
}
for (const r of report) console.log(`${r.issues.length ? 'FAIL' : 'ok  '} ${r.scene}${r.issues.length ? '\n   ' + r.issues.join('\n   ') : ''}`);
console.log(JSON.stringify({ ok: !errors.length && report.every((r) => !r.issues.length), errors }));
