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
/** Заголовок фазы в шапке; на переломе — номер перелома и его шаги, текущий выделен. */
export function PhaseTitle({ state }: { state: DirectorState }) {
  const p = state.phase;
  if (p.kind !== 'turn') return <span>{phaseLabel(state)}</span>;
  return (
    <span className="expo-phase-turn">
      <span>Перелом {p.n} из 3</span>
      <span className="expo-steps">
        {(['explain', 'choose', 'scroll'] as const).map((k) => (
          <span key={k} aria-current={p.step === k ? 'step' : undefined}>
            {STEP_TITLES[k]}
          </span>
        ))}
      </span>
    </span>
  );
}
/** Время на выбор: число секунд и убывающая полоса; без ограничения времени таймера нет. */
export function Timer({ state, total }: { state: DirectorState; total: number }) {
  const p = state.phase;
  if (p.kind !== 'turn' || p.step !== 'choose' || p.deadline === null) return null;
  const remaining = Math.max(0, Math.ceil((p.deadline - (state.pausedAt ?? state.now)) / 1000));
  return (
    <div className={`expo-timer ${remaining <= 10 ? 'urgent' : ''}`}>
      <span role="timer">{remaining} с</span>
      <i style={{ width: `${Math.min(100, (remaining / Math.max(1, total)) * 100)}%` }} />
    </div>
  );
}
