// Снимки пункта управления этапа 4 для описания (docs/img, окно 1440×900, JPEG) в браузере с мостом к ядру агентной
// модели (scripts/agents-bridge.mjs). Каждая часть печатает «ok <часть>: <что видно>» или «FAIL <часть>: <что>».
//
//   node scripts/stage4-shots.mjs [--url http://localhost:5173] [--out docs/img] [--only post,advisor]
//
// post — одна игра на агентной модели («История как замысел», языковой модели нет): «Решение» Ставки, составленное при
//   открытии хода, с пометками (decision-marks), «составить заново» с подтверждением (decision-replace); 1-й Белорусский
//   фронт взят — ходатайство о линии с 1-м Украинским фронтом на карте (post-petition); директива 8-й гв. армии —
//   участок прорыва из списка объектов и точка цели (post-objects), указания, составленные по задаче (post-notes);
//   «Варианты советника» по правилам, без модели — список и раскрытый вариант на карте (post-variants-map); ход —
//   журнал с ответом Ставки на ходатайство (game-directives).
// advisor — нынешняя модель, подставная языковая модель (поддельная LM Studio на /llm/): «Варианты советника» — два
//   варианта (game-advisor-plans), поле вопроса советника (advisor-input).
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
const ONLY = arg('--only', '') ? arg('--only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx, page, core;
let failed = 0;
const ok = (part, what) => console.log(`ok ${part}: ${what}`);
const fail = (part, what) => { failed++; console.log(`FAIL ${part}: ${what}`); };
const want = (part) => !ONLY || ONLY.includes(part);
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const shot = async (name) => { await page.waitForTimeout(1500); await page.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 82 }); console.log(`  снимок ${name}`); };

