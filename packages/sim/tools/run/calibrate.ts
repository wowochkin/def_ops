/**
 * Калибровка правил арбитра по истории: подбор множителей к правилам так, чтобы
 * прогоны сценария с историческими задачами ближе всего повторяли историю —
 * положения по дням (сверх их неопределённости) и даты ключевых событий.
 * Чтобы не подогнать под всё сразу, мерило считается раздельно: «обучение» —
 * дни до trainUntil, «проверка» — после; подбор идёт только по обучению.
 * Границы подбора — коридоры нормативов встроенной базы знаний (сборщик «база → правила»; без норматива — прежние
 * границы CALIB_SPACE; --corridors off — только прежние); нормативы-итоги операции (от трёх) входят в мерило с весом
 * 1/8. Набор записывает коридоры, по которым подбирался; отчёт — множитель, коридор, источник, «упирается в границу»,
 * итоги в допуске до и после.
 *
 *   npm run sim:calibrate -- [--scenario berlin-1945-tasks] [--base ww2-draft] [--evals 120] [--seeds 2] [--train-until 1945-04-25]
 *                            [--patch '{"orderPartialTurn":true}'] [--corridors on|off] [--id ww2-berlin-cor]
 *                            [--out packages/sim/data/rules/ww2-berlin-cal.json]
 */
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadContext, loadHistory, DATA_DIR } from '../../src/data';
import { baseParams, calibCorridors, calibratedRules, Calibrator, CALIB_KEYS, corridorReport, rulesWith, scoreRules, spaceOf, type CalibScore } from '../../src/calibrate';
import { seedBasis, seedOutcomeNorms } from './kb-seed';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenarioId = opt('scenario', 'berlin-1945-tasks');
const evals = Number(opt('evals', '120'));
const seeds = Number(opt('seeds', '2'));
const trainUntil = opt('train-until', '1945-04-25T23:59');
const out = opt('out', join(DATA_DIR, 'rules', 'ww2-berlin-cal.json'));
const id = opt('id', basename(out, '.json'));
const useCorridors = opt('corridors', 'on') !== 'off';

// подбор — от исходных (некалиброванных) правил, а не от тех, что у сценария по умолчанию (там — уже откалиброванные)
const base = loadContext(scenarioId, opt('base', 'ww2-draft'));
// правки правил поверх исходных (JSON), например {"orderPartialTurn":true}: подбор множителей — уже с ними
const patch = opt('patch', '');
if (patch) base.rules = { ...base.rules, ...JSON.parse(patch) };
const history = loadHistory(scenarioId);
// основа правил по встроенной базе: коридоры множителей (относительно исходного набора) и нормативы-итоги операции
const basis = seedBasis(base.rules, base.profiles);
const outcomes = seedOutcomeNorms(basis, scenarioId);
const corridors = useCorridors ? calibCorridors(basis.corridors) : undefined;
const score = (p: ReturnType<typeof baseParams>) => scoreRules(base, rulesWith(base.rules, p), history, { seeds, trainUntil, outcomes });
const outText = (s: CalibScore) => (s.outcomes ? `, итоги в допуске ${s.outcomes.items.filter((x) => x.ok).length} из ${s.outcomes.n}` : '');

const t0 = Date.now();
const start = baseParams(base.rules);
const baseline = score(start);
const cal = new Calibrator(start, evals, 2026, CALIB_KEYS, useCorridors ? spaceOf(basis.corridors) : undefined);
console.log(`нормативы-итоги операции: ${outcomes.length}${outcomes.length >= 3 ? ' — в мериле с весом 1/8' : ' — только проверка'}; границы подбора — ${useCorridors ? 'коридоры нормативов базы' : 'прежние (CALIB_SPACE)'}`);
console.log(`исходные правила: обучение ${baseline.train} км, проверка ${baseline.test} км, события ${baseline.events} сут, в допуске ${(baseline.within * 100).toFixed(0)} %${outText(baseline)}`);
// исходные множители вне коридоров — старт у края коридора (его мерило — отдельно)
const moved = CALIB_KEYS.filter((k) => Math.abs(cal.start[k] - start[k]) > 1e-9);
if (moved.length) console.log(`вне коридоров, старт у края: ${moved.map((k) => `${k} ${start[k].toFixed(3)} → ${cal.start[k].toFixed(3)}`).join(', ')}`);
cal.report(cal.start, moved.length ? score(cal.start) : baseline);
while (!cal.done) {
  const [p] = cal.next(1);
  const s = score(p);
  if (cal.report(p, s)) console.log(`#${cal.progress}: обучение ${s.train} км, проверка ${s.test} км, события ${s.events} сут, в допуске ${(s.within * 100).toFixed(0)} %${outText(s)} — ${CALIB_KEYS.map((k) => `${k} ${p[k].toFixed(2)}`).join(', ')}`);
  if (cal.progress % 20 === 0) console.log(`  … ${cal.progress}/${evals}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
const best = cal.best!;
const rules = calibratedRules(base.rules, best.p, { id, scenario: scenarioId, evals, seeds, trainUntil, before: baseline, after: best.s, ...(corridors ? { corridors } : {}) });
writeFileSync(out, JSON.stringify(rules, null, 2));
console.log(`\nлучшее: обучение ${baseline.train} → ${best.s.train} км, проверка ${baseline.test} → ${best.s.test} км, события ${baseline.events} → ${best.s.events} сут${baseline.outcomes ? `; итоги в допуске ${baseline.outcomes.items.filter((x) => x.ok).length} → ${best.s.outcomes?.items.filter((x) => x.ok).length ?? 0} из ${baseline.outcomes.n}` : ''}; ${((Date.now() - t0) / 60000).toFixed(1)} мин\nправила: ${out}`);
console.log('\nмножители (коридор; источник или допущение; ⚠ — упирается в границу: проверьте источник):');
for (const r of corridorReport(best.p, corridors)) {
  const src = r.fact ? `${r.source ?? r.fact}, ${r.reliability ?? '—'}${r.wider ? ', шире прежних границ' : ''}` : 'допущение (прежние границы)';
  console.log(`  ${r.key.padEnd(13)} ${r.value.toFixed(3).padStart(8)}  [${r.range[0].toFixed(3)}–${r.range[1].toFixed(3)}]  ${src}${r.edge ? `  ⚠ упирается в ${r.edge === 'low' ? 'нижнюю' : 'верхнюю'} границу` : ''}`);
}
if (baseline.outcomes) {
  console.log('\nнормативы-итоги (модель до → после; ожидаемо):');
  for (const it of baseline.outcomes.items) {
    const after = best.s.outcomes?.items.find((x) => x.id === it.id);
    console.log(`  ${it.ok ? '✓' : '✗'}→${after?.ok ? '✓' : '✗'} ${it.id.padEnd(24)} ${it.mean ?? '—'} → ${after?.mean ?? '—'} ${it.unit ?? ''}  [${it.expect ? it.expect.join('–') : '—'}]`);
  }
}
