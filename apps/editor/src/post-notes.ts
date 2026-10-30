/**
 * «Указания» в документе пункта управления — составляются по задаче и обстановке, как «Решение» (без модели): задача
 * и сроки, главный удар, соседи справа и слева от оси, противник перед фронтом, подвоз и запасы получателя, эшелон и
 * резерв. Правленые руками указания (noteAuto: false) не пересчитываются. Без React.
 */
import type { LngLat } from '@def-ops/core';
import type { TurnView } from './sim/game-protocol';
import { DIR_TASK_RU, recipients, type DirDraft } from './command-post';
import { km, midpoint } from './post-objects';

export interface NoteOpts { issuer: string; name: (id: string) => string }

const when = (t?: string) => (t ? ` к ${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}` : '');
/** Название пункта без исходного написания в скобках — одно написание у цели и у противника («Зелов», не «Зелов (Seelow)»). */
const plain = (s: string) => s.replace(/\s*\([^)]*\)/g, '').trim();
const what = (pts: LngLat[], title?: string) => (title ? plain(title) : pts.length > 1 ? 'указанный рубеж' : 'указанная точка');

/** Точка цели проекта: ближайшая задача (у рубежа — середина), иначе конец оси. */
function objective(d: DirDraft): LngLat | null {
  if (d.immediate.length) return d.immediate.length === 1 ? d.immediate[0] : midpoint(d.immediate);
  return d.axis.length >= 2 ? d.axis[d.axis.length - 1] : null;
}

/** Соседи получателя того же пункта: ближайший справа и ближайший слева от оси (ось проекта или от места к цели). */
function neighbours(v: TurnView, d: DirDraft, o: NoteOpts, at: LngLat | null): [string | null, string | null] {
  const goal = objective(d);
  const [a, b] = d.axis.length >= 2 ? [d.axis[0], d.axis[d.axis.length - 1]] : [at, goal];
  if (!a || !b) return [null, null];
  const c = Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * c, dy = b[1] - a[1];
  if (!dx && !dy) return [null, null];
  const best: [{ id: string; k: number } | null, { id: string; k: number } | null] = [null, null];
  // соседи — той же ступени, что получатель (армия — армии); других нет — любые получатели пункта
  const subs = recipients(v, o.issuer), all = subs.filter((r) => r.id !== d.to);
  const ech = subs.find((r) => r.id === d.to)?.echelon;
  const same = all.filter((r) => r.echelon === ech);
  for (const r of same.length ? same : all) {
    const u = v.own.find((x) => x.id === r.id && x.status === 'active');
    if (!u) continue;
    const cross = dx * (u.at[1] - a[1]) - dy * (u.at[0] - a[0]) * c;
    if (!cross) continue;
    const side = cross < 0 ? 0 : 1, k = km(a, u.at);
    if (!best[side] || k < best[side]!.k) best[side] = { id: r.id, k };
  }
  return [best[0] ? o.name(best[0].id) : null, best[1] ? o.name(best[1].id) : null];
}

/** Указания по задаче и обстановке — предложения по порядку, пустые пропускаются. */
export function draftNote(v: TurnView, d: DirDraft, o: NoteOpts): string {
  const out: string[] = [];
  const me = v.own.find((u) => u.id === d.to);
  const steps = [
    d.immediate.length ? `ближайшая — ${what(d.immediate, d.immediateTitle)}${when(d.immediateBy)}` : '',
    d.subsequent.length ? `последующая — ${what(d.subsequent, d.subsequentTitle)}${when(d.subsequentBy)}` : '',
  ].filter(Boolean);
  out.push(`Задача — ${DIR_TASK_RU[d.task]}${steps.length ? `: ${steps.join('; ')}` : ''}.`);
  if (d.mainBlow.length) out.push(`Главный удар — ${d.mainBlow.map(o.name).join(', ')}.`);
  const [right, left] = neighbours(v, d, o, me?.at ?? null);
  const sides = [right ? `справа — ${right}` : '', left ? `слева — ${left}` : ''].filter(Boolean).join(', ');
  if (sides) out.push(`${sides[0].toUpperCase()}${sides.slice(1)}.`);
  const goal = objective(d);
  if (goal) {
    const near = (v.intel ?? []).map((e) => ({ e, k: km(goal, e.at) })).filter((x) => x.k <= 15).sort((x, y) => x.k - y.k).slice(0, 3);
    if (near.length) out.push(`Перед фронтом — ${near.map(({ e }) => `${e.name} (${plain(e.place)})`).join(', ')}.`);
  }
  if (me?.cutOff) out.push('Подвоз не доходит — без пополнения.');
  if (me && me.ammo < 0.3) out.push('Боеприпасы на исходе.');
  if (me && me.fuel < 0.3 && me.tanks > 0) out.push('Горючее на исходе.');
  if (d.echelon === 'first') out.push('Первый эшелон.');
  if (d.echelon === 'second') out.push('Второй эшелон — ввод по решению.');
  if (d.commit) out.push('Ввод подвижной группы.');
  if (d.reserve.length) out.push(`Резерв: ${d.reserve.map(o.name).join(', ')}.`);
  return out.join(' ');
}

/** Проект с указаниями: составляемые (noteAuto) — пересчитаны по проекту и обстановке, правленые — как есть. */
export function withNote(d: DirDraft, v: TurnView, o: NoteOpts): DirDraft {
  return d.noteAuto ? { ...d, note: draftNote(v, d, o) } : d;
}