/** Подставная модель: варианты решения (staff_plan), ответы советника (staff_advice), прочее — пустой ответ. */
const planVariant = (title, idea, formation, area) => ({
  title, idea, assessment: 'Противник удерживает Зееловские высоты, подвоз доходит.', enemyIntent: 'Удержать высоты (предположение).',
  intent: `${formation}: главный удар на ${area}.`, risks: 'Контрудар с юга.', report: 'Войска ведут бой за Зееловские высоты, подвоз доходит.',
  orders: [{ formation, task: 'attack', area, toArea: null, why: 'главный удар' }], actions: [],
});
const PLAN = { variants: [planVariant('Удар на Зелов', 'Главный удар через Зелов.', '8-я гвардейская армия', 'Зелов'), planVariant('Удар пятой ударной', 'Главный удар правее, на Врицен.', '5-я ударная армия', 'Врицен')] };
const DECISION_DE = { assessment: 'Русские наступают на Зелов.', enemyIntent: 'Прорыв к Берлину.', intent: 'Удерживать вторую полосу.', orders: [], requests: [], risks: [], actions: [], basis: [] };
const sse = (content) => [...content.match(/[\s\S]{1,200}/g).map((c) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`),
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'].join('');

/** Новое окно и новый процесс ядра; lm — подставная модель (иначе /llm/ отвечает отказом: модели нет). */
async function open(mode, lm) {
  if (core) core.stop();
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((m) => {
    if (sessionStorage.getItem('shots.init')) return;
    sessionStorage.setItem('shots.init', '1');
    localStorage.clear();
    localStorage.setItem('def_ops.voice.intro', 'off');
    localStorage.setItem('def_ops.tour.seen', JSON.stringify(['replay', 'command', 'editor', 'maps', 'knowledge', 'modeling']));
    if (m) localStorage.setItem('def_ops.command.mode', m);
    localStorage.setItem('def_ops.mapLevel5', 'front');
    localStorage.setItem('def_ops.planVariants', '2');
  }, mode);
  await ctx.route((u) => u.pathname.startsWith('/llm/'), async (route) => {
    if (!lm) return route.fulfill({ status: 503, body: '' });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/v1/models')) return route.fulfill({ json: { object: 'list', data: [{ id: 'mock-staff', object: 'model' }] } });
    if (!url.pathname.endsWith('/v1/chat/completions')) return route.fulfill({ status: 404, body: '' });
    const body = route.request().postDataJSON();
    const schema = body.response_format?.json_schema?.name;
    const content = schema === 'staff_plan' ? JSON.stringify(PLAN) : schema === 'staff_decision' ? JSON.stringify(DECISION_DE)
      : schema === 'staff_advice' ? JSON.stringify({ answer: 'Подставной советник: контрудар вероятен с юга, от Мюнхеберга.', basis: [], unknowns: [], suggestions: [], followUps: [] })
        : schema ? '{}' : 'Подставной советник (проверка стенда): текст подставной — проверяется вёрстка, а не содержание.';
    const reply = body.stream ? { status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(content) }
      : { json: { id: 'fake', object: 'chat.completion', model: 'mock-staff', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] } };
    return route.fulfill(reply).catch(() => {});
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ошибка окна:', e.message));
  core = await attachAgentsBridge(page);
}

/** Переигровка (agents — агентная модель) с начала операции и «Взять командование» с противником enemy. */
async function startGame(agents, enemy) {
  await page.goto(`${URL_}/#replay`);
  await page.locator('.rp-form select').first().selectOption(agents ? 'agents' : 'army', { timeout: 60000 });
  await page.locator('[data-action="replay.calc"]').click();
  await page.locator('.rp-go.primary[data-action="replay.calc"]').waitFor({ timeout: 900000 });
  await page.locator('.take-btn').waitFor({ timeout: 600000 });
  await page.getByText('Условные обозначения').first().click();
  await page.locator('.player .ic[title="Назад на сутки"]').click({ clickCount: 20 });
  await page.locator('.take-btn').click();
  await page.locator('.modal.take').waitFor();
  const e = page.locator(`[data-hl="enemy-${enemy}"]`);
  if (await e.count()) await e.click();
  await page.locator('.modal.take button.primary').click();
  await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
  await page.locator('.cmd-body .cmd-sec, .cmd-body .staffs').first().waitFor({ timeout: 600000 });
}
const tab = (t) => page.locator('.cmd-tabs button', { hasText: t }).click();
const level = (t) => page.locator('.lvl-sw button', { hasText: t }).click();
const view = (center, zoom) => page.evaluate(([c, z]) => window.__cmdEngine?.setView(z ? { center: c, zoom: z } : { center: c }), [center, zoom]);
/** Щелчок по карте в точке ll. */
const at = async (ll) => {
  const [x, y] = await page.evaluate((p) => window.__cmdEngine.project(p), ll);
  const b = await page.locator('.rp-map').boundingBox();
  await page.mouse.click(b.x + x, b.y + y); await page.waitForTimeout(200);
};

const parts = {
  async post() {
    await open('intent', false);
    await startGame(true, 'intent');
    // «Решение» Ставки — составлено при открытии хода, без модели
    await level('Ставка');
    await view([14.0, 52.55]);
    await tab('Решение');
    await page.waitForTimeout(2000);
    const marks = await page.locator('.dauto').count();
    if (!marks) return fail('post', 'нет пометок «составлено по обстановке»');
    await shot('decision-marks.jpg');
    ok('post', `решение Ставки составлено при открытии хода, пометок ${marks}`);
    // «составить заново» у заполненного поля — подтверждение
    await page.locator('[data-hl="field-assessment"] .ic-btn[data-action="decision.compose"]').first().click();
    const box = page.locator('.confirm-box');
    await box.waitFor({ timeout: 10000 });
    const q = flat(await box.innerText());
    if (!/Текст будет заменён/.test(q)) return fail('post', `вопрос: ${q}`);
    await shot('decision-replace.jpg');
    await box.locator('button:not(.primary)').first().click();
    ok('post', `составить заново — «${q.slice(0, 80)}»`);

    // 1-й Белорусский фронт взят: ходатайство о линии с 1-м Украинским фронтом
    await tab('Штабы');
    await page.locator('.staffs-row:has(.staffs-btn)', { hasText: /1-й Белорусский/ }).first().locator('.staffs-btn', { hasText: 'взять' }).click();
    await level('Фронт');
    await tab('Решение');
    await page.waitForTimeout(1200);
    const pet = page.locator('[data-hl="field-request"]');
    const opts = await pet.locator('select option').allInnerTexts();
    const uf = opts.find((o) => /Украинский/.test(o));
    if (!uf) return fail('post', `соседей нет: ${opts.join(', ')}`);
    await pet.locator('select').selectOption({ label: uf });
    await view([14.35, 52.2], 9);
    await page.waitForTimeout(800);
    await pet.locator('button', { hasText: 'На карте' }).click();
    for (const p of [[14.85, 52.08], [14.45, 52.12], [14.1, 52.2]]) await at(p);
    await pet.locator('button', { hasText: 'Готово' }).click();
    await pet.locator('textarea').fill('Войска 1-го Украинского фронта вышли к нашему левому флангу у Фюрстенберга; прошу провести линию южнее, через Бесков.');
    await pet.scrollIntoViewIfNeeded();
    await shot('post-petition.jpg');
    ok('post', `ходатайство: ${flat(await pet.innerText()).slice(0, 120)}`);

    // директива 8-й гв. армии: участок прорыва — из списка, точка цели на карте
    await tab('Приказы');
    await page.locator('.subtabs button', { hasText: 'Пункт управления' }).click();
    await page.locator('.post-subs button', { hasText: '8-я гвардейская' }).click();
    const row = (t) => page.locator('.post-pts-w', { has: page.locator('.post-pts', { hasText: t }) });
    await row('Участок прорыва').locator('button', { hasText: 'из списка' }).click();
    const pk = row('Участок прорыва').locator('.post-objs');
    await pk.locator('.seg button', { hasText: 'Пункты' }).click();
    await pk.locator('input').fill('зел');
    const found = (await pk.locator('.post-objs-list .orow').allInnerTexts()).map(flat);
    await pk.locator('.post-objs-list .orow').first().click();
    // задача на глубину — список раскрыт: объекты по вкладкам, ближайшие к армии
    await row('Задача на глубину').locator('button', { hasText: 'из списка' }).click();
    await view([14.5, 52.53], 10);
    await shot('post-objects.jpg');
    ok('post', `участок прорыва из списка: ${found[0] ?? '—'}`);
    await row('Задача на глубину').locator('button', { hasText: 'из списка' }).click();
    const note = page.locator('.post-form textarea').last();
    await note.scrollIntoViewIfNeeded();
    const nt = await note.inputValue();
    if (!/Задача —/.test(nt)) return fail('post', `указания не составлены: ${nt}`);
    await shot('post-notes.jpg');
    ok('post', `указания: ${flat(nt).slice(0, 120)}`);
    await page.locator('[data-action="command.dir.cancel"]').first().click().catch(() => {});

    // «Варианты советника» по правилам, без модели: список и раскрытый вариант на карте
    await tab('Решение');
    await view([14.45, 52.5], 8.6);
    await page.locator('.plan-cta [data-action="command.variants"]').click();
    await page.locator('.plan-var').first().waitFor({ timeout: 120000 });
    const tag = flat(await page.locator('.plan-var').first().innerText());
    if (!/по правилам, без модели/.test(tag)) fail('post', `нет пометки «по правилам, без модели»: ${tag.slice(0, 160)}`);
    await page.locator('.plan-var').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('post-variants-map.jpg');
    ok('post', `вариант: ${tag.slice(0, 120)}`);

    // ход: ходатайство уходит в Ставку; её ответ — в блоке ходатайства и документом в журнале документов
    await page.evaluate(() => window.__act('command.advisor.show', { mode: 'close' }));
    const turn = await page.evaluate(() => window.__cmdView.turn);
    await page.evaluate(() => window.__act('command.post', { level: 'stavka' }));
    await page.evaluate(() => window.__act('command.turn', {}));
    await page.waitForFunction((n) => window.__cmdView?.turn > n, turn, { timeout: 900000 });
    await page.waitForTimeout(3000);
    await level('Фронт');
    await tab('Решение');
    await page.waitForTimeout(1500);
    const ans = page.locator('.pet-ans');
    if (!await ans.count()) return fail('post', `ответа Ставки в блоке ходатайства нет: ${flat(await pet.innerText()).slice(0, 300)}`);
    await view([14.45, 52.15], 9);
    await ans.scrollIntoViewIfNeeded();
    await shot('post-petition-answer.jpg');
    ok('post', `ответ: ${flat(await ans.innerText())}`);
    await tab('Штабы');
    await page.waitForTimeout(1000);
    const doc = page.locator('.staffs-docs .doc', { hasText: /Ходатайство/ }).first();
    if (await doc.count()) { await doc.scrollIntoViewIfNeeded(); await shot('game-directives.jpg'); ok('post', `документ: ${flat(await doc.innerText()).slice(0, 160)}`); }
    else return fail('post', `в журнале документов нет ответа: ${flat(await page.locator('.cmd-body').innerText()).slice(0, 300)}`);
    await tab('Журнал');
    await page.waitForTimeout(1000);
    console.log(`  в «Журнале» ответ Ставки ${/Ходатайство (?:удовлетворено|отклонено)/.test(await page.locator('.cmd-body').innerText()) ? 'есть' : 'не виден'}`);
  },

  async advisor() {
    await open(null, true);
    await startGame(false, 'llm');
    await view([14.3, 52.55]);
    await tab('Решение');
    await page.waitForTimeout(2500);
    await page.locator('.plan-cta [data-action="command.variants"]').click();
    await page.locator('.plan-var').nth(1).waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    const vs = (await page.locator('.plan-var').allInnerTexts()).map(flat);
    await page.locator('.plan-var').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('game-advisor-plans.jpg');
    ok('advisor', `вариантов ${vs.length}: ${vs.map((x) => x.slice(0, 60)).join(' | ')}`);
    await page.evaluate(() => window.__act('command.advisor.show', { mode: 'open' }));
    await page.locator('textarea[placeholder^="Свой вопрос"]').fill('Где противник может нанести контрудар?');
    await shot('advisor-input.jpg');
    ok('advisor', 'поле вопроса советника');
  },
};

try {
  for (const [k, f] of Object.entries(parts)) {
    if (!want(k)) continue;
    try { await f(); } catch (e) { fail(k, e.message.split('\n')[0]); await page?.screenshot({ path: join(ROOT, 'evals-out', `stage4-${k}-err.jpg`), type: 'jpeg', quality: 70 }).catch(() => {}); }
  }
} finally {
  core?.stop();
  await browser.close();
}
process.exit(failed ? 1 : 0);
