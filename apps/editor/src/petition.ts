/**
 * Ходатайство в верхнюю инстанцию (Ставку, ОКХ) о разграничительной линии с соседним фронтом — где оно действует и
 * кто его рассматривает. Агентная модель: взятый игроком фронт подаёт линию, Ставка ядра рассматривает её на этом ходу
 * по правилу (command/petition.rs); если Ставку ведёт сам игрок — подавать некому. Нынешняя модель: ходатайство —
 * текст для модели-Ставки, работает лишь при ней; соседи — объединения верхнего уровня стороны. Где не действует — поле скрыто с пояснением. Без React.
 */
import { createFeature, type Feature, type LabelFeature, type LineFeature, type LngLat } from '@def-ops/core';
import type { CommandOp } from './command-forms';
import type { EnemyMode, Place, TurnView } from './sim/game-protocol';
import { taken } from './command-post';

/** Черновик ходатайства: сосед (штаб фронта), линия (точки), обоснование. */
export interface PetitionDraft { neighbour: string; line: LngLat[]; note: string }
/** Показывать ли поле; кто рассматривает (правило ядра или модель-Ставка); пояснение; соседи, с кем линия. */
export interface PetitionState { show: boolean; who?: 'rules' | 'llm'; why: string; neighbours: { id: string; name: string }[] }

/** Слова советской стороны — словами стороны игрока (ОКХ, группы армий): все падежи, что встречаются в текстах. */
function words(s: string, v: TurnView): string {
  const t = v.terms;
  if (!t?.top || t.top === 'Ставка') return s;
  const grp = t.group === 'группа армий';
  let r = s.replace(/Ставку/g, t.topTo.replace(/^в /, '')).replace(/Ставки/g, t.topGen).replace(/Ставка/g, t.top).replace(/Ставкой/g, t.top);
  if (grp) {
    r = r.replace(/директивой фронтам/g, 'приказом группам армий').replace(/директивой обоим фронтам/g, 'приказом обеим группам армий')
      .replace(/между фронтами/g, 'между группами армий').replace(/командующий фронтом/g, 'командующий группой армий')
      .replace(/документом Ставки|документом ОКХ/g, `документом ${t.topGen}`).replace(/обоим фронтам/g, 'обеим группам армий');
  }
  return r;
}

const NO_LLM = 'Ходатайство рассматривает модель-Ставка, а она сейчас не работает (выключена в «Посреднике» или модель не на связи) — подать некому.';
const SELF = 'Ставку ведёте вы сами: линию между фронтами задайте директивой фронтам на уровне «Ставка» (вкладка «Приказы» → «Пункт управления»).';
const NOT_FRONT = 'Ходатайство о линии между фронтами подаёт командующий фронтом — пункт управления уровня «Фронт».';
const LEGACY = 'В режиме «Как сейчас» нет командования по ступеням: ходатайство о линии между фронтами не рассматривается — линии между фронтами идут по истории.';
const RULES = 'Рассматривает Ставка на этом ходу по правилу: линия принимается, если не отнимает у соседа главный удар и оставляет ему не меньше половины прежней полосы; ответ — документом Ставки, принятая линия — директивой обоим фронтам.';
const LLM = 'Рассматривает модель высшего командования (Ставка) на этом ходу; ответ и новая линия — в донесениях следующего хода и в «Журнале».';

/** Фронт, к которому относится штаб или дивизия (подъём по подчинённости), или null. */
function frontOf(v: TurnView, id: string | null): string | null {
  const hqs = v.command?.hqs ?? {};
  for (let i = 0; id && i < 12; i++) {
    const h = hqs[id];
    if (h?.echelon === 'front') return id;
    id = h ? h.parent : v.own.find((u) => u.id === id)?.parent ?? null;
  }
  return null;
}

/**
 * Где ходатайство действует. Порядок проверок: нынешняя модель (нужна модель-Ставка) → верхнюю инстанцию ведёт игрок
 * (подавать некому) → пункт не фронт → фронт не взят → подаётся, рассматривает правило.
 */
