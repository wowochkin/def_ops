/**
 * Пункт управления по уровням (игра на агентной модели, командование по ступеням): на каждом уровне карты — своя
 * ступень. Ставка отдаёт директивы фронтам, штаб фронта — армиям, штаб армии — боевые приказы корпусам, штаб корпуса —
 * дивизиям; на уровне «Дивизия» — боевые распоряжения дивизиям. Отдаёт взятый игроком штаб ступени; не взятый — от его
 * имени ничего не отдаётся: приказ его подчинённым идёт от Ставки через голову (ПУ-39 ст. 93). Без React.
 */
import type { LngLat } from '@def-ops/core';
import type { TurnView } from './sim/game-protocol';
import type { LevelId } from './map-level-scale';
import type { CommandOp, Form } from './command-forms';

/** Ступень штаба пункта на уровне карты. */
export const ISSUER: Record<LevelId, string> = { stavka: 'high_command', front: 'front', army: 'army', corps: 'corps', division: 'corps' };
/** Название пункта по уровню. */
export const POST_TITLE: Record<LevelId, string> = { stavka: 'Ставка', front: 'штаб фронта', army: 'штаб армии', corps: 'штаб корпуса', division: 'штаб корпуса — распоряжения дивизиям' };
/** Документ по уровню (форма «приказ»); распоряжение — на любом. */
export const DOC_TITLE: Record<LevelId, string> = { stavka: 'Директива Ставки', front: 'Директива фронта', army: 'Боевой приказ армии', corps: 'Боевой приказ корпуса', division: 'Боевое распоряжение' };

export type FieldKey = 'task' | 'axis' | 'mainBlow' | 'immediate' | 'subsequent' | 'boundaries' | 'junction' | 'reserve' | 'echelon' | 'commit' | 'note';
export interface Field { key: FieldKey; label: string; hint?: string }

/** Поля формы по ступени получателя (раздел 1 спецификации). */
export const FIELDS: Record<LevelId, Field[]> = {
  stavka: [
    { key: 'task', label: 'Задача фронта' },
    { key: 'axis', label: 'Главный удар (ось)', hint: 'от исходного района к цели операции' },
    { key: 'mainBlow', label: 'Армии главного удара' },
    { key: 'immediate', label: 'Ближайшая задача (рубеж)', hint: 'и срок' },
    { key: 'subsequent', label: 'Последующая задача (рубеж)', hint: 'и срок' },
    { key: 'boundaries', label: 'Разграничительные линии', hint: 'правая и левая' },
    { key: 'junction', label: 'Ответственный за стык', hint: 'в документ; штабы-агенты по нему пока не решают' },
    { key: 'reserve', label: 'Резервы Ставки в состав фронта', hint: 'в документ; ввод резерва — «Приказы → Резервы»' },
    { key: 'note', label: 'Указания' },
  ],
  front: [
    { key: 'task', label: 'Задача армии' },
    { key: 'boundaries', label: 'Полоса армии', hint: 'правая и левая разграничительные линии' },
    { key: 'immediate', label: 'Участок прорыва (рубеж)', hint: 'и срок' },
    { key: 'subsequent', label: 'Задача на глубину (рубеж)', hint: 'и срок' },
    { key: 'commit', label: 'Ввод подвижной группы', hint: 'танковая армия — в прорыв' },
    { key: 'note', label: 'Указания' },
  ],
  army: [
    { key: 'task', label: 'Задача корпуса' },
    { key: 'boundaries', label: 'Полоса корпуса' },
    { key: 'echelon', label: 'Эшелон', hint: 'ударная группа — первый эшелон' },
    { key: 'immediate', label: 'Ближайшая задача (рубеж)', hint: 'и срок' },
    { key: 'subsequent', label: 'Последующая задача (рубеж)', hint: 'и срок' },
    { key: 'note', label: 'Указания' },
  ],
  corps: [
    { key: 'task', label: 'Задача дивизии' },
    { key: 'boundaries', label: 'Полоса дивизии' },
    { key: 'immediate', label: 'Ближайшая задача (рубеж)', hint: 'и срок' },
    { key: 'subsequent', label: 'Задача в глубине (рубеж)', hint: 'и срок' },
    { key: 'axis', label: 'Направление дальнейшего наступления' },
    { key: 'note', label: 'Указания' },
  ],
  division: [
    { key: 'task', label: 'Задача' },
    { key: 'immediate', label: 'Рубеж или пункт' },
    { key: 'note', label: 'Указания' },
  ],
};

/** Поле проекта, которое указывается на карте или выбором объекта. */
export type DirPick = 'axis' | 'immediate' | 'subsequent' | 'boundaryR' | 'boundaryL' | 'mainBlow';

export type DirTask = 'attack' | 'defend' | 'delay' | 'withdraw' | 'move' | 'reserve';
export const DIR_TASK_RU: Record<DirTask, string> = { attack: 'наступать', defend: 'оборонять', delay: 'сдерживать', withdraw: 'отходить', move: 'выдвинуться', reserve: 'в резерв' };

