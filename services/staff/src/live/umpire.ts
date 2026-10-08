/**
 * Посредник на модели: перед ходом арбитра смотрит на ожидаемые бои и по справкам из базы знаний
 * (доктрина, нормативы, техника) добавляет нюансы, которых арбитр сам не учитывает, — поправки в узких
 * пределах (UMPIRE_LIMITS) с обоснованием. Арбитр остаётся главным: соотношение сил, местность,
 * подготовленная оборона, укрепления, усталость, снабжение уже посчитаны им. Поправки записываются в игру
 * (переигровка точна) и видны в журнале боя.
 *
 * Модуль не зависит от базы знаний: справки (refs) подбирает вызывающий — по запросам umpireQueries.
 */
import { describePlace, onMap, POSTURE_RU, TASK_RU, UMPIRE_FACTORS, UMPIRE_FACTOR_RU, UMPIRE_LIMITS, type Formation, type SimContext, type SimState, type UmpireFactor, type UmpireMod } from '@def-ops/sim';
import { fill } from '../fill';
import type { LlmClient } from '../llm/client';
import type { Thinking } from '../llm/config';
import { momentRu } from './situation';

export interface Engagement {
  n: number;
  attackers: Formation[];
  defenders: Formation[];
  at: [number, number];
  terrain: string;
  fort: number;
  river: string | null;
}
export interface UmpireRef { id: string; title: string; text: string }

