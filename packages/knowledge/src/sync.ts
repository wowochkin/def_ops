/**
 * Сверка базы знаний со сценарием операции — в обе стороны.
 *
 *  - База → сценарий: численность, танки и САУ, орудия формирования в базе (из документов, с источником)
 *    расходятся с цифрами сценария — предложение исправить сценарий. Численность в сценарии боевая (без тылов):
 *    списочная из базы пересчитывается долей боевых войск (как при сборке сценария, раздел 4.1 описания модели).
 *  - Сценарий → база: в базе нет сведений, которыми уже пользуется расчёт (цифры, подчинённость, положения по дням
 *    из истории) — предложение внести их в базу с пометкой, откуда они (оценка стенда — достоверность C).
 *
 * Решает человек; принятое меняет сценарий (слой правок операции) или базу (факты записи формирования).
 */
import { formationEntries } from './coverage';
import type { Entry, Fact, Reliability } from './schema';

export type SyncKey = 'personnel' | 'tanks' | 'guns' | 'parent' | 'path';
export const SYNC_KEY_RU: Record<SyncKey, string> = { personnel: 'численность', tanks: 'танки и САУ', guns: 'орудия и миномёты', parent: 'подчинённость', path: 'боевой путь (положения по дням)' };

/** Доля боевых войск в списочной численности — как в рецептах сценариев (советские фронты 0,6; немецкие армии 0,75). */
export const COMBAT_SHARE: Record<string, number> = { su: 0.6, de: 0.75 };

export interface SyncFormation {
  id: string; name: string; side: string; echelon: string;
  parent?: string | null; parentName?: string;
  personnel?: number; tanks?: number; guns?: number;
  note?: string;
  /** Положения по дням из истории сценария (для боевого пути). */
  positions?: { time: string; place: string; source?: string; reliability?: string }[];
}
export interface SyncInput { operation: { id: string; title: string; start: string; end: string }; formations: SyncFormation[] }

export interface SyncItem {
  /** Устойчивый ключ (для «отклонено»): направление|формирование|сведение. */
  id: string;
  dir: 'toScenario' | 'toKb';
  formation: string; name: string; side: string; key: SyncKey;
  /** Значение в сценарии (число или текст) и в базе. */
  scenario?: number | string; kb?: number;
  /** Для «в сценарий»: новое значение сценария (после пересчёта в боевую численность). */
  value?: number;
  /** Пояснение: как получено значение. */
  how: string;
  /** Факт базы, на котором основано (для «в сценарий»). */
  fact?: Fact & { entry: string };
  /** Для «в базу»: запись, куда добавить (нет — создать), и факты. */
  entry?: string;
  facts?: Fact[];
}

