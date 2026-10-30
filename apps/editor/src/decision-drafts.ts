/**
 * Черновики полей решения по обстановке хода (без модели): оценка обстановки, замысел противника, решение, риски,
 * боевое донесение. Обстановка — штаба пункта управления: его подчинённые, противник в его полосе, документы, которые
 * он отдаёт на этот ход. Тексты — короткие, по-штабному; их правят, а не принимают как есть. Без React.
 */
import { groupManning, type IntelReport, type UnitReport } from '@def-ops/sim';
import { manningText } from './num-format';
import type { HumanDecision, TurnView } from './sim/game-protocol';

export type DraftField = 'assessment' | 'enemyIntent' | 'intent' | 'risks' | 'report';
export const DRAFT_FIELDS: DraftField[] = ['assessment', 'enemyIntent', 'intent', 'risks', 'report'];

export interface DraftScope {
  /** Кто решает: «8-я гвардейская армия», «Ставка». */
  who: string;
  /** Свои: подчинённые штаба (доклады). */
  own: UnitReport[];
  /** Противник в полосе штаба. */
  intel: IntelReport[];
  /** Документы и приказы на этот ход словами: «4 гв. ск — наступать на Зелов». */
  plans: string[];
}

const hhmm = (t: string) => t.slice(11, 16);
const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const next = (t: string, h: number) => new Date(Date.parse(`${t}:00Z`) + h * 3600_000).toISOString().slice(0, 16);
/** Короткое имя без пояснения в скобках. */
const nm = (s: string) => s.replace(/\s*\(.*?\)\s*/g, ' ').trim();
/** Список: до n имён, остальное — «и ещё k». */
const list = (xs: string[], n = 4) => (xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} и ещё ${xs.length - n}`);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const sent = (s: string) => { const x = s.trim(); return !x ? '' : /[.!?…]$/.test(x) ? x : `${x}.`; };
const active = (s: DraftScope) => s.own.filter((u) => u.status === 'active');
/** Место без исходного написания в скобках: «у Платков (Platkow)» → «у Платков». */
const pl = (s: string) => s.replace(/\s*\([^)]*\)/g, '').trim();
/** Места без повторов. */
const places = (xs: { place: string }[], n = 3) => [...new Set(xs.map((x) => pl(x.place)).filter(Boolean))].slice(0, n);

function ownLine(s: DraftScope): string {
  const a = active(s);
  if (!a.length) return `${s.who}: войск в строю нет.`;
  const by = (p: string) => a.filter((u) => u.posture === p).map((u) => `${nm(u.name)}${u.place ? ` (${pl(u.place)})` : ''}`);
  const parts = [['наступают', by('наступает')], ['обороняются', by('обороняется')], ['на марше', by('на марше')], ['отходят', by('отходит')], ['в резерве', by('в резерве')]]
    .filter(([, x]) => x.length).map(([t, x]) => `${t} — ${list(x as string[], 3)}`);
  return `${s.who}: в строю ${a.length}, укомплектованность ${manningText(groupManning(a))}${parts.length ? `; ${parts.join('; ')}` : ''}.`;
}

function enemyLine(s: DraftScope): string {
  if (!s.intel.length) return 'Противник перед фронтом разведкой не обнаружен.';
  const near = [...s.intel].filter((x) => x.nearest).sort((a, b) => a.nearest!.km - b.nearest!.km).slice(0, 3)
    .map((x) => `${nm(x.name)} (${pl(x.place)}, ${x.nearest!.km < 1 ? 'вплотную к нашим войскам' : `в ${Math.round(x.nearest!.km)} км от наших войск`})`);
  const fresh = s.intel.filter((x) => x.fresh).length;
  return `Противник: перед фронтом ${s.intel.length} соединений${fresh ? `, из них новых за сутки — ${fresh}` : ''}${near.length ? `; ближайшие — ${near.join(', ')}` : ''}.`;
}

/** Бои хода, где участвовали свои войска пункта. */
function battlesLine(v: TurnView, s: DraftScope): string {
  const ids = new Set(s.own.map((u) => u.id));
  const mine = v.battles.filter((b) => b.own.some((o) => ids.has(o.id)) || !ids.size);
  if (!mine.length) return '';
  const by = (o: string[]) => places(mine.filter((b) => o.includes(b.outcome)));
  const out = [
    by(['breakthrough']).length ? `прорыв ${by(['breakthrough']).join(', ')}` : '',
    by(['advance']).length ? `продвижение ${by(['advance']).join(', ')}` : '',
    by(['held']).length ? `бои без продвижения ${by(['held']).join(', ')}` : '',
    by(['repelled']).length ? `атаки отбиты ${by(['repelled']).join(', ')}` : '',
  ].filter(Boolean);
  return out.length ? `За ход: ${out.join('; ')}.` : '';
}

function supplyLine(s: DraftScope): string {
  const a = active(s);
  const cut = a.filter((u) => u.cutOff).map((u) => nm(u.name));
  const ammo = a.filter((u) => u.ammo < 0.3).map((u) => nm(u.name));
  const fuel = a.filter((u) => u.fuel < 0.3 && u.tanks > 0).map((u) => nm(u.name));
  const out = [cut.length ? `отрезаны от подвоза — ${list(cut)}` : '', ammo.length ? `на исходе боеприпасы — ${list(ammo)}` : '', fuel.length ? `на исходе горючее — ${list(fuel)}` : ''].filter(Boolean);
  return out.length ? `Снабжение: ${out.join('; ')}.` : 'Снабжение: перебоев по докладам нет.';
}

export function draftAssessment(v: TurnView, s: DraftScope): string {
  return [`К ${hhmm(v.time)} ${ddmm(v.time)}.`, ownLine(s), battlesLine(v, s), enemyLine(s), supplyLine(s)].filter(Boolean).join('\n');
}

export function draftEnemyIntent(s: DraftScope): string {
  if (!s.intel.length) return 'Сведений о противнике в полосе нет — замысел не вскрыт; нужна разведка.';
  const by = (p: string) => s.intel.filter((x) => x.posture === p);
  const def = by('обороняется'), wd = by('отходит'), att = by('наступает'), mv = [...by('на марше'), ...by('в резерве')];
  const fresh = s.intel.filter((x) => x.fresh);
  const lines = [
    def.length ? `Обороняется ${places(def).join(', ')} (${def.length} соед.)` : '',
    wd.length ? `отходит ${places(wd).join(', ')}` : '',
    att.length ? `контратакует ${places(att).join(', ')}` : '',
    fresh.length ? `подтягивает силы: ${list(fresh.map((x) => nm(x.name)), 3)}` : mv.length ? `держит резервы ${places(mv).join(', ')}` : '',
  ].filter(Boolean);
  const main = att.length > def.length / 2 ? `нанести контрудар ${places(att, 1)[0]}` : wd.length > def.length ? 'оторваться и занять оборону на следующем рубеже' : 'удерживать занимаемые рубежи, вводя резервы на угрожаемых направлениях';
  return `${sent(lines.join('; ').replace(/^./, (c) => c.toUpperCase()))}\nВероятно, намерен ${main}.`;
}

export function draftIntent(v: TurnView, s: DraftScope): string {
  const until = ddmm(next(v.time, v.turnHours));
  if (s.plans.length) return `На ${until}: ${s.plans.join('; ')}.`;
  // одна задача у нескольких — одной строкой: «4 гв. ск, 28 гв. ск — наступать: у Мюнхеберг»
  const by = new Map<string, string[]>();
  for (const u of active(s).filter((x) => x.task)) {
    const k = `${u.task}${u.target && u.target !== 'на месте' ? `: ${pl(u.target)}` : ''}`;
    by.set(k, [...(by.get(k) ?? []), nm(u.name)]);
  }
  const go = [...by].map(([k, who]) => `${who.join(', ')} — ${k}`);
  return go.length ? `На ${until} — продолжать выполнение задач: ${list(go, 5)}.` : `На ${until}: задачи подчинённым не поставлены — укажите главный удар, кто наступает и кто обеспечивает.`;
}

export function draftRisks(s: DraftScope): string {
  const a = active(s);
  const out: string[] = [];
  const cut = a.filter((u) => u.cutOff).map((u) => nm(u.name));
  if (cut.length) out.push(`${list(cut)} — без подвоза: восстановить коммуникации, приоритет подвоза`);
  const weak = a.filter((u) => u.strength < 0.5).map((u) => `${nm(u.name)} (${pct(u.strength)})`);
  if (weak.length) out.push(`обескровлены ${list(weak, 3)} — вывести во второй эшелон или усилить`);
  const tired = a.filter((u) => u.fatigue > 0.7).map((u) => nm(u.name));
  if (tired.length) out.push(`утомлены ${list(tired, 3)} — нужна смена или пауза`);
  const ammo = a.filter((u) => u.ammo < 0.3).map((u) => nm(u.name));
  if (ammo.length) out.push(`мало боеприпасов у ${list(ammo, 3)} — наступление может захлебнуться`);
  const threat = s.intel.filter((x) => x.fresh && x.nearest && x.nearest.km <= 15);
  if (threat.length) out.push(`новые силы противника рядом: ${list(threat.map((x) => `${nm(x.name)} ${pl(x.place)}`), 2)} — возможен контрудар, держать резерв`);
  return out.length ? out.map((x) => sent(x.replace(/^./, (c) => c.toUpperCase()))).join('\n') : 'Существенных угроз по докладам нет; следить за флангами, стыками и подвозом.';
}

export function draftReport(v: TurnView, s: DraftScope, d: HumanDecision): string {
  return [`К ${hhmm(v.time)} ${ddmm(v.time)}: ${ownLine(s).replace(`${s.who}: `, '')}`, battlesLine(v, s), supplyLine(s).startsWith('Снабжение: перебоев') ? '' : supplyLine(s),
    d.intent ? `Решение на ${ddmm(next(v.time, v.turnHours))}: ${sent(d.intent.replace(/^На \d\d\.\d\d\s*(?:[:—–-]\s*)?/, '').replace(/^./, (c) => c.toUpperCase()))}` : ''].filter(Boolean).join('\n');
}

/** Черновик поля по обстановке. */
export function draftField(f: DraftField, v: TurnView, s: DraftScope, d: HumanDecision): string {
  return f === 'assessment' ? draftAssessment(v, s) : f === 'enemyIntent' ? draftEnemyIntent(s) : f === 'intent' ? draftIntent(v, s) : f === 'risks' ? draftRisks(s) : draftReport(v, s, d);
}

/**
 * Решение при открытии хода (без модели): оценка обстановки и донесение — по обстановке всегда (она изменилась);
 * замысел противника, решение и риски — с прошлого хода, если там написаны, иначе по обстановке. Донесение — после
 * решения (в нём решение на следующий ход). auto — поля, составленные сейчас (не перенесённые), для пометки «проверьте».
 */
export function prefillDecision(v: TurnView, s: DraftScope, last: HumanDecision | null): { decision: HumanDecision; auto: DraftField[] } {
  const d: HumanDecision = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '', request: '' };
  const auto: DraftField[] = [];
  for (const f of DRAFT_FIELDS) {
    const kept = f === 'assessment' || f === 'report' ? '' : (last?.[f] ?? '').trim() ? last![f] : '';
    if (kept) d[f] = kept;
    else { d[f] = draftField(f, v, s, d); auto.push(f); }
  }
  return { decision: d, auto };
}

/**
 * Прошлое решение штаба ступени: самое позднее из записанных ходов (turns[].human.posts) — пункт мог не открываться
 * на прошлом ходу, тогда правленое раньше берётся с того хода, где оно было.
 */
export function lastPostDecision(turns: readonly { human?: unknown }[] | undefined, id: string): HumanDecision | null {
  for (let i = (turns?.length ?? 0) - 1; i >= 0; i--) {
    const d = (turns![i].human as { posts?: Record<string, HumanDecision> } | undefined)?.posts?.[id];
    if (d) return d;
  }
  return null;
}

/** Решение штаба нижней ступени при первом открытии его пункта: есть (правленое или составленное) — не трогать. */
export function ensurePost(m: Record<string, HumanDecision>, issuer: string, make: () => HumanDecision): Record<string, HumanDecision> {
  return m[issuer] ? m : { ...m, [issuer]: make() };
}

/** Поле в винительном падеже — «составил оценку обстановки». */
export const DRAFT_ACC: Record<DraftField, string> = { assessment: 'оценку обстановки', enemyIntent: 'замысел противника', intent: 'решение', risks: 'риски', report: 'донесение' };

/** Вопрос советнику: написать одно поле за штаб пункта (ответ — только текст поля). */
export function fieldPrompt(f: DraftField, s: DraftScope, d: HumanDecision): string {
  const what: Record<DraftField, string> = {
    assessment: 'оценку обстановки: положение своих войск и противника, соотношение сил, местность, снабжение, что изменилось за ход',
    enemyIntent: 'замысел противника: что он, по-видимому, намерен делать — где держит, куда отходит, где готовит контрудар',
    intent: 'решение (замысел действий) на следующий ход: цель, главный удар, кто наступает, кто обеспечивает, куда вводятся резервы',
    risks: 'риски решения: что может пойти не так и как это парировать',
    report: 'боевое донесение вышестоящему: положение войск, итоги хода, решение на следующий ход, просьбы',
  };
  const have = DRAFT_FIELDS.filter((k) => k !== f && d[k]?.trim()).map((k) => `${DRAFT_ACC[k]}: ${d[k].trim()}`);
  return [`Напиши за штаб «${s.who}» ${what[f]}.`, 'Ответь только текстом этого поля решения — по-штабному, коротко (три–шесть предложений), без вступления, заголовков и списков приказов.',
    have.length ? `Уже написано в решении — учти и не противоречь: ${have.join('; ')}.` : '',
    s.plans.length ? `Документы на этот ход: ${s.plans.join('; ')}.` : ''].filter(Boolean).join('\n');
}
