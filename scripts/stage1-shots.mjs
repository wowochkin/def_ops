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
  /** Полосы армий в «Истории как замысле»: в часы 24/72/144 линии армий — действующие полосы ядра, дивизии армии не дальше 5 км за ними. */
  async bounds() {
    await page.goto(`${URL_}/`);
    await page.evaluate(() => localStorage.setItem('def_ops.agents.command', 'intent'));
    await replayAgents();
    await page.locator('.lvl-sw button', { hasText: 'Фронт' }).click();
    const slider = page.locator('.pl-track input[type=range]');
    for (const H of [24, 72, 144]) {
      await slider.evaluate((el, h) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(h));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, H);
      await page.waitForTimeout(500);
      const r = await page.evaluate((H) => {
        const { doc, time, trace } = window.__replayBounds();
        if (!trace) return { err: 'нет хода агентной модели' };
        const at = (h) => new Date(Date.parse(`${trace.start}:00Z`) + h * 3600000).toISOString().slice(0, 16);
        const t = at(H);
        const lines = doc.features.filter((f) => f.layerId === 'lvl-op-bounds' && f.name?.startsWith('Полоса ') && f.time && f.time.from <= t && (f.time.to === null || f.time.to > t));
        const hq = new Map(trace.hqs.map((h) => [h.id, h]));
        const armyOf = (id) => { for (let k = id, n = 0; k && n < 8; k = hq.get(k)?.parent, n++) if (hq.get(k)?.echelon === 'army') return k; return null; };
        const F = (k) => trace.fields.indexOf(k);
        const [iLng, iLat, iSt] = [F('lng'), F('lat'), F('state')];
        const lat0 = 52.5, KX = 111.32 * Math.cos(lat0 * Math.PI / 180), KY = 110.57;
        const xy = (p) => [p[0] * KX, p[1] * KY];
        const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[i], [bx, by] = poly[j]; if ((ay > p[1]) !== (by > p[1]) && p[0] < ax + (p[1] - ay) * (bx - ax) / (by - ay)) c = !c; } return c; };
        const seg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy); };
        const out = (p, poly) => inside(p, poly) ? 0 : Math.min(...poly.map((a, i) => seg(p, a, poly[(i + 1) % poly.length])));
        const res = [];
        const polys = new Map();
        for (const a of new Set(lines.map((f) => f.ref))) {
          const left = lines.find((f) => f.ref === a && f.name.includes('левая')), right = lines.find((f) => f.ref === a && f.name.includes('правая'));
          if (left && right && hq.get(a)?.side === 'su') polys.set(a, [...left.points, ...[...right.points].reverse()].map(xy));
        }
        for (const [a, poly] of polys) {
          // подчинение в ходе — на конец прогона: дивизия за своей полосой, но в полосе другой армии — переподчинена по ходу
          let n = 0, far = 0, worst = 0, other = 0;
          trace.frames[H].forEach((row, k) => {
            const d = trace.divisions[k];
            if (armyOf(d.hq) !== a || /^(не введена|сведена|небоеспособна)/.test(String(row[iSt]))) return;
            n++;
            const p = xy([row[iLng], row[iLat]]);
            const km = out(p, poly);
            if (km > 5 && [...polys].some(([b, q]) => b !== a && out(p, q) <= 5)) { other++; return; }
            worst = Math.max(worst, km);
            if (km > 5) far++;
          });
          if (n) res.push({ a, n, far, other, worst: Math.round(worst * 10) / 10 });
        }
        // вид — на советские войска этого часа
        const su = trace.frames[H].filter((row, k) => trace.divisions[k].side === 'su' && !/^(не введена|сведена|небоеспособна)/.test(String(row[iSt])));
        const c = [su.reduce((x, r) => x + r[iLng], 0) / su.length, su.reduce((x, r) => x + r[iLat], 0) / su.length];
        const v = window.__replayEngine.getView();
        if (!window.__boundsZoom) window.__boundsZoom = v.zoom - 0.4;
        window.__replayEngine.setView({ center: c, zoom: window.__boundsZoom });
        return { time: time?.slice(0, 16), t, res, sovietArmies: trace.hqs.filter((h) => h.side === 'su' && h.echelon === 'army').length };
      }, H);
      if (r.err) return fail('bounds', r.err);
      await shot(`bounds-h${H}.jpg`);
      const bad = r.res.filter((x) => x.far > 0);
      console.log(`  час ${H} (${r.time}): армий с полосами ${r.res.length} из ${r.sovietArmies}; ` + r.res.map((x) => `${x.a} ${x.n - x.far - x.other}/${x.n}${x.worst > 0 ? ` (до ${x.worst} км)` : ''}${x.other ? `, в полосе другой армии ${x.other}` : ''}`).join(', '));
      if (r.time !== r.t) fail('bounds', `час ${H}: ползунок на ${r.time}, а не ${r.t}`);
      else if (r.res.length < 10) fail('bounds', `час ${H}: полос армий на карте ${r.res.length}`);
      else if (bad.length) fail('bounds', `час ${H}: за полосой дальше 5 км — ${bad.map((x) => `${x.a} ${x.far} из ${x.n} (до ${x.worst} км)`).join(', ')}`);
      else ok('bounds', `час ${H}`);
    }
    // игра в «истории как замысле»: взят 1-й Белорусский фронт, после двух ходов (24 ч) линии армий фронта доходят до их войск
    await page.evaluate(() => localStorage.setItem('def_ops.command.mode', 'intent'));
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-intent"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).waitFor({ timeout: 600000 });
    const at = async (id, params) => String(await page.evaluate(([i, p]) => window.__act(i, p), [id, params]));
    const taken = await at('command.take', { name: '1-й Белорусский фронт' });
    if (!/взять под управление/.test(taken)) return fail('bounds', `игра: фронт не взят: ${taken}`);
    const t0 = await page.evaluate(() => window.__cmdView.time);
    for (let k = 0; k < 2; k++) {
      const turn = await page.evaluate(() => window.__cmdView.turn);
      // ход — по решению верхней инстанции: пункт управления — Ставка
      await at('command.post', { level: 'stavka' });
      await page.locator('.cmd-tabs button', { hasText: 'Решение' }).click();
      await page.waitForTimeout(500);
      for (const f of ['assessment', 'intent', 'report']) { const ta = page.locator(`[data-hl="field-${f}"] textarea`); await ta.fill(`Проверка полос армий, ход ${k + 1}.`); await ta.blur(); }
      await page.waitForTimeout(500);
      const turned = await at('command.turn', {});
      if (/не готово|Не указана/.test(turned)) return fail('bounds', `игра: ход ${k + 1} не начат: ${turned}`);
      await page.waitForFunction((n) => window.__cmdView?.turn > n, turn, { timeout: 900000 });
      await page.waitForTimeout(1500);
    }
    const g = await page.evaluate(() => {
      const v = window.__cmdView, t = v.time.slice(0, 16);
      const lines = v.doc.features.filter((f) => f.layerId === 'lvl-op-bounds' && f.name?.startsWith('Полоса ') && f.time && f.time.from <= t && (f.time.to === null || f.time.to > t));
      const by = new Map(v.own.map((u) => [u.id, u]));
      const inFront = (id) => { for (let k = id, n = 0; k && n < 8; k = by.get(k)?.parent ?? null, n++) if (k === 'su_1bf') return true; return false; };
      const armyOf = (id) => { for (let k = by.get(id)?.parent, n = 0; k && n < 8; k = by.get(k)?.parent, n++) if (by.get(k)?.echelon === 'army') return k; return null; };
      const lat0 = 52.5, KX = 111.32 * Math.cos(lat0 * Math.PI / 180), KY = 110.57;
      const xy = (p) => [p[0] * KX, p[1] * KY];
      const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[i], [bx, by_] = poly[j]; if ((ay > p[1]) !== (by_ > p[1]) && p[0] < ax + (p[1] - ay) * (bx - ax) / (by_ - ay)) c = !c; } return c; };
      const seg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy); };
      const out = (p, poly) => inside(p, poly) ? 0 : Math.min(...poly.map((a, i) => seg(p, a, poly[(i + 1) % poly.length])));
      const armies = v.own.filter((u) => u.echelon === 'army' && u.status === 'active' && inFront(u.id)).map((u) => u.id);
      const res = armies.map((a) => {
        const left = lines.find((f) => f.ref === a && f.name.includes('левая')), right = lines.find((f) => f.ref === a && f.name.includes('правая'));
        const divs = v.own.filter((u) => u.echelon === 'division' && u.status === 'active' && armyOf(u.id) === a);
        if (!left || !right) return { a, n: divs.length, none: true };
        const poly = [...left.points, ...[...right.points].reverse()].map(xy);
        const km = divs.map((u) => out(xy(u.at), poly));
        return { a, n: divs.length, far: km.filter((x) => x > 5).length, worst: Math.round(Math.max(0, ...km) * 10) / 10 };
      });
      const su = v.own.filter((u) => u.echelon === 'division' && u.status === 'active' && armies.includes(armyOf(u.id)));
      if (su.length) window.__cmdEngine.setView({ center: [su.reduce((x, u) => x + u.at[0], 0) / su.length, su.reduce((x, u) => x + u.at[1], 0) / su.length] });
      const ech = {}; for (const u of v.own) ech[`${u.echelon}/${u.status}`] = (ech[`${u.echelon}/${u.status}`] ?? 0) + 1;
      return { time: t, res, info: `${JSON.stringify(ech)}; фронты: ${v.own.filter((u) => u.echelon === 'front').map((u) => u.id).join(',')}; линий полос: ${lines.length}` };
    });
    await page.locator('.lvl-sw button', { hasText: 'Фронт' }).click({ timeout: 3000 }).catch(() => {});
    await shot('bounds-game.jpg');
    const hours = (Date.parse(`${g.time}:00Z`) - Date.parse(`${t0.slice(0, 16)}:00Z`)) / 3600000;
    console.log(`  игра ${g.time} (+${hours} ч): ` + g.res.map((x) => x.none ? `${x.a} без полосы (${x.n} див.)` : `${x.a} ${x.n - x.far}/${x.n}${x.worst > 0 ? ` (до ${x.worst} км)` : ''}`).join(', '));
    const badG = g.res.filter((x) => x.n > 0 && (x.none || x.far > 0));
    if (hours < 24) fail('bounds', `игра: прошло ${hours} ч`);
    else if (!g.res.length) fail('bounds', `игра: армий фронта нет (${g.info})`);
    else if (badG.length) fail('bounds', `игра: ${badG.map((x) => x.none ? `${x.a} без полосы` : `${x.a} ${x.far} из ${x.n} дальше 5 км (до ${x.worst} км)`).join(', ')}`);
    else ok('bounds', `игра: +${hours} ч, армий 1-го Белорусского фронта ${g.res.length}, войска в своих полосах`);
  },
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
  /** Зоны влияния в «Переигровке»: слой в «Слоях», строки легенды, подкраска на карте; выбор помнится после перезагрузки. */
  async zones() {
    await replayAgents();
    await page.locator('.lvl-sw button', { hasText: 'Фронт' }).click();
    for (let k = 0; k < 4; k++) { await page.locator('.player .ic[title="Вперёд на сутки"]').click(); await page.waitForTimeout(200); }
    await page.locator('.lyr-menu > .pop-btn').click();
    const row = page.locator('.lyr-row', { hasText: 'Зоны влияния сторон' });
    const box = row.locator('input');
    if (!(await box.isChecked())) return fail('zones', 'в «Слоях» зоны не включены');
    await page.keyboard.press('Escape');
    const legend = await page.locator('.legend').innerText();
    if (!/зона влияния советских войск/.test(legend) || !/зона влияния немецких войск/.test(legend)) return fail('zones', `в легенде нет строк зон: ${legend.replace(/\n/g, ' | ')}`);
    const z4 = await page.evaluate(() => window.__replayZones?.());
    if (!(z4?.neg > 0)) return fail('zones', `в текущем кадре нет клеток противника (отрицательных): ${z4?.neg}`);
    await page.locator('.player .ic[title="Вперёд на сутки"]').click();
    await page.waitForTimeout(300);
    const z5 = await page.evaluate(() => window.__replayZones?.());
    if (z5.key === z4.key) return fail('zones', 'при шаге на сутки наложение зон не сменилось');
    await page.locator('.player .ic[title="Назад на сутки"]').click();
    await page.waitForTimeout(300);
    await shot('replay-zones.jpg');
    ok('zones', 'слой и легенда');
    await page.locator('.lyr-menu > .pop-btn').click();
    await row.locator('input').uncheck();
    await page.keyboard.press('Escape');
    await replayAgents();
    await page.locator('.lyr-menu > .pop-btn').click();
    if (await page.locator('.lyr-row', { hasText: 'Зоны влияния сторон' }).locator('input').isChecked()) return fail('zones', 'после перезагрузки флажок снова включён');
    ok('zones', 'выбор помнится');
  },
  /** «Штабы»: кнопки раздельны; на пункте 8 гв. А — только её поддерево и директивы фронта; «показать все» открывает остальные. */
  async staffs() {
    await page.goto(`${URL_}/#replay`);
    await page.evaluate(() => localStorage.setItem('def_ops.command.mode', 'intent'));
    await replayAgents();
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-intent"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).waitFor({ timeout: 600000 });
    // штаб, ведомый директивами: директива Ставки 2-му Белорусскому фронту уходит в ядро с ходом, после хода у фронта «ведёте директивами»
    const at = async (id, params) => String(await page.evaluate(([i, p]) => window.__act(i, p), [id, params]));
    await at('command.post', { level: 'stavka' });
    const opened = await at('command.dir.open', { name: '2-й Белорусский фронт' });
    if (!/2-й Белорусский/.test(opened)) return fail('staffs', `документ не открыт: ${opened}`);
    await at('command.dir.edit', { task: 'attack' });
    await at('command.dir.set', { point: [13.4, 52.5] });
    const given = await at('command.dir.give', {});
    if (!/Уйдёт с ходом/.test(given)) return fail('staffs', `директива не отдана: ${given}`);
    await page.locator('.cmd-tabs button', { hasText: 'Решение' }).click();
    for (const k of ['assessment', 'intent', 'report']) await page.locator(`[data-hl="field-${k}"] textarea`).fill('Проверка вкладки «Штабы».');
    const turned = await at('command.turn', {});
    if (/не готово|Не указана/.test(turned)) return fail('staffs', `ход не начат: ${turned}`);
    await page.locator('text=/ход 2/').first().waitFor({ timeout: 900000 });
    await page.waitForTimeout(1500);
    const posted = await at('command.post', { name: 'su_8gva' });
    if (!/8-я гвардейская/.test(posted)) return fail('staffs', `пункт не выбран: ${posted}`);
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).click();
    await page.locator('.staffs-acts').first().waitFor();
    const rows = await page.locator('.cmd-sec.staffs section', { hasText: 'Штабы' }).first().locator('.staffs-row b').allInnerTexts();
    if (/Украинск/.test(rows.join('|'))) return fail('staffs', `в списке чужой фронт: ${rows}`);
    const docsOpts = await page.locator('select[data-action="command.docs.hq"] option').allInnerTexts();
    if (docsOpts.some((t) => /Украинск/.test(t))) return fail('staffs', `в выборе документов чужой фронт: ${docsOpts}`);
    const docs = await page.locator('.staffs-docs .doc').allInnerTexts();
    const bad = docs.filter((t) => !/8|гв\.|ск|Белорус|фронт|Ставк/i.test(t));
    if (bad.length) return fail('staffs', `в журнале чужие документы: ${bad.slice(0, 2).join(' / ')}`);
    await page.locator('.cmd-sec.staffs section', { hasText: 'Штабы' }).first().scrollIntoViewIfNeeded();
    await page.locator('.cmd-sec.staffs h4', { hasText: /^Штабы$/ }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await shot('command-staffs.jpg');
    ok('staffs', `только поддерево 8 гв. А (штабов: ${rows.length}, документов: ${docs.length})`);
    await page.locator('[data-action="command.staffs.all"]').first().click();
    await page.waitForTimeout(300);
    const rows2 = await page.locator('.cmd-sec.staffs section', { hasText: 'Штабы' }).first().locator('.staffs-row b').allInnerTexts();
    if (rows2.length <= rows.length || !rows2.some((t) => /Украинск/.test(t))) return fail('staffs', `после «показать все» штабов ${rows2.length} (было ${rows.length})`);
    ok('staffs', `показать все (штабов: ${rows2.length})`);
    // строка штаба, ведомого директивами, — в списке «все»
    const gap = await page.evaluate(() => {
      let cloned = null;
      let warn = false;
      let row = [...document.querySelectorAll('.staffs-acts')].find((e) => e.querySelectorAll('button').length >= 2);
      if (!row) {
        row = document.querySelector('.staffs-acts');
        warn = true;
        if (!row || !row.querySelector('button')) return null;
        cloned = row.appendChild(row.querySelector('button').cloneNode(true));
      }
      const bs = [...row.querySelectorAll('button')];
      const [a, b] = bs.map((e) => e.getBoundingClientRect());
      const border = getComputedStyle(bs[0]).borderTopWidth;
      cloned?.remove();
      return { warn, gap: border === '0px' ? -1 : Math.round((b.left - a.right) * 10) / 10 };
    });
    if (gap === null) return fail('staffs', 'нет строки штаба с кнопками');
    if (gap.warn) console.log('WARN staffs: нет строки с двумя кнопками, проверка на клонированной кнопке');
    if (gap.gap < 4) return fail('staffs', `промежуток между кнопками ${gap.gap} px (-1: нет рамки)`);
    ok('staffs', `кнопки раздельны (промежуток ${gap.gap} px)`);
  },
  /** «Приказы»: подвкладки по уровню совпадают с таблицей доступности (ordersSubs); скрытая открытая подвкладка → «Пункт управления». */
  async orders() {
    await page.goto(`${URL_}/#replay`);
    await page.evaluate(() => localStorage.setItem('def_ops.command.mode', 'intent'));
    await replayAgents();
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-intent"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).waitFor({ timeout: 600000 });
    const at = async (id, params) => String(await page.evaluate(([i, p]) => window.__act(i, p), [id, params]));
    const TITLE = { units: 'Пункт управления', rear: 'Тыл', bridges: 'Переправы', reserves: 'Резервы', bounds: 'Полосы' };
    const corps = await page.evaluate(() => Object.entries(window.__cmdView.command.hqs).find(([, h]) => h.echelon === 'corps')?.[0]);
    if (!corps) return fail('orders', 'нет корпуса: ' + await page.evaluate(() => JSON.stringify(Object.values(window.__cmdView.command.hqs).slice(0, 12).map((h) => [h.name, h.echelon, h.side]))));
    const levels = [['stavka', null, 'orders-stavka.jpg'], ['front', null, 'orders-front.jpg'], ['corps', corps, 'orders-corps.jpg']];
    let bad = 0;
    for (const [level, name, file] of levels) {
      await at('command.post', name ? { level, name } : { level });
      await page.locator('.cmd-tabs button', { hasText: 'Приказы' }).click();
      await page.waitForTimeout(500);
      const got = (await page.locator('.subtabs button').allInnerTexts()).map((t) => t.replace(/\s*·.*$/, '').trim());
      const want_ = await page.evaluate(async ([lv]) => {
        const m = await import('/src/post-staff.ts');
        const v = window.__cmdView;
        const issuer = document.querySelector('select[data-action="command.post"]')?.value;
        const iss = issuer && v.command.hqs[issuer] ? issuer : Object.keys(v.command.hqs).find((id) => v.command.hqs[id].echelon === { stavka: 'high_command', front: 'front', corps: 'corps' }[lv]);
        return m.ordersSubs(v, m.staffScope(v, lv, iss));
      }, [level]);
      const exp = Object.entries(want_).filter(([, x]) => x === true).map(([k]) => TITLE[k]);
      if (got.join('|') !== exp.join('|')) { bad++; fail('orders', `${level}: вкладки [${got}] ≠ таблица [${exp}]`); }
      if (level !== 'stavka') await shot(file);
    }
    if (!bad) ok('orders', 'подвкладки совпадают с таблицей на 3 уровнях');
    // открытая подвкладка скрывается при смене уровня
    await at('command.post', { level: 'front' });
    await page.locator('.cmd-tabs button', { hasText: 'Приказы' }).click();
    await page.locator('.subtabs button', { hasText: 'Тыл' }).click();
    await at('command.post', { level: 'corps', name: corps });
    await page.waitForTimeout(500);
    const on = (await page.locator('.subtabs button.on').allInnerTexts()).map((t) => t.replace(/\s*·.*$/, '').trim());
    if (on.join('|') !== 'Пункт управления') return fail('orders', `после смены уровня открыто: [${on}]`);
    const said = await at('command.orders.sub', { sub: 'rear' });
    if (!/на этом уровне нет/.test(said)) return fail('orders', `голос не объяснил: ${said}`);
    ok('orders', 'скрытая подвкладка → Пункт управления');
  },
  /** Карта переезжает к штабу: из списка пункта, из «Штабов» и при открытии карточки штаба в «Переигровке». */
  async fly() {
    await page.goto(`${URL_}/#replay`);
    await page.evaluate(() => localStorage.setItem('def_ops.command.mode', 'intent'));
    await replayAgents();
    // «Переигровка»: карточка фронта — масштаб ступени (1:500 000)
    const denom = () => page.evaluate(() => {
      const v = window.__replayEngine?.getView?.() ?? window.__cmdEngine.getView();
      return Math.round(40075016.686 * Math.cos((v.center[1] * Math.PI) / 180) / (512 * 2 ** v.zoom * 0.00028));
    });
    const c0 = await page.evaluate(() => window.__replayEngine.getView().center);
    await page.evaluate(() => window.__replayCard('su_1bf'));
    await page.waitForTimeout(2000);
    const dr = await denom();
    const c1 = await page.evaluate(() => window.__replayEngine.getView().center);
    await shot('fly-replay-front.jpg');
    if (Math.abs(dr / 500000 - 1) > 0.05) fail('fly', `карточка фронта в переигровке: масштаб 1:${dr}`);
    else if (c0[0] === c1[0] && c0[1] === c1[1]) fail('fly', 'карточка фронта в переигровке: центр не сменился');
    else ok('fly', `карточка фронта в переигровке (1:${dr})`);
    await page.evaluate(() => window.__replayCard(null));
    // игра
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-intent"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).waitFor({ timeout: 600000 });
    const at = async (id, params) => String(await page.evaluate(([i, p]) => window.__act(i, p), [id, params]));
    const state = (id) => page.evaluate(async (hq) => {
      const m = await import('/src/post-views.ts');
      const v = window.__cmdView, e = window.__cmdEngine.getView();
      const c = m.hqCenter(v, hq);
      const R = 6371, rad = Math.PI / 180;
      const km = c ? Math.hypot((e.center[0] - c[0]) * rad * R * Math.cos(c[1] * rad), (e.center[1] - c[1]) * rad * R) : null;
      return { km, center: e.center, denom: Math.round(40075016.686 * Math.cos(e.center[1] * rad) / (512 * 2 ** e.zoom * 0.00028)) };
    }, id);
    await at('command.post', { level: 'stavka' });
    await page.waitForTimeout(1500);
    const before = await state('su_8gva');
    await at('command.post', { name: 'su_8gva' });
    await page.waitForTimeout(1800);
    const a = await state('su_8gva');
    await shot('fly-army.jpg');
    if (a.km === null || a.km > 15) fail('fly', `пункт → 8 гв. А: центр в ${a.km?.toFixed(1)} км от войск`);
    else if (Math.abs(a.denom / 200000 - 1) > 0.1) fail('fly', `пункт → 8 гв. А: масштаб 1:${a.denom}`);
    else ok('fly', `пункт → 8 гв. А (${a.km.toFixed(1)} км от войск, 1:${a.denom}; было ${before.km?.toFixed(0)} км)`);
    // щелчок по знаку на карте (fly: false) — карта не едет
    const ctr = (await state('su_8gva')).center;
    await at('command.post', { level: 'stavka' });
    await page.waitForTimeout(1500);
    const st0 = (await state('su_8gva')).center;
    await at('command.post', { name: 'su_8gva', fly: false });
    await page.waitForTimeout(1800);
    const st1 = (await state('su_8gva')).center;
    if (Math.abs(st1[0] - st0[0]) > 0.01 || Math.abs(st1[1] - st0[1]) > 0.01) fail('fly', `fly:false: карта поехала ${st0} → ${st1}`);
    else ok('fly', 'щелчок по знаку (fly: false) — карта на месте');
    void ctr;
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).click();
    await at('command.staffs.all', { on: true });
    await page.locator('.staffs-go', { hasText: '5-я ударная армия' }).first().click();
    await page.waitForTimeout(1800);
    const id5 = await page.evaluate(() => Object.entries(window.__cmdView.command.hqs).find(([, h]) => /5-я ударная/.test(h.name))?.[0]);
    const b = await state(id5);
    if (b.km === null || b.km > 15 || (b.center[0] === a.center[0] && b.center[1] === a.center[1])) fail('fly', `«Штабы» → 5 уд. А: ${b.km?.toFixed(1)} км, центр ${b.center}`);
    else ok('fly', `«Штабы» → 5 уд. А (${b.km.toFixed(1)} км от войск, 1:${b.denom})`);
  },
  /** «Посредник» на агентной модели («история как замысел»): переключателя посредника на модели нет; действия противника — в журнале посредника, в «Журнале» — только видимое разведке. */
  async umpire() {
    await page.goto(`${URL_}/#replay`);
    await page.evaluate(() => localStorage.setItem('def_ops.command.mode', 'intent'));
    await replayAgents();
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-intent"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).waitFor({ timeout: 600000 });
    const at = async (id, params) => String(await page.evaluate(([i, p]) => window.__act(i, p), [id, params]));
    await at('command.post', { level: 'stavka' });
    await page.locator('.cmd-tabs button', { hasText: 'Решение' }).click();
    for (const k of ['assessment', 'intent', 'report']) await page.locator(`[data-hl="field-${k}"] textarea`).fill('Проверка журнала посредника.');
    const turned = await at('command.turn', {});
    if (/не готово|Не указана/.test(turned)) return fail('umpire', `ход не начат: ${turned}`);
    await page.locator('text=/ход 2/').first().waitFor({ timeout: 900000 });
    await page.waitForTimeout(1500);
    await page.locator('.cmd-tabs button', { hasText: 'Посредник' }).click();
    await at('command.umpire.part', { part: 'enemy' });
    await page.waitForTimeout(500);
    const sw = await page.locator('.umpire-cfg ~ label.switch', { hasText: 'Посредник на модели' }).count();
    const why = await page.locator('.umpire-off').allInnerTexts();
    if (sw || !why.some((t) => /агентной модели бои считает ядро/.test(t))) return fail('umpire', `переключатель: ${sw}, пояснение: ${why}`);
    ok('umpire', 'переключателя нет на агентной');
    const all = (await page.locator('.cmd-sec .jenemy li').allInnerTexts()).map((t) => t.trim());
    const de = all.filter((t) => /·/.test(t));
    if (!all.length || !de.length) return fail('umpire', `журнал посредника: записей ${all.length}, документов штабов ${de.length}; ${await page.evaluate(() => JSON.stringify({ n: window.__cmdView.enemyLog?.length, j: window.__cmdView.journal.map((d) => d.enemy?.length), e: window.__cmdView.engine }))}`);
    await page.locator('.umpire-seg').scrollIntoViewIfNeeded();
    await shot('umpire-intent.jpg');
    ok('umpire', `противник в журнале посредника (записей ${all.length}, документов ${de.length})`);
    await page.locator('.cmd-tabs button', { hasText: 'Журнал' }).click();
    await page.locator('.jday').first().waitFor();
    const vis = (await page.locator('.jday').first().locator('.jenemy li').allInnerTexts()).map((t) => t.trim());
    const hasSec = await page.locator('.jday').first().locator('.jsub', { hasText: 'Противник (по разведке)' }).count();
    if (!hasSec) return fail('umpire', 'в журнале нет раздела «Противник (по разведке)»');
    // документы штабов, решения, запросы и ответы — только посреднику
    if (vis.some((t) => /·|запрос на отход|отход разрешён|в отходе отказано/.test(t))) return fail('umpire', `в журнале игрока ненаблюдаемое: ${vis.filter((t) => /·|запрос|отход разрешён|отказано/.test(t)).slice(0, 2).join(' / ')}`);
    // журнал = наблюдаемые записи хода о дивизиях из разведсводки (приказ — по видимым получателям)
    const check = await page.evaluate(async () => {
      const m = await import('/src/sim/agents-game.ts');
      const v = window.__cmdView;
      const seen = new Set(v.intel.map((x) => x.id));
      const day = v.journal.at(-1), turnFrom = day.time.slice(0, 16);
      const log = (v.enemyLog ?? []).filter((e) => e.time.slice(0, 16) > turnFrom);
      const want = log.map((e) => m.enemyPlayerText(e, seen)).filter((x) => x !== null);
      return { same: JSON.stringify(want) === JSON.stringify(day.enemy ?? []), shown: want.length, hidden: log.length - want.length, intel: seen.size, got: (day.enemy ?? []).slice(0, 2), want: want.slice(0, 2) };
    });
    if (!check.same) return fail('umpire', `журнал не совпал с наблюдаемым: ${JSON.stringify(check)}`);
    await page.locator('.jday').first().locator('.jsub', { hasText: 'Противник (по разведке)' }).scrollIntoViewIfNeeded();
    await shot('journal-enemy.jpg');
    ok('umpire', `журнал — только видимое (показано ${check.shown}, скрыто ${check.hidden}, обнаружено разведкой ${check.intel})`);
  },
  /** Укомплектованность в игре на агентной модели: «Доклады» пункта фронта — у армий «… % от штата, … % от начала операции», от штата заметно ниже; щелчок по карточке армии не меняет пункт; голос «доложи обстановку» — с «от штата». */
  async manning() {
    await page.goto(`${URL_}/`);
    await page.evaluate(() => localStorage.setItem('def_ops.agents.command', 'commanders'));
    await replayAgents();
    await page.locator('.take-btn').click();
    await page.locator('.modal.take').waitFor();
    await page.locator('[data-hl="enemy-intent"]').click();
    await page.locator('.modal.take button.primary').click();
    await page.locator('.cmd-tabs').waitFor({ timeout: 600000 });
    await page.locator('.cmd-tabs button', { hasText: 'Штабы' }).waitFor({ timeout: 600000 });
    const at = async (id, params) => String(await page.evaluate(([i, p]) => window.__act(i, p), [id, params]));
    await at('command.post', { name: 'su_1bf' });
    await page.waitForTimeout(1500);
    await page.locator('.cmd-tabs button', { hasText: 'Доклады' }).click();
    await page.locator('.cmd-sec .ucard').first().waitFor({ timeout: 60000 });
    const cards = await page.locator('.cmd-sec .ucard').evaluateAll((l) => l.map((e) => e.getAttribute('data-hl')));
    if (!cards.includes('unit-su_8gva')) { await shot('manning-reports.jpg'); return fail('manning', `в «Докладах» нет 8 гв. А: ${cards.join(', ')}`); }
    // подпись полосы укомплектованности в карточке армии — оба мерила
    const txt = (await page.locator('.cmd-sec .ucard[data-hl="unit-su_8gva"] .ucard-bars .bar').first().getAttribute('title')) ?? '';
    const m = /(\d+) % от штата, (\d+) % от начала операции/.exec(txt);
    const kpi = await page.locator('.cmd-sec .kpis').first().innerText();
    await shot('manning-reports.jpg');
    if (!m) return fail('manning', `у 8 гв. А нет двух мерил: ${txt}`);
    if (+m[1] >= 90 || +m[1] >= +m[2] - 20) return fail('manning', `от штата ${m[1]} % не ниже заметно, чем от начала ${m[2]} %`);
    if (!/от штата/.test(kpi)) return fail('manning', `сводка без «от штата»: ${kpi.replace(/\s+/g, ' ')}`);
    ok('manning', `доклады — от штата и от начала (8 гв. А: ${m[1]} % от штата, ${m[2]} % от начала; сводка: ${kpi.replace(/\s+/g, ' ')})`);
    // карточка 8 гв. А на пункте фронта: доклад раскрыт, карта едет к армии, пункт — прежний (1 БФ)
    const c0 = await page.evaluate(() => window.__cmdEngine.getView().center);
    await page.locator('.cmd-sec .ucard[data-hl="unit-su_8gva"] .ucard-h').click();
    await page.waitForTimeout(2000);
    const head = await page.locator('.cmd-sec h3').first().innerText();
    const open = page.locator('.cmd-sec .ucard.open[data-hl="unit-su_8gva"]');
    const opened = await open.count();
    const sost = opened ? await open.innerText() : '';
    const c1 = await page.evaluate(() => window.__cmdEngine.getView().center);
    await shot('manning-card.jpg');
    if (!/1-й Белорусский фронт/.test(head)) return fail('manning', `щелчок по карточке 8 гв. А сменил пункт: ${head}`);
    if (!opened || !/Состав\s*\d+ % от штата, \d+ % от начала операции/.test(sost)) return fail('manning', `карточка 8 гв. А не раскрыта или без двух мерил: ${sost.replace(/\s+/g, ' ').slice(0, 160)}`);
    if (c0[0] === c1[0] && c0[1] === c1[1]) return fail('manning', 'карточка 8 гв. А: карта не переехала');
    ok('manning', `карточка 8 гв. А — пункт прежний (${head.split(' к ')[0]}), карта переехала, «Состав» — оба мерила`);
    const said = await at('command.report', {});
    if (!/от штата/.test(said)) return fail('manning', `голос без «от штата»: ${said.slice(0, 200)}`);
    ok('manning', `голос — от штата (${(/средняя укомплектованность[^;.]*/.exec(said) ?? [''])[0]})`);
  },
};

try {
  for (const [name, fn] of Object.entries(parts)) if (want(name)) await fn().catch((e) => fail(name, String(e).split('\n').slice(0, 3).join(' ')));
  for (const n of ONLY ?? []) if (!parts[n] && !['dock', 'zones', 'staffs', 'orders', 'fly', 'umpire', 'bounds'].includes(n)) fail(n, 'неизвестная часть');
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