const RANK: Record<string, number> = { A: 3, B: 2, C: 1 };
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Первое число в значении факта (даты дд.мм не в счёт; «85 тыс.» — 85 000). */
export function parseCount(value: string): number | null {
  const v = value.replace(/\b\d{1,2}\.\d{2}(\.\d{2,4})?\b/g, ' ').replace(/ | /g, ' ');
  const m = /(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s*(тыс)?/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/ /g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(m[2] ? n * 1000 : n) : null;
}

/** Дата в значении факта (дд.мм), если есть, — ГГГГ-ММ-ДД года операции. */
function factDate(value: string, year: string): string | null {
  const m = /\b(\d{1,2})\.(\d{2})\b/.exec(value);
  return m ? `${year}-${m[2]}-${m[1].padStart(2, '0')}` : null;
}
/** Численность названа боевой (без тылов) — пересчитывать не нужно. */
const isCombat = (v: string) => /боев|без (резерв|тыл)|kampfst|в бою|штыков/i.test(v);

/** Лучший факт по ключу: на начало операции (без даты или не позже чем через 2 дня), достоверный. */
function bestFact(facts: (Fact & { entry: string })[], start: string): (Fact & { entry: string; n: number })[] {
  const year = start.slice(0, 4), lim = new Date(Date.parse(`${start.slice(0, 10)}T00:00Z`) + 2 * 864e5).toISOString().slice(0, 10);
  return facts
    .map((f) => ({ ...f, n: parseCount(f.value) ?? NaN, d: factDate(f.value, year) }))
    .filter((f) => Number.isFinite(f.n) && f.n > 0 && (!f.d || f.d <= lim) && !/(^|[\s—–-])не (численность|на начало|на \d)/i.test(f.value))
    .sort((a, b) => (RANK[b.reliability ?? 'C'] ?? 0) - (RANK[a.reliability ?? 'C'] ?? 0) || (a.d ? 0 : 1) - (b.d ? 0 : 1));
}

/** Существенное расхождение: больше 5 % и больше порога (люди 500, танки 5, орудия 20). */
const differs = (key: SyncKey, a: number, b: number) => Math.abs(a - b) > Math.max({ personnel: 500, tanks: 5, guns: 20 }[key as 'personnel'] ?? 0, 0.05 * Math.max(a, b));

export function reconcile(input: SyncInput, entries: Entry[]): SyncItem[] {
  const out: SyncItem[] = [];
  const op = input.operation;
  for (const f of input.formations) {
    const found = formationEntries(entries, f);
    const facts = (key: string) => found.flatMap((e) => (e.facts ?? []).filter((x) => x.key === key).map((x) => ({ ...x, entry: e.id })));
    const main = found[0]?.id;
    const scenarioSrc = `scenario:${op.id}`;
    const estimate = `оценка стенда: цифра сценария «${op.title.split(':')[0]}»${f.note ? ` (${f.note})` : ' — доля численности фронта или армии по числу дивизий'}`;

    for (const key of ['personnel', 'tanks', 'guns'] as const) {
      const cur = f[key];
      let cand = bestFact(facts(key), op.start);
      // танки: «САУ: …» отдельным фактом — в сценарии танки и САУ вместе
      let kbN: number | null = null, how = '', basis: (Fact & { entry: string }) | undefined;
      if (key === 'tanks') {
        const tanks = cand.filter((x) => !/^\s*сау/i.test(x.value)), sau = cand.filter((x) => /^\s*сау/i.test(x.value));
        if (tanks.length) { kbN = tanks[0].n + (sau[0]?.n ?? 0); basis = tanks[0]; how = sau.length && !/сау/i.test(tanks[0].value) ? `танки ${fmt(tanks[0].n)} + САУ ${fmt(sau[0].n)}` : `${fmt(tanks[0].n)}`; }
        cand = tanks;
      } else if (cand.length) { basis = cand[0]; kbN = cand[0].n; how = fmt(cand[0].n); }
      if (kbN != null && basis) {
        let value = kbN;
        if (key === 'personnel' && !isCombat(basis.value)) {
          const share = COMBAT_SHARE[f.side] ?? 1;
          value = Math.round(kbN * share);
          how = `в базе ${fmt(kbN)} (списочная) × доля боевых войск ${String(share).replace('.', ',')} = ${fmt(value)}`;
        } else how = `в базе ${how}${key === 'personnel' ? ' (боевая)' : ''}`;
        if (cur != null && differs(key, cur, value)) {
          out.push({ id: `toScenario|${f.id}|${key}`, dir: 'toScenario', formation: f.id, name: f.name, side: f.side, key, scenario: cur, kb: kbN, value, how, fact: basis });
        }
      } else if (cur != null && cur > 0) {
        out.push({ id: `toKb|${f.id}|${key}`, dir: 'toKb', formation: f.id, name: f.name, side: f.side, key, scenario: cur, how: estimate, entry: main,
          facts: [{ key, value: `${fmt(cur)}${key === 'personnel' ? ' — боевая численность' : ''} на ${ddmm(op.start)} (${estimate})`, source: scenarioSrc, reliability: 'C' }] });
      }
    }

    if (f.parentName && !facts('parent').length && f.echelon !== 'front') {
      out.push({ id: `toKb|${f.id}|parent`, dir: 'toKb', formation: f.id, name: f.name, side: f.side, key: 'parent', scenario: f.parentName, how: 'подчинённость в сценарии', entry: main,
        facts: [{ key: 'parent', value: f.parentName, source: scenarioSrc, reliability: 'C' }] });
    }

    // боевой путь: положения по дням из истории сценария (с источниками) → факт «боевой путь»
    const pos = (f.positions ?? []).filter((p) => p.time.slice(0, 10) >= op.start.slice(0, 10) && p.time.slice(0, 10) <= op.end.slice(0, 10));
    if (pos.length >= 2 && !facts('path').length) {
      const byDay = new Map<string, typeof pos[number]>();
      for (const p of pos) if (!byDay.has(p.time.slice(0, 10))) byDay.set(p.time.slice(0, 10), p);
      const days = [...byDay.values()].sort((a, b) => a.time.localeCompare(b.time));
      const srcs = [...new Set(days.map((p) => p.source).filter(Boolean))].slice(0, 4).join('; ');
      const rel = days.reduce<Reliability>((m, p) => ((RANK[p.reliability ?? 'C'] ?? 1) < RANK[m] ? (p.reliability as Reliability) ?? 'C' : m), 'A');
      out.push({ id: `toKb|${f.id}|path`, dir: 'toKb', formation: f.id, name: f.name, side: f.side, key: 'path', scenario: `${days.length} дн.`, how: `положения по дням из истории сценария${srcs ? ` (${srcs})` : ''}`, entry: main,
        facts: [{ key: 'path', value: days.map((p) => `${ddmm(p.time)} — ${p.place}`).join('; '), source: scenarioSrc, reliability: rel, ...(srcs ? { pages: srcs } : {}) }] });
    }
  }
  return out;
}

/** Новая запись формирования для фактов из сценария (если в базе её нет). */
export function formationEntry(op: { id: string }, f: Pick<SyncFormation, 'id' | 'name' | 'side' | 'echelon'>): Entry {
  return {
    id: `u:${op.id}:formations:${f.id}`, category: 'formations', group: f.side === 'de' ? 'de' : 'su', title: f.name, aliases: [f.id], operations: [op.id],
    summary: `${f.name} — действующее формирование операции (запись создана при сверке со сценарием).`, facts: [{ key: 'side', value: f.side === 'de' ? 'Германия' : 'СССР' }, { key: 'echelon', value: f.echelon }],
    status: 'draft', origin: 'user',
  };
}

/* ───────────── положения из документов ───────────── */

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`()]/g, ' ').replace(/[\s\-–—_.]+/g, ' ').trim();
/** Ступень → неопределённость положения по умолчанию, км (главные силы, а не точка). */
export const ECHELON_KM: Record<string, number> = { front: 30, army: 15, corps: 8, division: 5, brigade: 3 };

/**
 * Формирование сценария по названию из документа: точное совпадение, синонимы записей базы (по id сценария),
 * затем — по номеру и роду («8-я гвардейская армия» ↔ «8 гв. А»).
 */
export function matchFormation(name: string, formations: Pick<SyncFormation, 'id' | 'name'>[], entries: Entry[]): string | null {
  const n = norm(name);
  const exact = formations.find((f) => norm(f.name) === n);
  if (exact) return exact.id;
  for (const e of entries) {
    if (e.category !== 'formations' || ![e.title, ...(e.aliases ?? [])].some((a) => norm(a) === n)) continue;
    const f = formations.find((x) => (e.aliases ?? []).includes(x.id));
    if (f) return f.id;
  }
  const key = (x: string) => {
    const s = norm(x);
    const num = /\b(\d+|[ivxlc]+)\b/i.exec(s)?.[1]?.toLowerCase() ?? '';
    const guards = /гв|garde|guards|gds/.test(s);
    const kind = /танк|panzer|tank|\bта\b/.test(s) ? 'tank' : /удар|shock|\bуда\b/.test(s) ? 'shock' : /корпус|korps|corps|\bск\b|\bтк\b|\bмк\b|\bак\b/.test(s) ? 'corps' : /дивиз|division|\bсд\b|\bпд\b/.test(s) ? 'div' : /фронт|front/.test(s) ? 'front' : /арми|armee|army|\bа\b/.test(s) ? 'army' : '';
    return num && kind ? `${num}|${guards}|${kind}` : null;
  };
  const k = key(name);
  if (!k) return null;
  const hits = formations.filter((f) => key(f.name) === k);
  return hits.length === 1 ? hits[0].id : null;
}
