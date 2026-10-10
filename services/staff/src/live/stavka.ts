/**
 * Модель-Ставка в игре: устанавливает разграничительные линии между фронтами стороны, когда исторические
 * директивы не подходят к обстановке. Вызывается не каждый ход, а когда есть повод:
 *  - срок исторической директивы прошёл, а её условие в игре не наступило (обстановка разошлась с историей);
 *  - войска фронта второй ход подряд стоят в полосе соседа по действующей линии;
 *  - командующий подал ходатайство в Ставку.
 * Исторические директивы подаются как образец (так Ставка решала в похожей обстановке). Ответ — оставить линии
 * или новая линия по пунктам из списка; линия превращается в распоряжение «directive» (проверка, срок вступления)
 * и пишется в запись игры — игра повторяется точно.
 */
import {
  checkAction, commandTerms, effectiveBoundaries, groupOf, nearbyPlaces, onMap, places, sectorText, sectorViolations, shortName, withBoundaries,
  type Boundary, type CommandTerms, type GameState, type SimContext, type StaffAction,
} from '@def-ops/sim';
import type { LlmClient } from '../llm/client';
import { momentRu } from './situation';

export interface StavkaNeed { reasons: string[]; pending: Boundary[]; request: string }

const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;
const pair = (a: string, b: string) => [a, b].sort().join('|');

/** Есть ли повод обратиться к Ставке на этом ходу (null — нет). */
export function stavkaNeed(ctx: SimContext, g: GameState, side: string, request = ''): StavkaNeed | null {
  const s = g.state, now = s.time;
  const issued = (s.boundaries ?? []).filter((b) => b.issuedBy === 'stavka' && b.side === side);
  const lately = (a: string, b: string, h: number) => issued.some((x) => pair(x.right, x.left) === pair(a, b) && Date.parse(`${x.issuedAt}Z`) > Date.parse(`${now}Z`) - h * 3600_000);
  const reasons: string[] = [];
  const names = new Map(ctx.scenario.formations.map((f) => [f.id, shortName(f.name)]));
  // исторический срок прошёл, условие не наступило, своей линии Ставка по этой паре после срока не давала
  const act = s.directives?.activated ?? {};
  const pending = (ctx.scenario.boundaries ?? []).filter((b) => b.side === side && b.trigger && !act[b.id] && b.from <= now
    && !issued.some((x) => pair(x.right, x.left) === pair(b.right, b.left) && (x.issuedAt ?? '') >= b.from));
  for (const b of pending) reasons.push(`В истории с ${ddmm(b.from)} действовала новая линия ${names.get(b.right)} / ${names.get(b.left)} (${b.title}); её вызвало: ${b.trigger!.text}. В игре этого не произошло — нужна ли новая линия?`);
  // войска второй ход подряд в полосе соседа
  if (g.prev && s.directives?.conditional) {
    const units = (st: typeof s) => st.formations.filter((f) => onMap(f, st.time)).map((f) => ({ id: f.id, side: f.side, at: f.position }));
    const v1 = sectorViolations(ctx.theatre, withBoundaries(ctx.scenario, s), units(s), now).filter((v) => units(s).find((u) => u.id === v.formation)?.side === side);
    const v0 = new Set(sectorViolations(ctx.theatre, withBoundaries(ctx.scenario, g.prev), units(g.prev), g.prev.time).map((v) => `${v.formation}|${v.in}`));
    const stuck = v1.filter((v) => v0.has(`${v.formation}|${v.in}`) && !lately(v.group, v.in, 48));
    if (stuck.length) reasons.push(`Второй ход подряд в полосе соседа: ${stuck.map((v) => `${names.get(v.formation)} (${names.get(v.group)}) — в полосе ${names.get(v.in)}`).join(', ')}.`);
  }
  if (request.trim()) reasons.push(`Ходатайство командующего: ${request.trim()}`);
  return reasons.length ? { reasons, pending, request: request.trim() } : null;
}

export const STAVKA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['assessment', 'decision', 'lines', 'reply'],
  properties: {
    assessment: { type: 'string' },
    decision: { type: 'string', enum: ['keep', 'issue'] },
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['between', 'points', 'delayHours', 'reason'],
        properties: { between: { type: 'array', items: { type: 'string' } }, points: { type: 'array', items: { type: 'string' } }, delayHours: { type: 'number' }, reason: { type: 'string' } },
      },
    },
    reply: { type: 'string' },
  },
} as const;
export interface StavkaRaw { assessment: string; decision: 'keep' | 'issue'; lines: { between: string[]; points: string[]; delayHours: number; reason: string }[]; reply: string }

