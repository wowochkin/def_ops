/**
 * Командующие в интерфейсе (чистые функции, без React): выбор командующего штаба, его состояние на час, ряды для
 * графика состязания и разговор. Разговор — без языковой модели: ответ собирается из записанного разбора на выбранный
 * час (варианты, оценки, обстановка, мотивы); оценка противника против истины не раскрывается — командующий не знает
 * истины, серая строка «как было на самом деле» в карточке — пояснение для зрителя, не часть разговора.
 */
import type { AgentCommander, AgentTrace } from '@def-ops/sim';
import { agentGroup } from './formation-card';
import { intentAt, NO_INTENT } from './intent-view';

export type Snapshot = AgentCommander['snapshots'][number];
export type Decision = AgentCommander['decisions'][number];

export const MOTIVE_RU: Record<string, string> = {
  task: 'выполнить задачу старшего', rival: 'опередить соперника', preserve: 'сохранить войска', noEncircle: 'не допустить окружения',
  destroy: 'разгромить противника', hold: 'удержать рубеж', save: 'спасти армию',
};
/** Порядок и подписи полос характера. */
export const TRAIT_RU: [keyof AgentCommander['traits'], string][] = [
  ['risk', 'риск'], ['persistence', 'настойчивость'], ['ambition', 'честолюбие'], ['lossTolerance', 'терпимость к потерям'], ['obedience', 'послушание старшему'],
];
/** Цвета мотивов (переменные редактора; порядок — как в MOTIVE_RU). */
export const MOTIVE_COLOR: Record<string, string> = {
  task: '#b3261e', rival: '#d97706', preserve: '#0f766e', noEncircle: '#2563eb', destroy: '#7c3aed', hold: '#6b7280', save: '#be185d',
};

export const SUGGESTIONS = ['почему так решил?', 'что знал о противнике?', 'что думал о соседе?', 'почему не выбрал другой вариант?', 'чего хочешь сейчас?', 'как оцениваешь положение?', 'почему не как в истории?'];
export const NO_DECISIONS = 'Я ещё не принимал решений к этому часу.';
export const NO_ANSWER = 'Об этом мне нечего сказать: спросите о решении, противнике, соседе или моих целях.';

/** Командующий штаба hq в ходе; нет командующих или штаб без командующего — null. */
export function commanderOf(trace: AgentTrace, hq: string): AgentCommander | null {
  return trace.commanders?.find((c) => c.hq === hq) ?? null;
}

/** Снимок и решения командующего на час: последние не позже tick. */
export function viewAt(c: AgentCommander, tick: number): { snapshot: Snapshot | null; decision: Decision | null; decisions: Decision[] } {
  let snapshot: Snapshot | null = null;
  for (const s of c.snapshots) if (s.tick <= tick && (!snapshot || s.tick >= snapshot.tick)) snapshot = s;
  const decisions = c.decisions.filter((d) => d.tick <= tick);
  return { snapshot, decision: decisions[decisions.length - 1] ?? null, decisions };
}

/** Выбранный и лучший из прочих вариантов решения. */
export const chosenOf = (d: Decision) => d.options[d.chosen];

/** Действующий замысел к часу: выбранный вариант последнего решения, кроме «продолжать по плану» — оно замысел не
 * сбрасывает (так же в ядре); решений нет — null, были только «продолжать» — последнее из них. */
export function intentOf(decisions: Decision[]): Decision['options'][number] | null {
  for (let i = decisions.length - 1; i >= 0; i--) { const o = chosenOf(decisions[i]); if (o && o.kind !== 'continue') return o; }
  const last = decisions[decisions.length - 1];
  return last ? chosenOf(last) ?? null : null;
}

const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const n1 = (x: number) => x.toFixed(1).replace('.', ',');
const km0 = (x: number) => Math.round(x).toLocaleString('ru-RU');

