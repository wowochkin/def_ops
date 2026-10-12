/**
 * Разбор обозначений соединений в выписках ЦАМО («260 сд», «60 и 175 сд», «6 гв., 117 гв., 172 и 350 сд»,
 * «11 гв. тк», «77 ск», «309 пд») и сопоставление их с реестром дивизий (docs/sources/berlin-1945-divisions.json).
 * Общий модуль для переписи (census.ts) и геокодирования выписок (geocode-tsamo.ts).
 */

export type Rel = 'A' | 'B' | 'C';
export interface Sub { date: string; front: string | null; army: string | null; corps: string | null; corps_name: string | null; source: string; reliability: Rel; note?: string }
export interface Div {
  id: string; side: 'su' | 'de'; type: string; guards?: boolean; polish?: boolean; kind?: string; ss?: boolean;
  name_ru: string; abbr: string[]; keywords?: string[]; subordination: Sub[]; aliases: string[]; note?: string;
}
export interface Registry { meta: { types: Record<string, string> }; divisions: Div[]; gaps: { area: string; kind: string; text: string }[] }

/** Одно обозначение из группы: «60 и 175 сд» → два, у каждого свой признак «гв.». */
export interface Unit { n: string; guards: boolean; type: string; ss: boolean; label: string }
/** Группа обозначений в тексте: положение в строке и список соединений. */
export interface Token { index: number; end: number; raw: string; units: Unit[] }

export const SU_SUF: Record<string, [string, string]> = { // тип в тексте → [без гв., гв.]
  'сд': ['sd', 'gsd'], 'вдд': ['vdd', 'gvdd'], 'тк': ['tk', 'gtk'], 'мк': ['mk', 'gmk'], 'кд': ['kd', 'gkd'],
  'тбр': ['tbr', 'gtbr'], 'отбр': ['tbr', 'gtbr'], 'ттбр': ['ttbr', 'gttbr'], 'сабр': ['sabr', 'gsabr'], 'мбр': ['mbr', 'gmbr'],
  'УР': ['ur', 'ur'], 'апд': ['apd', 'gapd'], 'адп': ['apd', 'gapd'], 'ад': ['ad', 'gapd'], 'пд': ['pd', 'pd'], 'кбр': ['kbr', 'kbr'], 'кавбр': ['kbr', 'kbr'],
};
export const DE_TYPES = new Set(['пд', 'нгд', 'лпд', 'мд', 'тд', 'пдд', 'пгд', 'дон', 'вдд', 'гд']);
/** Корпуса, которых нет в реестре как агентов: стрелковые и кавалерийские. */
export const CORPS_TYPES = new Set(['ск', 'кк']);

const TYPES = 'сд|вдд|ттбр|отбр|тбр|сабр|мбр|тк|мк|кд|кавбр|кбр|ск|кк|УР|апд|адп|ад|пд|нгд|лпд|мд|тд|пдд|пгд|дон|гд';
/** «60 и 175 сд», «6 гв., 117 гв., 172 и 350 сд», «11 гв. тк», «10 тк СС». */
export const TOKEN = new RegExp(`(?<![\\d.,])(\\d+(?:\\s*гв\\.)?(?:\\s*(?:,|и)\\s*\\d+(?:\\s*гв\\.)?)*)\\s*(гв\\.\\s*)?(${TYPES})(?![а-яА-ЯёЁ])(\\s*СС)?`, 'g');

/** Все группы обозначений в тексте. */
export function parseTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const t = m[3]; const ss = !!m[4];
    const parts = m[1].split(/\s*,\s*|\s+и\s+/).map((p) => /^(\d+)\s*(гв\.)?$/.exec(p.trim())).filter((x): x is RegExpExecArray => !!x);
    // «гв.» после последнего номера относится ко всей группе («79 и 88 гв. сд»), если у остальных номеров
    // «гв.» не проставлено отдельно («118, 58 гв., 15 гв. сд» — 118 сд не гвардейская)
    const explicit = parts.filter((p) => p[2]).length;
    const groupGuards = !!m[2] || (explicit === 1 && !!parts[parts.length - 1]?.[2]);
    const units: Unit[] = [];
    for (const pm of parts) {
      if (pm[1].startsWith('0')) continue;
      const guards = !!pm[2] || groupGuards;
      units.push({ n: pm[1], guards, type: t, ss, label: `${pm[1]} ${guards ? 'гв. ' : ''}${t}${ss ? ' СС' : ''}` });
    }
    if (units.length) out.push({ index: m.index!, end: m.index! + m[0].length, raw: m[0], units });
  }
  return out;
}

export interface Resolved { id: string | null; side: 'su' | 'de' | null; corps?: string }

/** Сопоставление обозначения с реестром: советские по типу и номеру, немецкие по abbr; корпуса (ск, кк) — нормализованный id. */
export function makeResolver(reg: Registry) {
  const suKey = new Map<string, string>(); // «pl|1|pd», «|250|sd» → id
  for (const d of reg.divisions) {
    if (d.side !== 'su') continue;
    const m = /^su_(pl)?(\d+)([a-z]+)$/.exec(d.id);
    if (m) suKey.set(`${m[1] ?? ''}|${m[2]}|${m[3]}`, d.id);
  }
  const abbrSu = new Map<string, string>(); // дополнительные обозначения из реестра («48 сд» для 48 гв. сд)
  for (const d of reg.divisions) if (d.side === 'su') for (const a of d.abbr.slice(1)) abbrSu.set(a, d.id);
  const deAbbr = new Map<string, string>();
  for (const d of reg.divisions) if (d.side === 'de') for (const a of d.abbr) deAbbr.set(a, d.id);

  /**
   * @param enemy — текст о противнике (разведсводка): советские типы не пробуются.
   * Возвращает id дивизии реестра, либо id корпуса (su_77sk, su_7gkk) в поле corps, либо null.
   */
  return (u: Unit, enemy = false): Resolved => {
    const { n, guards, type: t, ss } = u;
    if (!enemy && CORPS_TYPES.has(t)) return { id: null, side: 'su', corps: `su_${n}${guards ? 'g' : ''}${t === 'ск' ? 'sk' : 'kk'}` };
    if (!enemy && !(ss && (t === 'тк' || t === 'мк'))) {
      const suf = SU_SUF[t];
      if (suf) {
        const s = suf[guards ? 1 : 0];
        let id = suKey.get(`|${n}|${s}`) ?? suKey.get(`pl|${n}|${s}`) ?? abbrSu.get(`${n} ${guards ? 'гв. ' : ''}${t}`);
        if (!id && t === 'ад') id = suKey.get(`|${n}|apd`);
        // «10 тк, 5 и 6 мк 1 УФ» — гвардейские корпуса без «гв.»
        if (!id && !guards && (t === 'тк' || t === 'мк')) id = suKey.get(`|${n}|${suf[1]}`);
        if (id) return { id, side: 'su' };
      }
    }
    if (!guards && DE_TYPES.has(t) && (enemy || t !== 'вдд')) {
      const id = deAbbr.get(`${n} ${t}`);
      return { id: id ?? null, side: 'de' };
    }
    return { id: null, side: !enemy && !ss && SU_SUF[t] ? 'su' : null };
  };
}
