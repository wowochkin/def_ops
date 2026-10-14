/**
 * «Основа модели»: на чём держатся входы модели операции — чистые функции для вкладки и записи базы.
 * basisSummary — сколько входов каждого вида держится на фактах A/B/C и сколько на допущениях сценария;
 * factUse — используется ли факт записи в сборке операции (держит вход, перекрыт другим кандидатом, не нужен);
 * claimText — формальная часть факта по-русски.
 */
import type { Claim, CompileConflict, FactRef, Provenance } from '@def-ops/knowledge';

export type BasisKind = 'strength' | 'parent' | 'position' | 'boundary' | 'crossing';
export type RelCount = { A: number; B: number; C: number; assumption: number };
export const BASIS_KINDS: [BasisKind, string][] = [
  ['strength', 'численность и пополнения'], ['parent', 'подчинённость'], ['position', 'положения'], ['boundary', 'разграничительные линии'], ['crossing', 'переправы'],
];

/** Вид формальной части по-русски. */
export const KIND_RU: Record<Claim['kind'] | string, string> = { strength: 'численность', reinforce: 'пополнение', parent: 'подчинённость', enter: 'ввод', position: 'положение', boundary: 'линия', crossing: 'переправа', event: 'событие', losses: 'потери' };

/** Вид входа по его имени ('su_61a.personnel', 'change:3', …); не считается в сводке — null. */
export function basisKindOf(p: Provenance): BasisKind | null {
  const colon = p.input.indexOf(':');
  if (colon > 0) {
    const pre = p.input.slice(0, colon);
    if (pre === 'position' || pre === 'boundary' || pre === 'crossing') return pre;
    // переподчинение по ходу операции — подчинённость; пополнение и контрольные точки — численность
    if (pre === 'change') return p.fact?.fact.claim?.kind === 'parent' ? 'parent' : 'strength';
    if (pre === 'checkpoint') return 'strength';
    return null;
  }
  const field = p.input.slice(p.input.lastIndexOf('.') + 1);
  if (field === 'personnel' || field === 'tanks' || field === 'guns') return 'strength';
  if (field === 'parent') return 'parent';
  return null;
}

/**
 * Сводка: по видам входов — сколько на фактах A, B, C и сколько на допущениях. isInput — читает ли модель поля
 * формирования (действующие формирования сценария с типом, дивизии агентного сценария): поля штабов и фронтов
 * (<id>.personnel|tanks|guns|parent|enterAt) модель не берёт — не считаются. Нет isInput — считаются все.
 */
export function basisSummary(prov: Provenance[], isInput?: (formationId: string) => boolean): Record<BasisKind, RelCount> {
  const out = Object.fromEntries(BASIS_KINDS.map(([k]) => [k, { A: 0, B: 0, C: 0, assumption: 0 }])) as Record<BasisKind, RelCount>;
  for (const p of prov) {
    const k = basisKindOf(p);
    if (!k) continue;
    const dot = p.input.lastIndexOf('.');
    if (isInput && !p.input.includes(':') && dot > 0 && !isInput(p.input.slice(0, dot))) continue;
    out[k][p.reliability]++;
  }
  return out;
}

const same = (f: { entry: string; index: number }, entry: string, index: number) => f.entry === entry && f.index === index;

/** Используется ли факт (запись, номер) в сборке операции. */
export function factUse(entryId: string, index: number, compiled: { provenance: Provenance[]; conflicts: CompileConflict[] }): 'used' | { overriddenBy: FactRef } | 'unused' {
  if (compiled.provenance.some((p) => p.fact && same(p.fact, entryId, index))) return 'used';
  for (const c of compiled.conflicts) {
    if (c.chosen && !same(c.chosen, entryId, index) && c.candidates.some((x) => same(x, entryId, index))) return { overriddenBy: c.chosen };
  }
  return 'unused';
}

/** Дата ISO по-русски: 16.04.1945, с временем — 16.04.1945 06:00. */
export function ruDate(s: string): string {
  const d = `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const t = s.slice(11, 16);
  return t && t !== '00:00' ? `${d} ${t}` : d;
}

const nums = (c: { personnel?: number; tanks?: number; guns?: number }, sign = '') =>
  [['людей', c.personnel], ['танков', c.tanks], ['орудий', c.guns]].filter(([, v]) => typeof v === 'number').map(([t, v]) => `${t} ${sign}${v}`).join(', ');
const CROSSING: Record<Extract<Claim, { kind: 'crossing' }>['state'], string> = { open: 'действует', destroyed: 'разрушена', built: 'наведена' };

/** Формальная часть факта одной строкой; name — название формирования по id. */
export function claimText(c: Claim, name: (id: string) => string = (id) => id): string {
  switch (c.kind) {
    case 'strength': return `численность на ${ruDate(c.at)}: ${nums(c)}`;
    case 'reinforce': return `пополнение ${ruDate(c.at)}: ${nums(c, '+')}`;
    case 'parent': return `подчинён ${name(c.parent)} с ${ruDate(c.from)}`;
    case 'enter': return `ввод в бой ${ruDate(c.at)}`;
    case 'position': return `положение на ${ruDate(c.at)}: ${c.place ?? (c.lngLat ? c.lngLat.map((x) => x.toFixed(3)).join(', ') : '—')}${c.uncertaintyKm ? ` (±${c.uncertaintyKm} км)` : ''}`;
    case 'boundary': return `линия ${name(c.between[0])} — ${name(c.between[1])} с ${ruDate(c.from)}${c.to ? ` по ${ruDate(c.to)}` : ''}: ${c.points.join(' — ')}`;
    case 'crossing': return `переправа ${c.subject}: ${CROSSING[c.state]} с ${ruDate(c.from)}`;
    case 'event': return `событие «${c.title}» ${ruDate(c.at)}${c.place ? `, ${c.place}` : ''}`;
    case 'losses': {
      const parts = [['убитых', c.killed], ['раненых', c.wounded], ['пропавших', c.missing], ['всего', c.total], ['танков', c.tanks]].filter(([, v]) => typeof v === 'number').map(([t, v]) => `${t} ${v}`);
      return `потери ${ruDate(c.from)} — ${ruDate(c.to)}: ${parts.join(', ')}`;
    }
  }
}

/** Ключ расхождения 'kind|subject|moment' → части (subject линии — 'a|b'). */
export function splitKey(key: string): { kind: string; subject: string; moment: string } {
  const parts = key.split('|');
  return { kind: parts[0], subject: parts.slice(1, -1).join('|'), moment: parts[parts.length - 1] };
}
