/**
 * Ответ по частям вживую: приказы печатаются по мере готовности, рядом —
 * секунды от запроса. С --full параллельно идёт полный доклад с размышлением.
 *
 *   npm run llm:quick -- [--model qwen-4bit] [--only 04] [--full]
 */
import { LlmClient } from '../llm/client';
import { configFromEnv } from '../llm/config';
import { TASK_RU } from '../decision';
import { prompt } from '../prompts';
import { quickDecision, fullDecision } from '../staff';
import { loadSituations, promptVars, systemVars } from './situations';

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const env = { ...process.env };
if (arg('url')) env.DEFOPS_LLM_URL = arg('url');
if (arg('model')) env.DEFOPS_LLM_MODEL = arg('model');
const client = new LlmClient(configFromEnv(env));
const s = loadSituations().find((x) => x.id.startsWith(arg('only') ?? '01'))!;
const messages = [
  { role: 'system' as const, content: prompt('staff.system.md', systemVars(s)) },
  { role: 'user' as const, content: prompt('staff.user.md', promptVars(s)) },
];
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} с`;
console.log(`Обстановка: ${s.title} (${s.moment})\n`);

let intentOpen = false;
const quick = quickDecision(client, {
  messages,
  onFirstToken: () => console.log(`${at()}  модель начала отвечать`),
  onIntentDelta: (d) => {
    if (!intentOpen) { intentOpen = true; process.stdout.write(`${at()}  ЗАМЫСЕЛ: `); }
    process.stdout.write(d);
  },
  onIntent: () => { if (intentOpen) process.stdout.write(`\n${at()}  (замысел готов)\n\n`); },
  onOrder: (o, i) => console.log(`${at()}  приказ ${i + 1}: ${o.formation} — ${TASK_RU[o.task] ?? o.task}, ${o.area}${o.toArea ? ` → ${o.toArea}` : ''} (${o.deadline})\n          ${o.details}`),
}).then((r) => console.log(`\n${at()}  быстрая часть готова: ${r.result.timings.completionTokens ?? '?'} ток., ${r.result.timings.tokensPerSec} ток/с`));

const full = argv.includes('--full')
  ? fullDecision(client, { messages }).then((r) => console.log(`${at()}  полный доклад готов: ${r.result.timings.completionTokens ?? '?'} ток. (оценка обстановки ${r.decision?.assessment.length ?? 0} знаков)`))
  : Promise.resolve();

await Promise.all([quick, full]);
