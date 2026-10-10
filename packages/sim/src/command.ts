/** Названия командования стороны (Ставка/фронты, ОКХ/группы армий) — для текстов линий, журнала, интерфейса. */
import { profileOf, type SimContext } from './step';

/**
 * Названия высшего командования стороны и её объединений верхнего уровня — для текстов линий, журнала и
 * интерфейса: у Красной армии — Ставка и фронты, у вермахта — ОКХ и группы армий.
 */
export interface CommandTerms {
  /** Высшее командование: «Ставка», «ОКХ». */
  top: string;
  /** Род. падеж: «Ставки», «ОКХ». */
  topGen: string;
  /** «в Ставку», «в ОКХ». */
  topTo: string;
  /** Объединение верхнего уровня: «фронт», «группа армий». */
  group: string;
  /** Род. падеж мн. ч.: «фронтов», «групп армий». */
  groupsGen: string;
  /** Документ о линии сверху: «директива», «приказ». */
  directive: string;
}
export function commandTerms(ctx: SimContext, side: string): CommandTerms {
  let german = false;
  try { german = profileOf(ctx, side).id.startsWith('wehrmacht'); } catch { /* сторона без профиля */ }
  return german
    ? { top: 'ОКХ', topGen: 'ОКХ', topTo: 'в ОКХ', group: 'группа армий', groupsGen: 'групп армий', directive: 'приказ' }
    : { top: 'Ставка', topGen: 'Ставки', topTo: 'в Ставку', group: 'фронт', groupsGen: 'фронтов', directive: 'директива' };
}
