/**
 * Этап 0: проверка локальной модели на контрольных обстановках.
 *
 *   npm run llm:eval -- [--url http://localhost:1234/v1] [--model a,b] [--thinking off,medium]
 *                       [--repeat 2] [--only 01,04] [--out evals-out]
 *
 * Для каждой модели × режима размышления × обстановки × повтора: запрос
 * немецкому штабу, замер скорости, формальная проверка, признаки ожидаемого
 * решения. Итог — отчёт Markdown (для оценки экспертами) и JSON со всеми
 * ответами в каталоге evals-out/<время>/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LlmClient, LlmUnavailable, type ChatResult } from '../llm/client';
import { configFromEnv, type Thinking } from '../llm/config';
import { DECISION_SCHEMA, checkDecision, type Decision, type Issue } from '../decision';
import { prompt } from '../prompts';
import { loadSituations, matches, promptVars, type Situation } from './situations';
import { renderReport } from './report';

export interface RunRecord {
  situation: string;
  model: string;
  thinking: Thinking;
  attempt: number;
  ok: boolean;
  error?: string;
  timings?: ChatResult['timings'];
  reasoningChars: number;
  decision?: Decision;
  raw?: string;
  issues: Issue[];
  expect: { id: string; text: string; hit: boolean }[];
  avoid: { id: string; text: string; hit: boolean }[];
}

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); out[k] = v ?? argv[++i] ?? ''; }
  }
  return out;
}

export async function runOne(client: LlmClient, s: Situation, model: string, thinking: Thinking, attempt: number,
  onDelta?: (kind: 'reasoning' | 'content', t: string) => void): Promise<RunRecord> {
  const rec: RunRecord = { situation: s.id, model, thinking, attempt, ok: false, reasoningChars: 0, issues: [], expect: [], avoid: [] };
  const messages = [
    { role: 'system' as const, content: prompt('german-staff.system.md', {}) },
    { role: 'user' as const, content: prompt('german-staff.user.md', promptVars(s)) },
  ];
  let res: ChatResult;
  try {
    const c = new LlmClient({ ...client.config, model });
    res = await c.chat({ messages, schema: { name: 'german_staff_decision', schema: DECISION_SCHEMA }, thinking, onDelta });
  } catch (e) {
    rec.error = (e as Error).message;
    return rec;
  }
  rec.timings = res.timings;
  rec.reasoningChars = res.reasoning.length;
  rec.raw = res.content;
  if (res.jsonError) { rec.error = `ответ не разобран: ${res.jsonError}`; return rec; }
  const { decision, issues } = checkDecision(res.json, { formations: s.own_forces.map((f) => f.name), areas: s.areas });
  rec.issues = issues;
  if (!decision) { rec.error = 'ответ не прошёл формальную проверку'; return rec; }
  rec.ok = true;
  rec.decision = decision;
  rec.expect = s.expect.map((e) => ({ id: e.id, text: e.text, hit: matches(e, decision) }));
  rec.avoid = s.avoid.map((e) => ({ id: e.id, text: e.text, hit: matches(e, decision) }));
  return rec;
}

export async function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  const env = { ...process.env };
  if (a.url) env.DEFOPS_LLM_URL = a.url;
  const config = configFromEnv(env);
  const client = new LlmClient(config);

  let available: string[];
  try { available = await client.models(); } catch (e) {
    if (e instanceof LlmUnavailable) {
      console.error(`✗ ${e.message}\n  Запустите LM Studio → Developer → Start Server (порт 1234) и загрузите модель.`);
      process.exit(2);
    }
    throw e;
  }
  const models = a.model ? a.model.split(',') : [await client.resolveModel()];
  for (const m of models) if (!available.includes(m)) console.warn(`! модели «${m}» нет среди загруженных: ${available.join(', ')}`);
  const thinkings = (a.thinking ? a.thinking.split(',') : [config.thinking]) as Thinking[];
  const repeat = Math.max(1, Number(a.repeat ?? 1));
  const only = a.only ? a.only.split(',') : null;
  const situations = loadSituations().filter((s) => !only || only.some((o) => s.id.startsWith(o)));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(a.out ?? 'evals-out', stamp);
  mkdirSync(out, { recursive: true });

  console.log(`Модели: ${models.join(', ')} · размышление: ${thinkings.join(', ')} · обстановок: ${situations.length} · повторов: ${repeat}`);
  const records: RunRecord[] = [];
  for (const model of models) for (const thinking of thinkings) for (const s of situations) for (let i = 1; i <= repeat; i++) {
    process.stdout.write(`▸ ${model} · ${thinking} · ${s.id} #${i} `);
    let n = 0;
    const rec = await runOne(client, s, model, thinking, i, () => { if (++n % 40 === 0) process.stdout.write('.'); });
    records.push(rec);
    const t = rec.timings;
    const hits = rec.expect.filter((e) => e.hit).length;
    console.log(rec.ok
      ? ` ✓ ${(t!.totalMs / 1000).toFixed(0)} с (первый токен ${(t!.firstTokenMs / 1000).toFixed(1)} с, ${t!.tokensPerSec} ток/с) · признаков ${hits}/${rec.expect.length}${rec.avoid.some((x) => x.hit) ? ' · ⚠ нежелательное решение' : ''}`
      : ` ✗ ${rec.error}`);
    writeFileSync(join(out, 'results.json'), JSON.stringify({ config: { ...config, models, thinkings, repeat }, records }, null, 2));
  }
  const report = renderReport(records, situations, { models, thinkings, repeat, url: config.url, date: new Date() });
  writeFileSync(join(out, 'report.md'), report);
  console.log(`\nОтчёт: ${join(out, 'report.md')}\nВсе ответы: ${join(out, 'results.json')}`);
}
