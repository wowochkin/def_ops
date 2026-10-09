/**
 * Калибровка правил арбитра по истории: подбор множителей к правилам так, чтобы
 * прогоны сценария с историческими задачами ближе всего повторяли историю —
 * положения по дням (сверх их неопределённости) и даты ключевых событий.
 * Чтобы не подогнать под всё сразу, мерило считается раздельно: «обучение» —
 * дни до trainUntil, «проверка» — после; подбор идёт только по обучению.
 *
 *   npm run sim:calibrate -- [--scenario berlin-1945-tasks] [--base ww2-draft] [--evals 120] [--seeds 2] [--train-until 1945-04-25]
 *                            [--out packages/sim/data/rules/ww2-berlin-cal.json]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContext, loadHistory, DATA_DIR } from '../../src/data';
import { baseParams, calibratedRules, Calibrator, CALIB_KEYS, rulesWith, scoreRules } from '../../src/calibrate';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenarioId = opt('scenario', 'berlin-1945-tasks');
const evals = Number(opt('evals', '120'));
const seeds = Number(opt('seeds', '2'));
const trainUntil = opt('train-until', '1945-04-25T23:59');
const out = opt('out', join(DATA_DIR, 'rules', 'ww2-berlin-cal.json'));

// подбор — от исходных (некалиброванных) правил, а не от тех, что у сценария по умолчанию (там — уже откалиброванные)
const base = loadContext(scenarioId, opt('base', 'ww2-draft'));
const history = loadHistory(scenarioId);
const score = (p: ReturnType<typeof baseParams>) => scoreRules(base, rulesWith(base.rules, p), history, { seeds, trainUntil });

const t0 = Date.now();
const start = baseParams(base.rules);
const baseline = score(start);
const cal = new Calibrator(start, evals);
cal.report(start, baseline);
console.log(`исходные правила: обучение ${baseline.train} км, проверка ${baseline.test} км, события ${baseline.events} сут, в допуске ${(baseline.within * 100).toFixed(0)} %`);
while (!cal.done) {
  const [p] = cal.next(1);
  const s = score(p);
  if (cal.report(p, s)) console.log(`#${cal.progress}: обучение ${s.train} км, проверка ${s.test} км, события ${s.events} сут, в допуске ${(s.within * 100).toFixed(0)} % — ${CALIB_KEYS.map((k) => `${k} ${p[k].toFixed(2)}`).join(', ')}`);
  if (cal.progress % 20 === 0) console.log(`  … ${cal.progress}/${evals}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
const best = cal.best!;
const rules = calibratedRules(base.rules, best.p, { id: 'ww2-berlin-cal', scenario: scenarioId, evals, seeds, trainUntil, before: baseline, after: best.s });
writeFileSync(out, JSON.stringify(rules, null, 2));
console.log(`\nлучшее: обучение ${baseline.train} → ${best.s.train} км, проверка ${baseline.test} → ${best.s.test} км, события ${baseline.events} → ${best.s.events} сут; ${((Date.now() - t0) / 60000).toFixed(1)} мин\nправила: ${out}`);