/** Ряд состязания: расстояние фронта до объекта по снимкам и метки его решений. Немцы — только метки. */
export interface RivalrySeries { hq: string; name: string; points: [number, number][]; marks: { tick: number; label: string }[] }
/** Немецкие командующие, чьи решения отмечены на графике: «держать / отходить» 9-й армии. */
const GERMAN_MARKS: Record<string, (kind: string, prev: string | null) => boolean> = {
  de_9a: (k, prev) => (k === 'hold' || k === 'withdraw') && k !== prev,
};
/** Армия-деблокатор на графике: метки — приказы верхней инстанции (de_hc) «выручить», где она выручает или выручаемая. */
const RELIEF_ARMY = 'de_12a';
const HIGH_HQ = 'de_hc';
export function rivalrySeries(trace: AgentTrace): RivalrySeries[] {
  const out: RivalrySeries[] = [];
  for (const c of trace.commanders ?? []) {
    if (c.side === 'su' && c.objective) {
      const points = c.snapshots.filter((s) => s.picture.toObjectiveKm != null).map((s) => [s.tick, s.picture.toObjectiveKm as number] as [number, number]);
      const marks: RivalrySeries['marks'] = [];
      for (const d of c.decisions) {
        const o = chosenOf(d);
        if (!o || o.kind === 'continue' || o.kind === 'waitMobile') continue;
        if (marks.length && marks[marks.length - 1].label === o.label) continue;
        marks.push({ tick: d.tick, label: o.label });
      }
      out.push({ hq: c.hq, name: c.name, points, marks });
    } else if (c.hq === RELIEF_ARMY) {
      const marks: RivalrySeries['marks'] = [];
      for (const d of trace.commanders?.find((x) => x.hq === HIGH_HQ)?.decisions ?? []) {
        const o = chosenOf(d);
        if (o?.kind === 'relief' && (o.by === RELIEF_ARMY || o.army === RELIEF_ARMY)) marks.push({ tick: d.tick, label: o.label });
      }
      out.push({ hq: c.hq, name: c.name, points: [], marks });
    } else if (GERMAN_MARKS[c.hq]) {
      const marks: RivalrySeries['marks'] = [];
      let prev: string | null = null;
      for (const d of c.decisions) {
        const o = chosenOf(d);
        if (!o) continue;
        if (GERMAN_MARKS[c.hq](o.kind, prev)) marks.push({ tick: d.tick, label: o.label });
        prev = o.kind;
      }
      out.push({ hq: c.hq, name: c.name, points: [], marks });
    }
  }
  return out;
}

/** Настроение словами по порогам: уверенность > 0,65 — «уверен», < 0,35 — «неуверен»; напряжение > 0,65 — «под сильным давлением». */
export function moodWords(m: { confidence: number; stress: number }): string {
  const c = m.confidence > 0.65 ? 'уверен' : m.confidence < 0.35 ? 'неуверен' : 'уверенность средняя';
  const s = m.stress > 0.65 ? 'под сильным давлением' : m.stress < 0.35 ? 'давления почти нет' : 'напряжение умеренное';
  return `${c}, ${s}`;
}

/** Что изменилось с прошлого снимка: продвижение, потери, фланги, окружения. */
function drivers(cur: Snapshot, prev: Snapshot | null): string[] {
  if (!prev) return [];
  const a = cur.picture.armies, b = prev.picture.armies;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : 0);
  const out: string[] = [];
  const adv = avg(a.map((x) => x.advanceKm)) - avg(b.map((x) => x.advanceKm));
  if (adv >= 1) out.push(`армии продвинулись в среднем на ${n1(adv)} км`);
  else if (adv <= -1) out.push(`армии отошли в среднем на ${n1(-adv)} км`);
  const loss = avg(b.map((x) => x.strength)) - avg(a.map((x) => x.strength));
  if (loss >= 0.02) out.push(`потери: сила армий снизилась на ${Math.round(loss * 100)} п. п.`);
  const f = cur.picture.openFlanks.length - prev.picture.openFlanks.length;
  if (f > 0) out.push(`открытых флангов стало больше: ${prev.picture.openFlanks.length} → ${cur.picture.openFlanks.length}`);
  else if (f < 0) out.push(`открытых флангов стало меньше: ${prev.picture.openFlanks.length} → ${cur.picture.openFlanks.length}`);
  const k = cur.picture.pockets.length - prev.picture.pockets.length;
  if (k > 0) out.push('появились окружённые группировки противника');
  return out;
}

