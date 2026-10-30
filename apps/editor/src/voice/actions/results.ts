/**
 * «Итоги» голосом и кнопками: `results.show {part}` открывает вкладку «Итоги» и её часть — в игре вкладку
 * командования, в переигровке вкладку боковой панели (там разбора хода нет: он — в игре). Регистрируют ReplayView и
 * CommandView; игра открывается поверх переигровки, поэтому окна — стопкой: действие говорит с верхним, а когда игра
 * закрыта, действие снова принадлежит переигровке.
 */
import { register, type Action } from '../registry';
import { hl } from '../highlight';
import { inReplay } from './command';
import { PART_TITLE, type ResultsPart } from '../../results-view';
import type { OperationSummary } from '@def-ops/sim';

export interface ResultsDeps {
  /** Какое окно показывает итоги: переигровка, игра; null — итогов нет. */
  section(): 'replay' | 'command' | null;
  summary(): OperationSummary | null;
  side(): 'su' | 'de';
  /** Открыть вкладку «Итоги» и часть. */
  setPart(p: ResultsPart): void;
}

const stack: (() => ResultsDeps)[] = [];
const top = () => stack[stack.length - 1]?.();
let action: Action | null = null;
/** Снятие действия, заново зарегистрированного для окна под закрытым. */
let again: (() => void) | null = null;

export function resultsActions(get: () => ResultsDeps): Action[] {
  stack.push(get);
  action = {
    id: 'results.show', section: 'replay', title: 'Итоги операции',
    describe: 'Открывает вкладку «Итоги» и её часть: turn — разбор хода (только в игре), losses — потери сторон рядом с историческими, compare — сравнение с историей.',
    params: { type: 'object', properties: { part: { enum: ['turn', 'losses', 'compare'] } } },
    say: ['штаб, покажи итоги', 'штаб, покажи потери'],
    available: () => { const r = inReplay(); if (r !== true) return r; return top()?.section() ? true : 'итогов нет: рассчитайте операцию на агентной модели'; },
    highlight: (p?: { part?: ResultsPart }) => hl(`results-${p?.part ?? 'losses'}`),
    run: async (p?: { part?: ResultsPart }) => {
      const d = top();
      if (!d) return 'Итогов нет.';
      const part: ResultsPart = p?.part && PART_TITLE[p.part] ? p.part : 'losses';
      if (part === 'turn' && d.section() === 'replay') return 'Разбор хода — в игре: примите командование. В переигровке — потери и сравнение.';
      d.setPart(part);
      return `Итоги: ${PART_TITLE[part].toLowerCase()}.`;
    },
  };
  return [action];
}

/** Окно закрыто: убрать его из стопки; осталось окно под ним — действие снова его. */
export function releaseResults(get: () => ResultsDeps): void {
  const i = stack.lastIndexOf(get);
  if (i >= 0) stack.splice(i, 1);
  again?.(); again = null;
  if (stack.length && action) again = register(action);
}
