import { useState } from 'react';
import { ConductShell } from './shared/ConductShell';
import { LinkedPanels } from './shared/LinkedPanels';
import type { ConductCommands, ConductProjection } from './shared/types';
import { overviewProjection } from './shared/overviewProjection';

const commands = [
  ['PAUSE', 'Пауза', 'остановка модельного времени без остановки фиксации астрономических фактов'],
  ['RESUME', 'Продолжить', 'возобновление модельного времени после серверного подтверждения'],
  ['JUMP', 'Скачок', 'расчёт интервала, обязательное утверждение и новый снимок'],
  ['PRIVATE_STOP', 'Частный отбой', 'остановка выбранной инстанции при продолжении мира'],
  ['GENERAL_STOP', 'Общий отбой', 'остановка всех инстанций и фиксация незавершённых событий'],
  ['COMPLETE', 'Завершение', 'итоговый снимок и материалы разбора без автоматического итогового балла'],
] as const;

export function LeaderWorkspace({ projection, commands: commandBus, onExecute, onHandover }: {
  projection?: ConductProjection;
  commands?: Pick<ConductCommands, 'executeCritical'>;
  onExecute?: (command: typeof commands[number][0]) => string | Promise<string>;
  onHandover?: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<typeof commands[number] | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const leader = projection?.leader;
  const stage = leader?.stage && projection?.speed ? `${leader.stage} · скорость ${projection.speed}` : 'Нет данных';
  function execute(): void {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const outcome = selected[0] === 'RESUME'
        ? onExecute?.(selected[0]) ?? 'Команда не отправлялась: требуется серверное подтверждение'
        : commandBus?.executeCritical(selected[0]) ?? onExecute?.(selected[0]) ?? 'Команда не отправлялась: требуется серверное подтверждение';
      if (typeof outcome === 'string') { setResult(outcome); setBusy(false); return; }
      void outcome.then(setResult).catch(cause => setError(cause instanceof Error ? cause.message : 'Серверная команда не выполнена')).finally(() => setBusy(false));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Серверная команда не выполнена');
      setBusy(false);
    }
  }
  return <ConductShell title="Руководитель учения" projection={projection ?? overviewProjection} onHandover={onHandover}>
    <section className="kshvi-conduct-panel"><h2>Этап и обстановка</h2><p>Этап: {stage}</p><p>Учебные вопросы: {leader?.trainingQuestions ?? 'управление, МТО, взаимодействие'}</p>{!projection && <p>Истина / эталон / факт — отдельные служебные слои</p>}</section>
    <LinkedPanels mapTitle="Общая служебная карта" events={projection?.events ?? []} live={projection?.live ?? overviewProjection.live} />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Отклонения и просрочки</h2><p>{leader?.deviations ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>Очередь на утверждение</h2><p>{leader?.approvalQueue ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>Состояние участников и связи</h2><p>{leader?.stateSummary ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>Сводка исполнения целей</h2><p>{leader?.goalSummary ?? 'Нет данных'}</p></section>
    </div>
    <section className="kshvi-conduct-panel"><h2>Критические команды</h2><div className="kshvi-command-row">{commands.map(command => <button type="button" key={command[0]} className={command[0].includes('STOP') ? 'kshvi-danger' : ''} onClick={() => { setSelected(command); setResult(''); }}>{command[1]}</button>)}</div>
      {selected && <div className="kshvi-confirmation"><p>Последствия: {selected[2]}</p><button type="button" className="kshvi-danger" disabled={busy} onClick={execute}>{busy ? 'Ждём сервер…' : `Подтвердить: ${selected[1]}`}</button></div>}
      {result && <p role="status">Фактический результат: {result}</p>}{error && <p role="alert">{error}</p>}
    </section>
  </ConductShell>;
}