export interface StavkaBuilt { messages: { role: 'system' | 'user'; content: string }[]; fronts: { id: string; name: string; short: string }[]; places: { id: string; title: string; at: [number, number] }[] }

/** Системный текст высшего командования стороны: Ставка ВГК (фронты) или ОКХ (группы армий). */
const system = (t: CommandTerms) => {
  const german = t.top === 'ОКХ';
  const who = german
    ? 'Вы — ОКХ, Главное командование сухопутных войск вермахта (модель в военно-историческом симуляторе); войска, подчинённые ОКВ (например, 12-я армия), здесь тоже на вас'
    : 'Вы — Ставка Верховного Главнокомандования (модель в военно-историческом симуляторе)';
  const g = german ? 'группами армий' : 'фронтами', gs = german ? 'группы армий' : 'фронты', g2 = german ? 'группами армий' : 'фронтами';
  return `${who}. Ваше дело здесь — только разграничительные линии между ${g} своей стороны: задачи ${german ? 'группам армий' : 'фронтам'} ставит их командование.

Правила:
1. Новая линия — когда без неё ${gs} мешают друг другу (войска одного стоят или наступают в полосе другого), когда обстановка разошлась с историей так, что прежняя линия не подходит, или по обоснованному ходатайству. Иначе — оставить линии как есть (decision = keep).
2. Линия — между двумя соседними ${g2} (between — их названия точно как в обстановке), пункты — по порядку, точно из списка пунктов, от 2 до 8; первый пункт — там, где линия начинается (обычно в тылу), последний — где кончается (у переднего края или за ним, в глубине противника).
3. delayHours — через сколько часов линия вступает в силу (на отдачу и доведение ${german ? 'приказа' : 'директивы'}): обычно 4–8.
4. Исторические ${german ? 'приказы' : 'директивы'} — образец: так ${t.top} ${german ? 'решало' : 'решала'} в похожей обстановке. Не копируйте их, если обстановка другая.
5. reply — короткий текст ${german ? 'приказа' : 'директивы'} или ответ на ходатайство, как его получит командующий.
Ответ — один JSON-объект по схеме.`;
};

/** Обстановка для Ставки: фронты и их армии, действующие линии, поводы, образцы, пункты. */
export function buildStavka(ctx: SimContext, g: GameState, side: string, need: StavkaNeed): StavkaBuilt {
  const s = g.state, T = ctx.theatre;
  const scen = withBoundaries(ctx.scenario, s);
  const groups = groupOf(ctx.scenario, 'front');
  const defs = new Map(ctx.scenario.formations.map((f) => [f.id, f]));
  const live = s.formations.filter((f) => f.side === side && onMap(f, s.time) && f.type);
  const fronts = [...new Set(live.map((f) => groups.get(f.id) ?? f.id))].map((id) => ({ id, name: defs.get(id)?.name ?? id, short: shortName(defs.get(id)?.name ?? id) }));
  // пункты: ближние к войскам стороны — первыми, затем остальные пункты театра (линия может уходить в глубину)
  const close = nearbyPlaces(ctx, s, side, 40, 120).map((a) => ({ id: a.id, title: a.title, at: a.at as [number, number] }));
  const near = [...close, ...places(T).filter((a) => !close.some((c) => c.id === a.id)).map((a) => ({ id: a.id, title: a.title, at: a.at as [number, number] }))];
  const placeOf = (at: [number, number]) => near.map((a) => ({ a, d: Math.hypot(T.proj.toXY(a.at)[0] - T.proj.toXY(at)[0], T.proj.toXY(a.at)[1] - T.proj.toXY(at)[1]) })).sort((x, y) => x.d - y.d)[0];
  const frontLines = fronts.map((fr) => {
    const armies = live.filter((f) => (groups.get(f.id) ?? f.id) === fr.id).map((f) => { const p = placeOf(f.position as [number, number]); return `${shortName(f.name)} — ${p ? `${Math.round(p.d)} км от ${p.a.title}` : 'на театре'}`; });
    return `- ${fr.name} (${fr.short}): ${armies.join('; ')}`;
  });
  const units = s.formations.filter((f) => onMap(f, s.time)).map((f) => ({ id: f.id, side: f.side, at: f.position }));
  const lines = sectorText(T, scen, units, side, s.time, (id) => shortName(defs.get(id)?.name ?? id));
  const pattern = need.pending.map((b) => `- ${defs.get(b.right)?.name} / ${defs.get(b.left)?.name}: ${(b.places ?? []).join(' — ')} (в истории — с ${ddmm(b.from)}; вызвало: ${b.trigger?.text ?? '—'})`);
  const t = commandTerms(ctx, side), german = t.top === 'ОКХ';
  const user = [
    `Обстановка на ${momentRu(s.time)}.`, '',
    `${german ? 'Группы армий' : 'Фронты'} и их войска:`, ...frontLines, '',
    'Действующие разграничительные линии:', ...(lines.length ? lines.map((x) => `- ${x}`) : ['- нет']), '',
    `Повод обратиться ${german ? 'к ОКХ' : 'к Ставке'}:`, ...need.reasons.map((x) => `- ${x}`), '',
    ...(pattern.length ? [`Образец — исторические ${german ? 'приказы' : 'директивы'}:`, ...pattern, ''] : []),
    'Пункты (в линиях — точно эти названия):', ...near.map((a) => `- ${a.title}`), '',
    'Решение: оставить линии или установить новую линию.',
  ].join('\n');
  return { messages: [{ role: 'system', content: system(t) }, { role: 'user', content: user }], fronts, places: near };
}

