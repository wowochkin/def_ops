/**
 * Отчёт проверки модели: сводка по скорости и качеству, затем по каждой
 * обстановке — история, ответы модели и место для оценки эксперта.
 */
import { TASK_RU } from '../decision';
import type { RunRecord } from './run';
import type { Situation } from './situations';

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
const sec = (ms: number) => f1(ms / 1000);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

export function renderReport(records: RunRecord[], situations: Situation[],
  meta: { models: string[]; thinkings: string[]; repeat: number; url: string; date: Date }): string {
  const L: string[] = [];
  const scenarios = [...new Set(situations.map((s) => s.scenario.name))].join(', ');
  const sides = [...new Set(situations.map((s) => s.scenario.side))].join(', ');
  L.push(`# Проверка модели: ${scenarios}`, '', `Модель ведёт сторону: ${sides}.`, '');
  L.push(`${meta.date.toLocaleString('ru-RU')} · сервер ${meta.url} · повторов на обстановку: ${meta.repeat}`, '');
  L.push('Автоматические признаки — подсказка, а не оценка: решение оценивают эксперты (раздел «Оценка эксперта» у каждого ответа).', '');

  L.push('## Сводка', '');
  L.push('| модель | размышление | ответов по схеме | время ответа, с (сред.) | первый токен, с | генерация, ток/с | признаки ожидаемого | нежелательные решения |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const m of meta.models) for (const t of meta.thinkings) {
    const rs = records.filter((r) => r.model === m && r.thinking === t);
    const ok = rs.filter((r) => r.ok);
    const tm = rs.filter((r) => r.timings).map((r) => r.timings!);
    const ex = ok.flatMap((r) => r.expect);
    const av = ok.filter((r) => r.avoid.some((x) => x.hit)).length;
    L.push(`| ${m} | ${t} | ${ok.length}/${rs.length} | ${sec(avg(tm.map((x) => x.totalMs)))} | ${sec(avg(tm.map((x) => x.firstTokenMs)))} | ${f1(avg(tm.map((x) => x.tokensPerSec ?? NaN).filter(Number.isFinite)))} | ${pct(ex.filter((e) => e.hit).length, ex.length)} | ${av} |`);
  }
  L.push('');

  for (const s of situations) {
    const rs = records.filter((r) => r.situation === s.id);
    if (!rs.length) continue;
    L.push(`## ${s.title}`, '');
    L.push(`**${s.moment}**, ${s.role}. ${s.question}`, '');
    if (s.draft) L.push(`_${s.draft}_`, '');
    L.push(`**Что было в истории.** ${s.history}`, '');
    L.push('**Признаки ожидаемого решения:** ' + s.expect.map((e) => e.text).join('; ') + '.', '');
    for (const r of rs) {
      L.push(`### ${r.model} · размышление ${r.thinking} · попытка ${r.attempt}`, '');
      if (r.timings) L.push(`Время ${sec(r.timings.totalMs)} с · первый токен ${sec(r.timings.firstTokenMs)} с · ${r.timings.tokensPerSec ?? '—'} ток/с · промпт ${r.timings.promptTokens ?? '—'} ток., ответ ${r.timings.completionTokens ?? '—'} ток. · размышление ${r.reasoningChars} знаков`
        + (r.timings.draftAccepted != null ? ` · черновых токенов принято ${r.timings.draftAccepted}, отвергнуто ${r.timings.draftRejected ?? 0}` : ''), '');
      if (!r.ok) {
        L.push(`**Ответ не принят:** ${r.error}`, '');
        for (const i of r.issues) L.push(`- ${i.level === 'error' ? '✗' : '!'} ${i.text}`);
        L.push('', `Ответ (${(r.raw ?? '').length} знаков):`, '', '```', (r.raw || '— пусто —').slice(0, 3000), '```');
        if (r.reasoningTail) L.push('', 'Конец размышления:', '', '```', r.reasoningTail, '```');
        L.push('');
        continue;
      }
      const d = r.decision!;
      L.push('**Признаки:** ' + r.expect.map((e) => `${e.hit ? '✓' : '✗'} ${e.text}`).join(' · ')
        + (r.avoid.length ? ' · ' + r.avoid.map((e) => `${e.hit ? '⚠' : '✓'} не: ${e.text}`).join(' · ') : ''), '');
      if (r.repaired) L.push('_Ответ пришёл не в формате JSON; решение переписано в JSON повторным запросом (без нового размышления)._', '');
      if (r.jsonFromReasoning) L.push('_JSON найден в тексте размышления, а не в ответе._', '');
      if (r.issues.length) L.push('**Замечания проверки:** ' + r.issues.map((i) => i.text).join('; '), '');
      L.push('**Оценка обстановки**', '', d.assessment, '');
      L.push(`**Замысел противника.** ${d.enemyIntent}`, '');
      L.push(`**Замысел.** ${d.intent}`, '');
      L.push('| формирование | задача | район | куда | срок | подробности |', '|---|---|---|---|---|---|');
      for (const o of d.orders) L.push(`| ${cell(o.formation)} | ${TASK_RU[o.task] ?? o.task} | ${cell(o.area)} | ${cell(o.toArea ?? '—')} | ${cell(o.deadline)} | ${cell(o.details)} |`);
      L.push('');
      if (d.requests.length) L.push('**Доклады и просьбы наверх:**', ...d.requests.map((x) => `- ${x}`), '');
      if (d.risks.length) L.push('**Риски:**', ...d.risks.map((x) => `- ${x}`), '');
      L.push(`**Оценка эксперта:** реалистичность __ /5 · ${s.scenario.grading} __ /5 · исполнимость __ /5 · качество доклада __ /5`, '', 'Комментарий: ', '');
    }
  }
  return L.join('\n');
}
