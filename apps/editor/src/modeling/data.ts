/**
 * Данные раздела «Моделирование»: каталог операций (встроенные и свои), наборы правил (встроенные и свои)
 * с описаниями, общий пул потоков для прогонов. Обновляются при любом изменении своих данных.
 */
import { useEffect, useState } from 'react';
import type { CatalogEntry, Rules, SideProfile } from '@def-ops/sim';
import { BUILTIN, BUILTIN_CATALOG, fullCatalog, getData, listOperations, listRules, onDataChange, type UserOperation, type UserRules } from '../sim/userdata';
import { ModelPool } from '../sim/pool';

export interface RulesItem { id: string; title: string; user: boolean; rules: Rules; saved?: UserRules }

let pool: ModelPool | null = null;
export const getPool = () => (pool ??= new ModelPool());
export const resetPool = () => { pool?.stop(); pool = null; };

/** Название встроенного набора — как в каталоге переигровки. */
function builtinTitle(id: string) {
  for (const c of BUILTIN_CATALOG) { const r = c.rules.find((x) => x.id === id); if (r) return `${r.title} (${c.title.split(',')[0]})`; }
  return ({ 'ww2-berlin-terr': 'с ведением территории (опыт)', 'ww2-draft': 'исходные (до калибровки)' } as Record<string, string>)[id] ?? id;
}

export interface SimData {
  catalog: (CatalogEntry & { custom?: boolean })[];
  rules: RulesItem[];
  profiles: SideProfile[];
  ops: UserOperation[];
  ready: boolean;
}

export function useSimData(): SimData {
  const [d, setD] = useState<SimData>({ catalog: BUILTIN_CATALOG, rules: [], profiles: [], ops: [], ready: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [catalog, user, ops] = await Promise.all([fullCatalog(true), listRules(), listOperations()]);
      const builtin = await Promise.all(BUILTIN.rules.map(async (id) => {
        let r = (await getData('rules', `${id}.json`)) as Rules;
        if (r.extends) { const { rulesFrom } = await import('@def-ops/sim'); r = await rulesFrom(getData, id); }
        return { id, title: builtinTitle(id), user: false, rules: r } satisfies RulesItem;
      }));
      const profiles = await Promise.all(BUILTIN.profiles.map(async (id) => (await getData('profiles', `${id}.json`)) as SideProfile));
      if (alive) setD({ catalog, rules: [...builtin, ...user.map((u) => ({ id: u.id, title: u.title, user: true, rules: u.rules, saved: u }))], profiles: [...profiles, ...ops.flatMap((o) => o.pkg.profiles ?? [])], ops, ready: true });
    };
    void load();
    const off = onDataChange(() => void load());
    return () => { alive = false; off(); };
  }, []);
  return d;
}

/** Категориальные цвета серий (по порядку, не по рангу): синий, оранжевый, бирюзовый, жёлтый. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
export const MAX_SERIES = SERIES.length;

export const fmtDays = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
export const dayClass = (d: number | null) => (d == null ? 'miss' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2 ? 'near' : 'off');
export const pct = (x: number) => `${Math.round(x * 100)} %`;
export const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
/** Медиана расхождений по прогонам (null — не случилось в большинстве). */
export function medianDays(days: (number | null)[]): number | null {
  const v = days.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (v.length * 2 < days.length) return null;
  return v[Math.floor(v.length / 2)];
}
export function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
