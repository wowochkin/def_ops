/**
 * Посредник на модели: становится ли симуляция реалистичнее? Исторические прогоны (обе стороны — по
 * историческим приказам) без посредника и с ним; сравнение с историей (положения в допуске, даты ключевых
 * событий) и с нормативами опыта войны (sim:norms). Посредник получает справки из базы знаний (доктрина,
 * нормативы, техника — без хода боёв: это была бы подсказка исхода).
 *
 *   npm run llm:umpire -- [--scenario berlin-1945-tasks,vistula-oder-1945] [--seeds 1] [--thinking off] [--out evals-out/umpire]
 *
 * Модель — как у остальных проверок (DEFOPS_LLM_URL, DEFOPS_LLM_MODEL; LM Studio на этом компьютере).
 * Висло-Одерская — контрольная: посредник полезен, только если она не хуже.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEvents, compareWithHistory, evaluateNorms, fmtNorm, NORM_MARK, runScenario, runScenarioWith, summarize, UMPIRE_FACTOR_RU, type NormTable, type RunResult, type SimContext, type UmpireMod } from '@def-ops/sim';
import { loadContext, loadHistory, loadNorms } from '@def-ops/sim/data';
import { category, gather, Index, type Entry } from '@def-ops/knowledge';
import { LlmClient } from '../llm/client';
import { configFromEnv, type Thinking } from '../llm/config';
import { umpireTurn, type UmpireRef, type UmpireTurn } from '../live/umpire';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenarios = opt('scenario', 'berlin-1945-tasks,vistula-oder-1945')!.split(',');
const seeds = Number(opt('seeds', '1'));
const thinking = opt('thinking', 'off') as Thinking;
const out = resolve(opt('out', `evals-out/umpire/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)!);
const TOL: Record<string, number> = { 'berlin-city-1945': 2 };

// база знаний: начальное наполнение (слой пользователя — в браузере)
const entries = (JSON.parse(readFileSync(join(ROOT, 'packages/knowledge/data/seed.json'), 'utf8')) as { entries: Entry[] }).entries;
const byId = new Map(entries.map((e) => [e.id, e]));
const index = new Index(entries);
const safe = (e: Entry | null) => !!e && e.group !== 'model' && e.category !== 'sources' && !!category(e.category)?.gameSafe;
async function refsFor(queries: string[]): Promise<UmpireRef[]> {
  const out = new Map<string, UmpireRef>();
  for (const q of queries) for (const s of gather(index, byId, q, { limit: 3, pool: 400, filter: (e) => safe(e) })) if (!out.has(s.ref)) out.set(s.ref, { id: s.ref, title: s.title, text: s.text.slice(0, 900) });
  return [...out.values()];
}

const tpl = { system: readFileSync(join(ROOT, 'services/staff/prompts/umpire.system.md'), 'utf8'), user: readFileSync(join(ROOT, 'services/staff/prompts/umpire.user.md'), 'utf8') };
const client = new LlmClient({ ...configFromEnv(process.env), thinking });

interface Variant { runs: RunResult[]; turns: UmpireTurn[]; sec: number }
const result = new Map<string, { ctx: SimContext; base: Variant; ump: Variant }>();

const model = await client.resolveModel().catch((e: Error) => { console.error(`модель недоступна: ${e.message}`); process.exit(2); });
console.log(`Посредник: модель ${model}, размышление ${thinking}; сценарии ${scenarios.join(', ')}; seed 1–${seeds}`);
for (const id of scenarios) {
  const ctx = loadContext(id);
  let t0 = Date.now();
  const base: Variant = { runs: Array.from({ length: seeds }, (_, i) => runScenario(ctx, i + 1)), turns: [], sec: 0 };
  base.sec = Math.round((Date.now() - t0) / 1000);
  t0 = Date.now();
  const ump: Variant = { runs: [], turns: [], sec: 0 };
  for (let k = 1; k <= seeds; k++) {
    const r = await runScenarioWith(ctx, k, async (s) => {
      const t = await umpireTurn(client, ctx, s, refsFor, tpl, { thinking });
      ump.turns.push(t);
      process.stdout.write(`\r  ${id} seed ${k}: ${s.time.slice(5, 16)} боёв ${t.engagements}, поправок ${t.mods.length}${t.ok ? '' : ` (ошибка: ${t.error?.slice(0, 60)})`}        `);
      return t.mods;
    });
    ump.runs.push(r);
  }
  ump.sec = Math.round((Date.now() - t0) / 1000);
  console.log('');
  result.set(id, { ctx, base, ump });
}

// метрики
const metrics = (id: string, v: Variant) => {
  const { ctx } = result.get(id)!;
  const h = loadHistory(id);
  const within = v.runs.map((r) => summarize(compareWithHistory(ctx, r, h), TOL[id] ?? 10).within);
  const ev = v.runs.map((r) => checkEvents(ctx, r, h));
  const inTime = ev.map((e) => e.filter((x) => x.days != null && Math.abs(x.days) <= 2).length);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return { within: mean(within), events: mean(inTime), total: ev[0]?.length ?? 0, absDays: mean(ev.flatMap((e) => e.map((x) => (x.days == null ? 5 : Math.min(5, Math.abs(x.days)))))) };
};
const table = loadNorms() as NormTable;
const usable: NormTable = { norms: table.norms.filter((n) => !('scenario' in n.measure) || scenarios.includes(n.measure.scenario)) };
const norms = (key: 'base' | 'ump') => evaluateNorms(usable, (s) => result.get(s)?.ctx ?? loadContext(s), (s) => result.get(s)?.[key].runs ?? []);
const nb = norms('base'), nu = norms('ump');

const pct = (x: number) => `${Math.round(x * 100)} %`;
const L: string[] = [
  '# Посредник на модели: с ним и без него',
  '',
  `Модель ${model}, размышление ${thinking}; прогонов на сценарий: ${seeds}; ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.`,
  'Обе стороны действуют по историческим приказам; посредник перед каждым ходом даёт поправки к ожидаемым боям (пределы — 0,8–1,25) по справкам из базы знаний.',
  '',
  '## Сверка с историей',
  '',
  '| Сценарий | Положения в допуске: без / с посредником | События ±2 сут: без / с | Средняя ошибка дат, сут: без / с | Время, с: без / с |',
  '|---|---|---|---|---|',
  ...scenarios.map((id) => {
    const r = result.get(id)!, a = metrics(id, r.base), b = metrics(id, r.ump);
    return `| ${r.ctx.scenario.name ?? id} | ${pct(a.within)} / **${pct(b.within)}** | ${a.events.toFixed(1)} / **${b.events.toFixed(1)}** из ${a.total} | ${a.absDays.toFixed(2)} / **${b.absDays.toFixed(2)}** | ${r.base.sec} / ${r.ump.sec} |`;
  }),
  '',
  '## Нормативы опыта войны',
  '',
  '| Норматив | Ожидаемо | Без посредника | С посредником |',
  '|---|---|---|---|',
  ...nb.map((x, i) => `| ${x.norm.title} | ${x.norm.expect ? `${fmtNorm(x.norm.expect[0])}–${fmtNorm(x.norm.expect[1])} ${x.norm.unit}` : '—'} | ${x.verdict === 'none' ? '' : x.text + ' '}${NORM_MARK[x.verdict]} | ${nu[i].verdict === 'none' ? '' : nu[i].text + ' '}${NORM_MARK[nu[i].verdict]} |`),
  '',
  `В пределах: без посредника ${nb.filter((x) => x.verdict === 'ok').length}, с посредником ${nu.filter((x) => x.verdict === 'ok').length} из ${nb.filter((x) => x.verdict !== 'none').length}.`,
  '',
  '## Что делал посредник',
  '',
];
for (const id of scenarios) {
  const t = result.get(id)!.ump.turns;
  const mods = t.flatMap((x) => x.mods);
  const by = new Map<string, UmpireMod[]>();
  for (const m of mods) by.set(m.factor, [...(by.get(m.factor) ?? []), m]);
  L.push(`### ${result.get(id)!.ctx.scenario.name ?? id}`, '',
    `Ходов ${t.length}, с боями ${t.filter((x) => x.engagements).length}; ошибок модели ${t.filter((x) => !x.ok).length}; поправок ${mods.length}; отброшено/ограничено ${t.reduce((s, x) => s + x.issues.length, 0)}.`, '',
    ...[...by].map(([k, ms]) => `- ${UMPIRE_FACTOR_RU[k as keyof typeof UMPIRE_FACTOR_RU]}: ${ms.length}, средний множитель ${(ms.reduce((s, m) => s + m.mult, 0) / ms.length).toFixed(2)}`), '',
    ...t.filter((x) => x.mods.length).slice(0, 40).flatMap((x) => [`**${x.time.slice(8, 10)}.${x.time.slice(5, 7)} ${x.time.slice(11, 16)}** — ${x.assessment ?? ''}`, ...x.mods.map((m) => `  - ${UMPIRE_FACTOR_RU[m.factor]} ×${m.mult}: ${m.reason} (${m.basis.map((b) => byId.get(b)?.title ?? b).join('; ')})`)]), '');
}
L.push('Вывод делается по контрольной операции: посредник полезен, если улучшает и нормативы, и сверку с историей, а Висло-Одерская не хуже.', '');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.md'), L.join('\n'));
writeFileSync(join(out, 'umpire-log.json'), JSON.stringify(Object.fromEntries(scenarios.map((id) => [id, result.get(id)!.ump.turns])), null, 1));
console.log(L.slice(5, 9 + scenarios.length).join('\n'));
console.log(`отчёт: ${join(out, 'report.md')}`);
