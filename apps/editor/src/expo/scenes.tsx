/** Общие части сцен стенда: названия фронтов, заголовок фазы, таймер выбора (на паузе стоит). */
import type { DirectorState } from './director';
export const FRONT_NAMES = { su_1bf: '1-й Белорусский фронт', su_1uf: '1-й Украинский фронт' };
export function PhaseTitle({ state }: { state: DirectorState }) {
  const p = state.phase;
  return (
    <span>
      {p.kind === 'turn'
        ? `Перелом ${p.n} из 3 · ${{ explain: 'Обстановка', choose: 'Решение', scroll: 'Ход операции' }[p.step]}`
        : {
            startup: 'Подготовка стенда',
            attract: 'Берлинская операция',
            welcome: 'Выбор фронта',
            briefing: 'Ввод в обстановку',
            result: 'Итог сеанса',
          }[p.kind]}
    </span>
  );
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