/**
 * Ответ командующего на вопрос на час tick. names — названия штабов по id (нет — сам id). Ключевые слова: «другой /
 * не выбрал», «почему», «противник / знал», «сосед / соперник», «хочешь / сейчас / цели», «положение / оцениваешь /
 * настроение». Оценка противника против истины не раскрывается.
 */
export function answer(c: AgentCommander, tick: number, question: string, names: Record<string, string> = {}, trace?: AgentTrace): string {
  const q = question.toLowerCase().replace(/ё/g, 'е');
  if (/истори/.test(q)) return intentAnswer(c, tick, names, trace);
  const nm = (id: string) => names[id] ?? id;
  const v = viewAt(c, tick);
  const has = (re: RegExp) => re.test(q);
  const kind = has(/оценива|положени|настроени|состояни|как дела|как себя чувств/) ? 'mood'
    : has(/друго|не выбрал|альтернатив|иной вариант|почему не/) ? 'other'
    : has(/почему|зачем|решени|решил|обоснов|правил/) ? 'why'
    : has(/противник|знал|разведк|враг|немц|советск/) ? 'enemy'
    : has(/сосед|соперник|конкурент|конев|жуков/) ? 'rival'
    : has(/хочешь|сейчас|цел[ьи]|мотив|важн|стремишь/) ? 'goals' : null;
  if (!kind) return NO_ANSWER;
  const d = v.decision, s = v.snapshot;
  if ((kind === 'why' || kind === 'other') && !d) return NO_DECISIONS;
  if (!s && kind !== 'why' && kind !== 'other') return NO_DECISIONS;

  if (kind === 'why' && d) {
    const o = chosenOf(d);
    return `${d.why}${/[.!?]$/.test(d.why) ? '' : '.'} Правило: ${o.rule}.`;
  }
  if (kind === 'other' && d) {
    const o = chosenOf(d);
    const rest = d.options.filter((_, i) => i !== d.chosen).sort((x, y) => y.total - x.total);
    if (!rest.length) return `Других вариантов не было: выбрал «${o.label}».`;
    const r = rest[0];
    const mind = r.mind ? ` В уме на ${r.mind.hours} ч он давал ${r.mind.advanceKm >= 0 ? '+' : ''}${n1(r.mind.advanceKm)} км продвижения.` : '';
    return `Рассматривал «${r.label}»: итог ${n2(r.total)} против ${n2(o.total)} у «${o.label}» — разница ${n2(o.total - r.total)}.${mind} Его правило: ${r.rule}.`;
  }
  if (kind === 'mood' && s) {
    const prev = [...c.snapshots].filter((x) => x.tick < s.tick).sort((x, y) => y.tick - x.tick)[0] ?? null;
    const dr = drivers(s, prev);
    const base = `Сейчас я ${moodWords(s.mood)} (уверенность ${n2(s.mood.confidence)}, напряжение ${n2(s.mood.stress)}).`;
    if (!prev) return base;
    return `${base} С прошлого разбора (час ${prev.tick}) ${dr.length ? `изменилось: ${dr.join('; ')}.` : 'заметных изменений нет.'}`;
  }
  if (kind === 'enemy' && s) {
    const arm = s.picture.armies.filter((a) => a.enemyEst > 0).sort((x, y) => y.enemyEst - x.enemyEst).slice(0, 5);
    const parts = arm.map((a) => `перед ${nm(a.hq)} — около ${n1(a.enemyEst)} усл. ед. силы`);
    const res = s.picture.enemyReserves.length ? ` Резервов в глубине вижу ${s.picture.enemyReserves.length}.` : '';
    const pk = s.picture.pockets.length ? ` Окружённых группировок: ${s.picture.pockets.length}.` : '';
    return parts.length ? `По моей разведке: ${parts.join('; ')}. Это оценка, точных данных у меня нет.${res}${pk}` : `Перед армиями противника по разведке почти нет.${res}${pk}`;
  }
  if (kind === 'rival' && s) {
    const r = s.picture.rival;
    if (!r) return 'Соперника по объекту у меня нет; соседей слежу по донесениям армий.';
    const mine = s.picture.toObjectiveKm;
    const lag = Math.max(0, tick - r.asOf);
    return `${nm(r.hq)}: до объекта около ${km0(r.toObjectiveKm)} км — по сводке Ставки, ей ${lag} ч.${mine != null ? ` Мои войска от объекта в ${km0(mine)} км.` : ''}`;
  }
  if (kind === 'goals' && s) {
    const rows = Object.entries(s.motives).filter(([k, x]) => x > 0 || (c.baseMotives[k] ?? 0) > 0)
      .sort((x, y) => y[1] - x[1]).slice(0, 4);
    const t = rows.map(([k, x]) => `«${MOTIVE_RU[k] ?? k}» ${n2(x)} (в начале ${n2(c.baseMotives[k] ?? 0)})`);
    return `Сейчас для меня главное: ${t.join('; ')}.${s.intent ? ` Замысел: ${s.intent}.` : ''}`;
  }
  return NO_ANSWER;
}