export interface StavkaResult {
  ok: boolean; error?: string; model?: string;
  reasons: string[]; request: string;
  assessment?: string; reply?: string;
  /** Директивы (распоряжения directive) — исполнимые; что не удалось понять — в issues. */
  actions: StaffAction[];
  issues: string[];
  /** Директивы словами — для журнала. */
  text: string[];
}

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();

/** Ответ Ставки → распоряжения: фронты по названию, пункты по списку, проверка линии. */
export function stavkaActions(ctx: SimContext, g: GameState, side: string, built: StavkaBuilt, raw: StavkaRaw): { actions: StaffAction[]; issues: string[]; text: string[] } {
  const actions: StaffAction[] = [], issues: string[] = [], text: string[] = [];
  if (raw.decision !== 'issue') return { actions, issues, text };
  const front = (n: string) => built.fronts.find((f) => [f.name, f.short, f.id].some((x) => norm(x) === norm(n)) || norm(f.name).startsWith(norm(n)));
  for (const l of raw.lines ?? []) {
    const [a, b] = (l.between ?? []).map(front);
    if (!a || !b) { issues.push(`не понято, между какими фронтами: ${(l.between ?? []).join(' / ')}`); continue; }
    const base = (t: string) => norm(t.replace(/\s*\(.*\)\s*$/, ''));
    const pts = (l.points ?? []).map((p) => built.places.find((x) => norm(x.title) === norm(p)) ?? built.places.find((x) => base(x.title) === base(p))).filter((x): x is StavkaBuilt['places'][number] => !!x);
    if (pts.length < 2) { issues.push(`линия ${a.short} / ${b.short}: меньше двух пунктов из списка (${(l.points ?? []).join(', ')})`); continue; }
    const act: StaffAction = { kind: 'directive', side, a: a.id, b: b.id, line: pts.map((p) => p.at), places: pts.map((p) => p.title), delayHours: Math.min(24, Math.max(2, Number(l.delayHours) || 6)), reason: l.reason, issuedAt: g.state.time };
    const c = checkAction(ctx, g.state, act);
    if (!c.ok) { issues.push(`линия ${a.short} / ${b.short}: ${c.text}`); continue; }
    actions.push(act);
    text.push(`${a.short} / ${b.short}: ${pts.map((p) => p.title).join(' — ')} — ${c.text}${l.reason ? `. ${l.reason}` : ''}`);
  }
  return { actions, issues, text };
}

/** Обращение к Ставке: модель решает, оставить линии или установить новую. Ошибка модели — линии остаются. */
export async function stavkaTurn(client: LlmClient, ctx: SimContext, g: GameState, side: string, need: StavkaNeed, opts: { signal?: AbortSignal } = {}): Promise<StavkaResult> {
  const out: StavkaResult = { ok: false, reasons: need.reasons, request: need.request, actions: [], issues: [], text: [] };
  const built = buildStavka(ctx, g, side, need);
  try {
    const r = await client.chat({ messages: built.messages, schema: { name: 'stavka_boundaries', schema: STAVKA_SCHEMA }, thinking: 'off', signal: opts.signal });
    out.model = r.model;
    if (r.jsonError) { out.error = `ответ не разобран: ${r.jsonError}`; return out; }
    const raw = r.json as StavkaRaw;
    const a = stavkaActions(ctx, g, side, built, raw);
    return { ...out, ok: true, assessment: raw.assessment, reply: raw.reply, ...a };
  } catch (e) {
    out.error = (e as Error).message;
    return out;
  }
}

/** Линии, вступившие и ожидающие (для разбора). */
export const stavkaLines = (ctx: SimContext, g: GameState, side: string) => effectiveBoundaries(ctx.scenario, g.state).filter((b) => b.side === side && b.issuedBy === 'stavka');