/** Проект директивы в пункте управления. Сроки — моменты (ISO), границы — [правая, левая]. */
export interface DirDraft {
  to: string;
  level: LevelId;
  task: DirTask;
  form: Form;
  axis: LngLat[];
  /** Цель оси, выбранная из списка объектов (подпись точки цели на карте); указание щелчками её снимает. */
  axisTitle?: string;
  immediate: LngLat[];
  /** Название объекта ближайшей задачи (выбран из списка). */
  immediateTitle?: string;
  immediateBy?: string;
  subsequent: LngLat[];
  subsequentTitle?: string;
  subsequentBy?: string;
  boundaries: [LngLat[], LngLat[]];
  mainBlow: string[];
  reserve: string[];
  junction?: string;
  echelon?: 'first' | 'second';
  commit?: boolean;
  note: string;
  /** Указания составляются по задаче и обстановке (post-notes); правка руками ставит false — пересчёт останавливается. */
  noteAuto?: boolean;
}

export const blankDir = (to: string, level: LevelId): DirDraft => ({ to, level, task: 'attack', form: level === 'division' ? 'instruction' : 'order', axis: [], immediate: [], subsequent: [], boundaries: [[], []], mainBlow: [], reserve: [], note: '', noteAuto: true });

type Node = { id: string; name: string; echelon: string; parent: string | null; control?: string };
const hqsOf = (v: TurnView): Node[] => Object.entries(v.command?.hqs ?? {}).map(([id, h]) => ({ id, ...h }));

/** Штабы, которые могут быть пунктом управления на уровне (Ставка — одна). */
export function issuers(v: TurnView, level: LevelId): Node[] {
  return hqsOf(v).filter((h) => h.echelon === ISSUER[level]);
}

/** Получатели — прямые подчинённые штаба пункта: штабы и дивизии (выбывшие — нет). */
export function recipients(v: TurnView, issuer: string): Node[] {
  const hqs = hqsOf(v).filter((h) => h.parent === issuer);
  const divs = v.own.filter((u) => u.echelon === 'division' && u.parent === issuer && u.status !== 'destroyed')
    .map((u) => ({ id: u.id, name: u.name, echelon: 'division', parent: u.parent }));
  return [...hqs, ...divs];
}

/**
 * Штаб под управлением игрока: взят или взятие в очереди этого хода (команды ядро исполняет по порядку — «взять» раньше
 * директивы); «вернуть» в очереди — уже не под управлением.
 */
export function taken(v: TurnView, id: string, cmds: CommandOp[] = []): boolean {
  let on = v.command?.hqs[id]?.control === 'player';
  for (const c of cmds) { if (c.op === 'take' && c.hq === id) on = true; if (c.op === 'release' && c.id === id) on = false; }
  return on;
}

/** Кто отдаёт: верхняя инстанция (from нет) или взятый игроком штаб; не взятый — Ставка через голову. */
export function sender(v: TurnView, issuer: string, cmds: CommandOp[] = []): { from: string | undefined; overHead: boolean } {
  const h = v.command?.hqs[issuer];
  if (!h || h.echelon === 'high_command') return { from: undefined, overHead: false };
  return taken(v, issuer, cmds) ? { from: issuer, overHead: false } : { from: undefined, overHead: true };
}

/** Заголовок пункта: кто отдаёт приказы. */
export function postTitle(v: TurnView, issuer: string, cmds: CommandOp[] = []): string {
  const h = v.command?.hqs[issuer];
  if (!h) return '';
  if (h.echelon === 'high_command') return h.name;
  return sender(v, issuer, cmds).overHead
    ? `Штаб: ${h.name} — ведёт агент; приказ его подчинённым — от ${v.terms?.topGen ?? 'Ставки'} через голову (ПУ-39 ст. 93)`
    : `Штаб: ${h.name} — взят под управление`;
}

const hourOf = (start: string, t: string) => Math.round((Date.parse(`${t.slice(0, 16)}:00Z`) - Date.parse(`${start.slice(0, 16)}:00Z`)) / 3600e3);

/** Директива для ядра (game::PlayerDirective): пустые поля не передаются, сроки — часы от начала операции. */
export function toDirective(d: DirDraft, v: TurnView, from?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { to: d.to, task: d.task, form: d.form };
  if (from) out.from = from;
  if (d.axis.length >= 2) out.axis = d.axis;
  if (d.immediate.length) { out.immediate = d.immediate; if (d.immediateBy) out.immediateBy = hourOf(v.start, d.immediateBy); }
  if (d.subsequent.length) { out.subsequent = d.subsequent; if (d.subsequentBy) out.subsequentBy = hourOf(v.start, d.subsequentBy); }
  const b = d.boundaries.filter((l) => l.length >= 2).map((line) => ({ line }));
  if (b.length) out.boundaries = b;
  if (d.mainBlow.length) out.mainBlow = d.mainBlow;
  if (d.reserve.length) out.reserve = d.reserve;
  if (d.junction) out.junction = d.junction;
  if (d.echelon) out.echelon = d.echelon;
  if (d.commit) out.commit = true;
  if (d.note.trim()) out.note = d.note.trim();
  return out;
}

