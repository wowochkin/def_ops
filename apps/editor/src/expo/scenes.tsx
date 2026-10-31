/** Общие части сцен стенда: названия фронтов, заголовок фазы, таймер выбора (на паузе стоит). */
import type { DirectorState } from './director';
export const FRONT_NAMES = { su_1bf: '1-й Белорусский фронт', su_1uf: '1-й Украинский фронт' };
/** Задача фронта одной фразой (выбор фронта и ввод в обстановку). */
export const FRONT_TASKS = {
  su_1bf: 'С Кюстринского плацдарма — через Зееловские высоты на Берлин, к рейхстагу.',
  su_1uf: 'Через Нейсе и Шпрее — на запад к Эльбе и поворотом с юга на Берлин.',
};
export const FRONT_MARSHALS = { su_1bf: 'Маршал Георгий Жуков', su_1uf: 'Маршал Иван Конев' };
const PHASE_TITLES = {
  startup: 'Подготовка стенда',
  attract: 'Берлинская операция',
  welcome: 'Выбор фронта',
  briefing: 'Ввод в обстановку',
  result: 'Итог сеанса',
};
const STEP_TITLES = { explain: 'Обстановка', choose: 'Решение', scroll: 'Ход операции' };
export function phaseLabel(state: DirectorState): string {
  const p = state.phase;
  return p.kind === 'turn' ? `Перелом ${p.n} из 3 · ${STEP_TITLES[p.step]}` : PHASE_TITLES[p.kind];
}
export function PhaseTitle({ state }: { state: DirectorState }) {
  return <span>{phaseLabel(state)}</span>;
}
export function Timer({ state }: { state: DirectorState }) {
  const p = state.phase;
  if (p.kind !== 'turn' || p.step !== 'choose') return null;
  const remaining = p.deadline === null ? null : Math.max(0, Math.ceil((p.deadline - (state.pausedAt ?? state.now)) / 1000));
  return (
    <div className={`expo-timer ${remaining !== null && remaining <= 10 ? 'urgent' : ''}`} role="timer">
      {remaining === null ? 'Без ограничения времени' : `${remaining} с`}
    </div>
  );
}