/** Ответ «почему не как в истории?»: состояние штаба командующего и его армий на час, с причиной и часом ухода. */
function intentAnswer(c: AgentCommander, tick: number, names: Record<string, string>, trace?: AgentTrace): string {
  if (!trace?.intent) return NO_INTENT;
  const nm = (id: string) => names[id] ?? trace.hqs.find((h) => h.id === id)?.name ?? id;
  const own = intentAt(trace, c.hq, tick);
  const armies = trace.hqs.filter((h) => h.parent === c.hq && h.echelon === 'army').map((h) => h.id);
  const left = armies.map((id) => ({ id, s: intentAt(trace, id, tick) })).filter((x) => x.s && x.s.status !== 'history');
  const say = (s: NonNullable<typeof own>) => `${s.status === 'own' ? 'решает сам' : 'идёт по истории со сдвигом'}${s.reason ? ` (${s.reason})` : ''} с часа ${s.since}`;
  const head = !own ? 'По моему штабу данных о замысле нет.' : own.status === 'history' ? 'Мой штаб идёт по истории.' : `Мой штаб ${say(own)}.`;
  const tail = left.length ? ` Армии не по истории: ${left.map((x) => `${nm(x.id)} — ${say(x.s!)}`).join('; ')}.` : armies.length ? ' Армии идут по истории.' : '';
  return head + tail;
}

/** Объекты командующих на карте (profile.objective). */
export const OBJECTIVE_AT: Record<string, { at: [number, number]; name: string }> = { berlin: { at: [13.3777, 52.5186], name: 'Берлин' } };

/** Отметка в ленте решений: час, подпись, будущее (после текущего часа), текущее. */
export interface RibbonItem { tick: number; label: string; future: boolean; current: boolean }
/** Лента решений: свёрнутые серии одинаковых решений по циклу; до 8 прошедших и 2 будущих отметок вокруг часа. */
export function decisionRibbon(c: AgentCommander, tick: number): RibbonItem[] {
  const cur = viewAt(c, tick).decision;
  const all: RibbonItem[] = [];
  let prev = '';
  for (const d of c.decisions) {
    const label = chosenOf(d)?.label ?? '';
    const cycle = /^цикл/.test(d.trigger);
    if (cycle && label === prev && d !== cur) continue;
    prev = label;
    all.push({ tick: d.tick, label, future: d.tick > tick, current: d === cur });
  }
  const past = all.filter((x) => !x.future).slice(-8), fut = all.filter((x) => x.future).slice(0, 2);
  return [...past, ...fut];
}

/** Среднее положение действующих соединений штаба и всех его подчинённых на час; нет таких — null. */
export function hqCentroid(trace: AgentTrace, hq: string, tick: number): [number, number] | null {
  if (!trace.frames.length || !trace.hqs.some((h) => h.id === hq)) return null;
  const frame = trace.frames[Math.max(0, Math.min(trace.frames.length - 1, Math.round(tick)))];
  const under = new Set<string>([hq]);
  for (let grew = true; grew;) { grew = false; for (const h of trace.hqs) if (h.parent && under.has(h.parent) && !under.has(h.id)) { under.add(h.id); grew = true; } }
  let x = 0, y = 0, n = 0;
  trace.divisions.forEach((d, i) => {
    if (!under.has(d.hq)) return;
    const row = frame[i] as [number, number, string];
    const g = agentGroup(row[2]);
    if (g === 'pending' || g === 'destroyed') return;
    x += row[0]; y += row[1]; n++;
  });
  return n ? [x / n, y / n] : null;
}