const TERRAIN_RU: Record<string, string> = { open: 'открытая местность', forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты', water: 'вода' };
const ATTACK_TASKS = new Set(['attack', 'counterattack', 'breakout']);

/**
 * Ожидаемые бои хода: наступающее формирование и противник в пределах полутора дистанций соприкосновения.
 * Одинаковые группы обороняющихся сливаются; не больше limit боёв (самые крупные).
 */
export function predictEngagements(ctx: SimContext, s: SimState, limit = 10): Engagement[] {
  const T = ctx.theatre, R = ctx.rules;
  const on = s.formations.filter((f) => !f.destroyed && onMap(f, s.time));
  const km = (a: Formation, b: Formation) => { const p = T.proj.toXY(a.position), q = T.proj.toXY(b.position); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
  const groups = new Map<string, { att: Formation[]; def: Formation[] }>();
  for (const a of on) {
    const task = a.order?.task ?? '';
    if (!ATTACK_TASKS.has(task) && a.posture !== 'attack') continue;
    const def = on.filter((d) => d.side !== a.side && km(a, d) <= R.contactKm * 1.5).sort((x, y) => km(a, x) - km(a, y)).slice(0, 4);
    if (!def.length) continue;
    const key = def.map((d) => d.id).sort().join('|');
    const g = groups.get(key) ?? { att: [], def };
    g.att.push(a);
    groups.set(key, g);
  }
  const size = (g: { att: Formation[]; def: Formation[] }) => [...g.att, ...g.def].reduce((x, f) => x + f.personnel, 0);
  return [...groups.values()].sort((a, b) => size(b) - size(a)).slice(0, limit).map((g, i) => {
    const d0 = g.def[0];
    const river = T.snapToRiver(d0.position, Math.max(2, T.cellKm * 2));
    return { n: i + 1, attackers: g.att, defenders: g.def, at: d0.position as [number, number], terrain: T.terrainAt(d0.position), fort: T.fortificationAt(d0.position), river: river ? river.name || (river.major ? 'крупная река' : 'малая река') : null };
  });
}

/** Запросы к базе знаний по условиям боёв (для справок посреднику). */
export function umpireQueries(es: Engagement[]): string[] {
  const q = new Set<string>();
  for (const e of es) {
    const tanks = [...e.attackers, ...e.defenders].reduce((x, f) => x + f.tanks, 0);
    if (e.terrain === 'urban') q.add('бой в городе штурмовые группы танки фаустпатрон уличный бой');
    if (e.fort) q.add('прорыв укреплённой полосы обороны артподготовка темп');
    if (e.river) q.add('форсирование реки переправа мост под огнём');
    if (e.terrain === 'forest' || e.terrain === 'marsh') q.add('бой в лесу ночной марш по одной дороге');
    if (tanks > 300) q.add('танковая армия ввод в прорыв потери танков');
    if (e.defenders.some((d) => /volkssturm|фольксштурм|hj|гитлерюгенд/i.test(`${d.type} ${d.name}`))) q.add('фольксштурм боеспособность');
    if (e.attackers.concat(e.defenders).some((f) => f.cutOff)) q.add('окружённая группировка прорыв из окружения');
  }
  if (!q.size) q.add('наступление оборона потери темп');
  return [...q];
}

function line(f: Formation): string {
  const p = (x: number, y: number) => (y ? Math.round((x / y) * 100) : 100);
  const bits = [
    `${f.name} [${f.echelon}${f.type ? `, ${f.type}` : ''}]`,
    `${Math.round(f.personnel / 1000)} тыс. чел. (${p(f.personnel, f.initial.personnel)} %), танков ${f.tanks}, орудий ${f.guns}`,
    f.order ? `задача: ${TASK_RU[f.order.task as keyof typeof TASK_RU] ?? f.order.task}` : `положение: ${POSTURE_RU[f.posture as keyof typeof POSTURE_RU] ?? f.posture}`,
    `боеприпасы ${Math.round(f.ammo * 100)} %, усталость ${Math.round(f.fatigue * 100)} %`,
    ...(f.posture === 'defend' && f.dugInHours ? [`в обороне ${Math.round(f.dugInHours)} ч`] : []),
    ...(f.cutOff ? ['ОКРУЖЕНО'] : []),
  ];
  return bits.join('; ');
}

export function umpireMessages(ctx: SimContext, s: SimState, es: Engagement[], refs: UmpireRef[], tpl: { system: string; user: string }) {
  const side = (id: string) => ctx.scenario.sides.find((x) => x.id === id)?.name ?? id;
  const engagements = es.map((e) => [
    `Бой ${e.n}. ${describePlace(ctx.theatre, e.at)}; местность: ${TERRAIN_RU[e.terrain] ?? e.terrain}${e.fort ? `; укреплённая полоса ${e.fort}-го уровня` : ''}${e.river ? `; рядом водная преграда: ${e.river}` : ''}.`,
    `  Наступают (${side(e.attackers[0].side)}):`, ...e.attackers.map((f) => `  - ${line(f)}`),
    `  Обороняются (${side(e.defenders[0].side)}):`, ...e.defenders.map((f) => `  - ${line(f)}`),
  ].join('\n')).join('\n\n');
  const refText = refs.length ? refs.map((r, i) => `[R${i + 1}] ${r.title}\n${r.text}`).join('\n\n') : '(справок нет)';
  const lim = `${UMPIRE_LIMITS[0]}–${UMPIRE_LIMITS[1]}`;
  return [
    { role: 'system' as const, content: fill(tpl.system, { limits: lim, factors: UMPIRE_FACTORS.map((k) => `${k} — ${UMPIRE_FACTOR_RU[k]}`).join('; ') }, 'umpire.system.md') },
    { role: 'user' as const, content: fill(tpl.user, { moment: momentRu(s.time), turn_hours: String(ctx.scenario.turnHours), engagements: engagements || '(боёв не ожидается)', refs: refText }, 'umpire.user.md') },
  ];
}

export const UMPIRE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['assessment', 'mods'],
  properties: {
    assessment: { type: 'string' },
    mods: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['engagement', 'factor', 'mult', 'reason', 'basis'],
        properties: {
          engagement: { type: 'integer' },
          factor: { type: 'string', enum: UMPIRE_FACTORS },
          mult: { type: 'number' },
          reason: { type: 'string' },
          basis: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export interface UmpireRaw { assessment?: string; mods?: { engagement: number | string; factor: string; mult: number | string; reason: string; basis: string[] | string }[] }

const FACTOR_ALIASES: [RegExp, UmpireFactor][] = [
  [/^attack$|наступ.*сил|сила наступ/i, 'attack'], [/^defen[cs]e$|оборон.*сил|сила оборон/i, 'defense'], [/^pace$|темп/i, 'pace'],
  [/^attackerloss$|потери наступ/i, 'attackerLoss'], [/^defenderloss$|потери оборон/i, 'defenderLoss'],
];
/** Обоснование словами модели → id справок и «обстановка»: «R1», «[R1]», «R2 — …», «[R1], [R3]», название справки. */
function parseBasis(basis: string[] | string | undefined, refs: UmpireRef[]): string[] {
  const out = new Set<string>();
  for (const b of (Array.isArray(basis) ? basis : basis ? [basis] : [])) {
    const s = String(b);
    for (const m of s.matchAll(/R\s?(\d{1,2})\b/gi)) { const r = refs[+m[1] - 1]; if (r) out.add(r.id); }
    for (const r of refs) if (r.title && s.toLowerCase().includes(r.title.toLowerCase().slice(0, 24))) out.add(r.id);
    if (/обстановк|сводк|situation|обстоятельств|условия боя/i.test(s)) out.add('обстановка');
    if (!out.size && s.trim().length > 3) out.add('обстановка'); // обоснование словами без ссылки — считаем обстановкой
  }
  return [...out];
}
export interface UmpireIssue { text: string }

/**
 * Ответ модели → поправки для арбитра: бой и множитель проверяются, множитель ограничивается пределами,
 * обоснование — ссылки на справки [Rn] (переводятся в id записей базы) или «обстановка»; без обоснования
 * поправка отбрасывается. На бой — не больше одной поправки на множитель.
 */
export function umpireMods(raw: UmpireRaw, es: Engagement[], refs: UmpireRef[]): { mods: UmpireMod[]; issues: UmpireIssue[] } {
  const mods: UmpireMod[] = [];
  const issues: UmpireIssue[] = [];
  const seen = new Set<string>();
  for (const m of raw.mods ?? []) {
    const n = typeof m.engagement === 'number' ? m.engagement : Number(/\d+/.exec(String(m.engagement))?.[0]);
    const e = es.find((x) => x.n === n);
    if (!e) { issues.push({ text: `бой «${m.engagement}» не найден среди ожидаемых` }); continue; }
    const factor = UMPIRE_FACTORS.includes(m.factor as UmpireFactor) ? m.factor as UmpireFactor : FACTOR_ALIASES.find(([re]) => re.test(String(m.factor)))?.[1];
    if (!factor) { issues.push({ text: `бой ${e.n}: неизвестный множитель «${m.factor}»` }); continue; }
    const raw0 = typeof m.mult === 'number' ? m.mult : Number(String(m.mult).replace(',', '.').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(raw0) || raw0 <= 0) { issues.push({ text: `бой ${e.n}: множитель «${m.mult}» не число` }); continue; }
    const basis = parseBasis(m.basis, refs);
    if (!m.reason?.trim()) { issues.push({ text: `бой ${e.n}: поправка без причины отброшена` }); continue; }
    if (!basis.length) basis.push('обстановка');
    const mult = Math.min(UMPIRE_LIMITS[1], Math.max(UMPIRE_LIMITS[0], raw0));
    if (Math.abs(Math.log(mult)) < 0.02) { issues.push({ text: `бой ${e.n}: множитель ${raw0} — без изменения` }); continue; }
    if (mult !== raw0) issues.push({ text: `бой ${e.n}: множитель ${raw0} ограничен до ${mult}` });
    const key = `${e.n}:${factor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const who = factor === 'defense' || factor === 'defenderLoss' ? e.defenders : e.attackers;
    mods.push({ formations: who.map((f) => f.id), factor, mult: +mult.toFixed(3), reason: m.reason.trim().slice(0, 240), basis });
  }
  return { mods, issues };
}

export interface UmpireTurn { time: string; ok: boolean; error?: string; assessment?: string; mods: UmpireMod[]; issues: UmpireIssue[]; engagements: number; refs: UmpireRef[]; seconds?: number; /** Сколько поправок предложила модель (до проверки). */ proposed?: number }

/**
 * Посредник на ход: ожидаемые бои → справки из базы (refsFor — по запросам) → модель → проверенные поправки.
 * Нет боёв — модель не вызывается. Ошибка модели — ход без поправок (арбитр считает сам).
 */
export async function umpireTurn(client: LlmClient, ctx: SimContext, s: SimState, refsFor: (queries: string[]) => Promise<UmpireRef[]>, tpl: { system: string; user: string },
  opts: { thinking?: Thinking; signal?: AbortSignal; limit?: number } = {}): Promise<UmpireTurn> {
  const t0 = Date.now();
  const es = predictEngagements(ctx, s, opts.limit ?? 10);
  if (!es.length) return { time: s.time, ok: true, mods: [], issues: [], engagements: 0, refs: [] };
  const refs = (await refsFor(umpireQueries(es)).catch(() => [])).slice(0, 8);
  try {
    const r = await client.chat({ messages: umpireMessages(ctx, s, es, refs, tpl), schema: { name: 'umpire', schema: UMPIRE_SCHEMA }, thinking: opts.thinking ?? 'off', signal: opts.signal });
    if (r.jsonError) return { time: s.time, ok: false, error: `ответ не разобран: ${r.jsonError}`, mods: [], issues: [], engagements: es.length, refs };
    const raw = r.json as UmpireRaw;
    const v = umpireMods(raw, es, refs);
    return { time: s.time, ok: true, assessment: raw.assessment, mods: v.mods, issues: v.issues, engagements: es.length, refs, seconds: Math.round((Date.now() - t0) / 1000), proposed: raw.mods?.length ?? 0 };
  } catch (e) {
    return { time: s.time, ok: false, error: (e as Error).message, mods: [], issues: [], engagements: es.length, refs };
  }
}
