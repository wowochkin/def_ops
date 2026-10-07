/**
 * Этап 0: проверка локальной модели на контрольных обстановках.
 *
 *   npm run llm:eval -- [--url http://localhost:1234/v1] [--model a,b] [--thinking off,medium]
 *                       [--repeat 2] [--scenario berlin-1945] [--only 01,04] [--draft <модель>]
 *                       [--concurrency 4] [--out evals-out]
 *
 * Для каждой модели × режима размышления × обстановки × повтора: запрос
 * штабу стороны, которую ведёт модель, замер скорости, формальная проверка, признаки ожидаемого
 * решения. Итог — отчёт Markdown (для оценки экспертами) и JSON со всеми
 * ответами в каталоге evals-out/<время>/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LlmClient, LlmUnavailable, type ChatResult } from '../llm/client';
import { configFromEnv, type Thinking } from '../llm/config';
import { DECISION_SCHEMA, checkDecision, type Decision, type Issue } from '../decision';
import { prompt } from '../prompts';
import { loadSituations, matches, promptVars, systemVars, type Situation } from './situations';
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
  /** Конец размышления — для разбора неудач. */
  reasoningTail?: string;
  /** Ответ получен повторной просьбой переписать решение в JSON. */
  repaired?: boolean;
  /** Разобранный ответ, даже если формальная проверка не пройдена (для перепроверки). */
  candidate?: unknown;
  /** JSON нашёлся в тексте размышления. */
  jsonFromReasoning?: boolean;
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
    { role: 'system' as const, content: prompt('staff.system.md', systemVars(s)) },
    { role: 'user' as const, content: prompt('staff.user.md', promptVars(s)) },
  ];
  let res: ChatResult;
  try {
    const c = new LlmClient({ ...client.config, model });
    res = await c.chat({ messages, schema: { name: 'staff_decision', schema: DECISION_SCHEMA }, thinking, onDelta });
  } catch (e) {
    rec.error = (e as Error).message;
    return rec;
  }
  rec.timings = res.timings;
  rec.reasoningChars = res.reasoning.length;
  rec.raw = res.content;
  rec.reasoningTail = res.reasoning.slice(-3000);
  rec.jsonFromReasoning = res.jsonFrom === 'reasoning';
  if (res.jsonError && (res.content.trim() || res.reasoning.trim())) {
    // одна попытка исправления: переписать уже принятое решение в JSON, без нового размышления
    try {
      const c = new LlmClient({ ...client.config, model });
      const prev = res.content.trim() || res.reasoning.slice(-12000);
      const fix = await c.chat({
        messages: [...messages, { role: 'assistant', content: prev },
          { role: 'user', content: 'Ответ должен быть одним JSON-объектом по схеме, без текста вокруг. Перепиши своё решение в этот формат, ничего не меняя по существу.' }],
        schema: { name: 'staff_decision', schema: DECISION_SCHEMA }, thinking: 'off',
      });
      if (!fix.jsonError) {
        res = { ...res, json: fix.json, jsonError: undefined, content: fix.content };
        rec.raw = fix.content;
        rec.repaired = true;
        rec.timings = { ...res.timings, totalMs: res.timings.totalMs + fix.timings.totalMs };
      }
    } catch { /* остаётся исходная ошибка */ }
  }
  if (res.jsonError) { rec.error = `ответ не разобран: ${res.jsonError}`; return rec; }
  rec.candidate = res.json;
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
  if (a.draft) env.DEFOPS_LLM_DRAFT_MODEL = a.draft;
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
  const situations = loadSituations(undefined, a.scenario || undefined).filter((s) => !only || only.some((o) => s.id.startsWith(o)));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(a.out ?? 'evals-out', stamp);
  mkdirSync(out, { recursive: true });

  console.log(`Модели: ${models.join(', ')} · размышление: ${thinkings.join(', ')} · обстановок: ${situations.length} · повторов: ${repeat}${config.draftModel ? ` · черновая модель: ${config.draftModel}` : ''}`);
  console.log(`Отчёт обновляется после каждой обстановки: ${join(out, 'report.md')} (Ctrl+C — прервать, готовое сохранится)`);
  const records: RunRecord[] = [];
  // задания прогона; при --concurrency N идут параллельно (сервер обслуживает их пакетом)
  const jobs: { model: string; thinking: Thinking; s: Situation; i: number }[] = [];
  for (const model of models) for (const thinking of thinkings) for (const s of situations) for (let i = 1; i <= repeat; i++) jobs.push({ model, thinking, s, i });
  const concurrency = Math.max(1, Number(a.concurrency ?? 1));
  const total = jobs.length;
  const runStart = Date.now();
  let next = 0;
  const save = () => {
    writeFileSync(join(out, 'results.json'), JSON.stringify({ config: { ...config, models, thinkings, repeat, concurrency }, records }, null, 2));
    writeFileSync(join(out, 'report.md'), renderReport(records, situations, { models, thinkings, repeat, url: config.url, date: new Date() }));
  };
  const worker = async () => {
    while (next < jobs.length) {
      const { model, thinking, s, i } = jobs[next++];
      const label = `${model} · ${thinking} · ${s.id} #${i}`;
      const t0 = Date.now();
      let chunks = 0, phase = 'думает';
      const timer = concurrency === 1 ? setInterval(() => {
        const sec = (Date.now() - t0) / 1000;
        process.stdout.write(`\r▸ ${label} — ${phase}: ${Math.round(sec)} с, ~${chunks} ток. (${(chunks / Math.max(sec, 1)).toFixed(1)} ток/с)   `);
      }, 1000) : null;
      if (concurrency > 1) console.log(`▸ начато: ${label}`);
      const rec = await runOne(client, s, model, thinking, i, (kind) => { chunks++; phase = kind === 'reasoning' ? 'думает' : 'пишет ответ'; });
      if (timer) clearInterval(timer);
      records.push(rec);
      const t = rec.timings;
      const hits = rec.expect.filter((e) => e.hit).length;
      const done = records.length;
      const elapsed = (Date.now() - runStart) / 60000;
      const eta = Math.round((elapsed / done) * (total - done));
      const draft = t?.draftAccepted != null ? ` · черновых принято ${Math.round((100 * t.draftAccepted) / Math.max(1, t.draftAccepted + (t.draftRejected ?? 0)))} %` : '';
      console.log(`${concurrency === 1 ? '\r' : ''}▸ ${label}` + (rec.ok
        ? ` ✓ ${(t!.totalMs / 1000).toFixed(0)} с (первый токен ${(t!.firstTokenMs / 1000).toFixed(1)} с, ${t!.tokensPerSec} ток/с${draft}) · признаков ${hits}/${rec.expect.length}${rec.avoid.some((x) => x.hit) ? ' · ⚠ нежелательное решение' : ''}`
        : ` ✗ ${rec.error}`) + `   [${done}/${total}${done < total ? `, осталось ≈ ${eta} мин` : ''}]`);
      // результат — после каждой обстановки: прерванный прогон не теряется
      save();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  const wall = (Date.now() - runStart) / 1000;
  const tokens = records.reduce((a, r) => a + (r.timings?.completionTokens ?? 0), 0);
  if (concurrency > 1) console.log(`\nПараллельно ${concurrency}: всего ${tokens} ток. за ${wall.toFixed(0)} с — суммарно ${(tokens / wall).toFixed(1)} ток/с`);
  const report = renderReport(records, situations, { models, thinkings, repeat, url: config.url, date: new Date() });
  writeFileSync(join(out, 'report.md'), report);
  console.log(`\nОтчёт: ${join(out, 'report.md')}\nВсе ответы: ${join(out, 'results.json')}`);
}
