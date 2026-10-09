/**
 * Поток моделирования: оценка набора правил по истории (прогоны, сравнение положений и дат событий, мерило
 * калибровки). Контекст сценария загружается один раз и переиспользуется. Операция может прийти пакетом
 * (ещё не сохранена) — тогда данные берутся из пакета, остальное — встроенное и своё.
 */
import { contextFrom, evaluateRules, rulesFrom, rulesWith, type DataGetter, type History, type Rules, type SimContext } from '@def-ops/sim';
import { getData } from './userdata';
import type { ModelRequest, ModelResponse } from './model-protocol';

type Loaded = { ctx: SimContext; history: History; get: DataGetter };
const cache = new Map<string, Promise<Loaded>>();

function load(q: ModelRequest) {
  const key = `${q.scenario}|${q.pkg ? 'pkg' : ''}`;
  let c = cache.get(key);
  if (!c) {
    const pkg = q.pkg;
    const get: DataGetter = async (kind, file) => {
      if (pkg) {
        if (kind === 'scenarios' && file === `${pkg.scenario.id}.json`) return pkg.scenario;
        if (kind === 'scenarios' && file === `${pkg.scenario.id}.history.json`) return pkg.history;
        if (kind === 'theatres' && file === `${pkg.theatre.id}.json`) return pkg.theatre;
        const p = kind === 'profiles' ? pkg.profiles?.find((x) => `${x.id}.json` === file) : kind === 'rules' ? pkg.rules?.find((x) => `${x.id}.json` === file) : undefined;
        if (p) return p;
      }
      return getData(kind, file);
    };
    c = contextFrom(get, q.scenario).then(({ ctx, history }) => ({ ctx, history, get }));
    cache.set(key, c);
    if (pkg) c.catch(() => cache.delete(key));
  }
  return c;
}

self.onmessage = async (e: MessageEvent<ModelRequest>) => {
  const q = e.data;
  const post = (m: ModelResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const { ctx, history, get } = await load(q);
    let rules: Rules = typeof q.rules === 'string' ? await rulesFrom(get, q.rules) : q.rules;
    if (q.params) rules = rulesWith(rules, q.params);
    const r = evaluateRules(ctx, rules, history, { seeds: q.seeds, seed0: q.seed0, trainUntil: q.trainUntil, toleranceKm: q.toleranceKm });
    post({ id: q.id, ok: true, result: r });
  } catch (err) {
    post({ id: q.id, ok: false, error: (err as Error).message ?? String(err) });
  }
};