export function petitionState(v: TurnView, issuer: string | null, o: { stavkaLlm: boolean; llmOk: boolean; enemy: EnemyMode; umpire: boolean }, cmds: CommandOp[] = []): PetitionState {
  const c = v.command;
  if (!c) {
    const on = o.stavkaLlm && o.llmOk && (o.enemy === 'llm' || o.umpire);
    return on ? { show: true, who: 'llm', why: words(LLM, v), neighbours: (v.groups ?? []).map((g) => ({ id: g.id, name: g.name })) } : { show: false, why: words(NO_LLM, v), neighbours: [] };
  }
  if (c.mode === 'legacy') return { show: false, why: words(LEGACY, v), neighbours: [] };
  const hqs = c.hqs;
  const top = Object.entries(hqs).find(([, h]) => h.echelon === 'high_command');
  const h = issuer ? hqs[issuer] : undefined;
  if ((top && top[1].control === 'player') || h?.echelon === 'high_command') return { show: false, why: words(SELF, v), neighbours: [] };
  if (!issuer || !h || h.echelon !== 'front') return { show: false, why: words(NOT_FRONT, v), neighbours: [] };
  if (!taken(v, issuer, cmds)) return { show: false, why: `${h.name} ведёт история или агент — ходатайство подаёт штаб под вашим управлением (вкладка «Штабы» → «взять»).`, neighbours: [] };
  const manned = new Set(v.own.filter((u) => u.status !== 'destroyed').map((u) => frontOf(v, u.parent)));
  const neighbours = Object.entries(hqs).filter(([id, x]) => x.echelon === 'front' && x.parent === h.parent && id !== issuer && manned.has(id))
    .map(([id, x]) => ({ id, name: x.name }));
  return { show: true, who: 'rules', why: words(RULES, v), neighbours };
}

/** Команда ядру: ходатайство взятого фронта; нет соседа или в линии меньше двух точек — null. */
export function petitionOp(issuer: string, p: PetitionDraft | undefined): CommandOp | null {
  if (!p || !p.neighbour || p.line.length < 2) return null;
  return { op: 'petition', from: issuer, neighbour: p.neighbour, line: p.line.map(([x, y]) => [x, y] as [number, number]), note: p.note.trim() };
}

const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111;

/** Текст ходатайства для модели-Ставки (нынешняя модель): сосед и пункты, ближайшие к точкам линии. */
export function petitionText(p: PetitionDraft, name: (id: string) => string, places: Place[]): string {
  const via: string[] = [];
  for (const at of p.line) {
    const near = places.reduce<Place | null>((m, x) => (!m || km(at, x.at) < km(at, m.at) ? x : m), null);
    const t = near ? near.title.replace(/ \(.*\)$/, '') : `${at[1].toFixed(2)}, ${at[0].toFixed(2)}`;
    if (via.at(-1) !== t) via.push(t);
  }
  const note = p.note.trim();
  return `Прошу установить разграничительную линию с ${name(p.neighbour)}${via.length ? ` через ${via.join(' — ')}` : ''}.${note ? ` ${note}` : ''}`;
}

/** «дд.мм чч:мм» — ключ сортировки по времени (месяц, день, час). */
const timeKey = (t: string) => `${t.slice(3, 5)}${t.slice(0, 2)}${t.slice(6)}`;

/** Последний ответ верхней инстанции на ходатайство пункта: время, принято ли, словами. */
export function petitionAnswer(v: TurnView, issuer: string): { time: string; accepted: boolean; text: string } | null {
  const own = (v.command?.petitions ?? []).filter((p) => p.from === issuer);
  if (!own.length) return null;
  const p = own.reduce((m, x) => (timeKey(x.time) >= timeKey(m.time) ? x : m));
  return { time: p.time, accepted: p.accepted, text: p.accepted ? (p.why ? `линия принята — ${p.why}` : 'линия принята') : p.why };
}

/** Цвет ходатайства на карте — свой, чтобы линию нельзя было спутать с разграничительными линиями проектов. */
export const PETITION_COLOR = '#8e24aa';

/**
 * Ходатайство открытого пункта на карте: линия — пунктиром своего цвета (не штрихпунктир разграничительной линии),
 * у её середины — подпись «ходатайство: линия с соседом (…)» с белой обводкой; одна точка — знаком с той же подписью.
 */
export function petitionMarks(p: PetitionDraft, neighbour: string, time: string): Feature[] {
  if (!p.line.length) return [];
  const t = { from: time, to: null };
  const what = `линия с соседом${neighbour ? ` (${neighbour})` : ''}`;
  const out: Feature[] = [];
  if (p.line.length > 1) {
    const f = createFeature('line', 'rkka.boundaryArmy', { points: p.line, layerId: 'plan' }, 1.2, 'own') as LineFeature;
    f.style = { ...f.style, layers: f.style.layers.map((l) => ({ ...l, color: PETITION_COLOR, dash: [7, 5] })) };
    f.name = `Ходатайство: ${what}`; f.time = t; out.push(f);
  } else {
    const f = createFeature('symbol', 'std.unitOval', { at: p.line[0], layerId: 'plan' }, 0.5, 'own');
    f.name = `Ходатайство: ${what}`; f.time = t; out.push(f);
  }
  const mid = p.line[Math.floor(p.line.length / 2)];
  const lb = createFeature('label', 'atlas.unit', { at: [mid[0] + 0.03, mid[1] + 0.012], text: `ходатайство: ${what}`, layerId: 'plan' }, 1, 'own') as LabelFeature;
  lb.style = { ...lb.style, color: PETITION_COLOR, size: 14, halo: { color: '#ffffff', width: 2.2 } };
  lb.time = t; out.push(lb);
  return out;
}