/** Чего не хватает, чтобы отдать: наступать, выдвигаться, отходить — с рубежом или осью; срок — не раньше хода (now). */
export function missing(d: DirDraft, now?: string): string[] {
  const moving = d.task === 'attack' || d.task === 'move' || d.task === 'withdraw';
  const out = moving && !d.immediate.length && d.axis.length < 2 ? ['рубеж ближайшей задачи или ось'] : [];
  const early = (t?: string) => !!(t && now && t.slice(0, 16) < now.slice(0, 16));
  if (early(d.immediateBy) || early(d.subsequentBy)) out.push('срок не раньше начала хода');
  return out;
}

/** Слова советской стороны — словами стороны игрока (ОКХ, группа армий). */
export function local(s: string, v: TurnView): string {
  const t = v.terms;
  return t ? s.replace(/Ставки/g, t.topGen).replace(/Ставка/g, t.top) : s;
}

/**
 * Перед отправкой хода: от чьего имени уходит каждая директива пункта управления — ближайший начальник получателя,
 * взятый игроком к концу очереди (с учётом «взять» и «вернуть» этого хода); никого — верхняя инстанция (через голову).
 * Взять и вернуть ставятся раньше директив: ядро исполняет команды по порядку.
 */
export function resolveFrom(v: TurnView, cmds: CommandOp[]): CommandOp[] {
  const hqs = v.command?.hqs ?? {};
  const parentOf = (id: string) => hqs[id]?.parent ?? v.own.find((u) => u.id === id)?.parent ?? null;
  const control = cmds.filter((c) => c.op === 'take' || c.op === 'release');
  const rest = cmds.filter((c) => c.op !== 'take' && c.op !== 'release');
  return [...control, ...rest.map((c) => {
    if (c.op !== 'directive') return c;
    const { issuer: _issuer, from: _from, ...d } = c.directive as typeof c.directive & { issuer?: string };
    let from: string | undefined;
    for (let x = parentOf(d.to), n = 0; x && n < 8; x = parentOf(x), n++) {
      if (hqs[x]?.echelon === 'high_command') break;
      if (taken(v, x, cmds)) { from = x; break; }
    }
    return { op: 'directive' as const, directive: from ? { ...d, from } : d };
  })];
}

/** Задача нынешней модели (советник, проекты приказов) → задача документа пункта управления. */
export function dirTaskOf(t: string): DirTask {
  switch (t) {
    case 'attack': case 'counterattack': case 'breakout': case 'relieve': return 'attack';
    case 'defend': case 'hold': return 'defend';
    case 'delay': return 'delay';
    case 'withdraw': return 'withdraw';
    case 'reserve': return 'reserve';
    default: return 'move';
  }
}

/** Приказ, предложенный советником, → проект документа пункта: цель — пункт ближайшей задачи, обоснование — указания. */
export function suggestionToDir(s: { formation: string; task: string; at: LngLat | null; why: string }, level: LevelId): DirDraft {
  return { ...blankDir(s.formation, level), task: dirTaskOf(s.task), immediate: s.at ? [s.at] : [], note: s.why ?? '', noteAuto: !s.why };
}

/** Пункт управления для советника: кто решает, его подчинённые, каким документом, через голову ли. */
export interface PostContext { level: LevelId; issuer: string; issuerName: string; recipients: { id: string; name: string }[]; doc: string; overHead: boolean; topGen: string }
export function postContext(v: TurnView, level: LevelId, issuer: string, cmds: CommandOp[] = []): PostContext {
  return {
    level, issuer, issuerName: v.command?.hqs[issuer]?.name ?? issuer,
    recipients: recipients(v, issuer).map((x) => ({ id: x.id, name: x.name })),
    doc: DOC_TITLE[level], overHead: sender(v, issuer, cmds).overHead, topGen: v.terms?.topGen ?? 'Ставки',
  };
}

/** Указание советнику: за чей штаб он думает и кому отдавать приказы. */
export function postPrompt(c: PostContext): string {
  return `Пункт управления: ${c.issuerName}. Вы — офицер этого штаба: оценка, замысел и решение — решение ${c.issuerName}; `
    + `приказы — только подчинённым этого штаба: ${c.recipients.map((x) => x.name).join(', ') || 'нет'} (документ — «${c.doc}»${c.overHead ? `, от ${c.topGen} через голову` : ''}). `
    + 'Обстановку соседей и старших учитывайте, но приказов им не отдавайте.';
}
