/**
 * «Задание для агента» по операции (кнопки в «Основе модели» и в «Подсказках, что искать»): пробелы — из сборки
 * операции (compileOperation), по фронтам, армиям и корпусам сценария (не дивизиям — таблица вышла бы огромной);
 * где искать — подсказки полноты. Скачивается файлом <op>-agent-task.md.
 */
import { agentTask, coverageHints, operationGaps } from '@def-ops/knowledge';
import type { Scenario } from '@def-ops/sim';
import { download } from '../modeling/data';
import { getData, getEdits, operationHint } from '../sim/userdata';
import { coverageOf } from './coverage';

const ECHELONS = new Set(['front', 'army_group', 'army', 'corps']);

/** Текст задания для операции op. */
export async function agentTaskText(op: string): Promise<string> {
  const [edits, sc, hint, cov] = await Promise.all([getEdits(op), getData('scenarios', `${op}.json`) as Promise<Scenario>, operationHint(op), coverageOf(op).catch(() => null)]);
  const names = new Map(sc.formations.filter((f) => ECHELONS.has(f.echelon)).map((f) => [f.id, f.name]));
  const gaps = operationGaps({ provenance: edits.kb?.provenance ?? [] }, names);
  return agentTask({ id: op, title: hint?.title ?? sc.name, start: sc.start, end: sc.end }, gaps, cov ? coverageHints(cov) : []);
}

/** Скачать задание для агента по операции. */
export async function downloadAgentTask(op: string): Promise<void> {
  download(`${op}-agent-task.md`, await agentTaskText(op), 'text/markdown');
}
