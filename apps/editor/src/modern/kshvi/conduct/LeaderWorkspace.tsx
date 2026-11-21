import { useState } from 'react';
import { ConductShell, LinkedPanels } from './shared/browser';

const commands = [
  ['PAUSE', 'Пауза', 'остановка модельного времени без остановки фиксации астрономических фактов'],
  ['JUMP', 'Скачок', 'расчёт интервала, обязательное утверждение и новый снимок'],
  ['PRIVATE_STOP', 'Частный отбой', 'остановка выбранной инстанции при продолжении мира'],
  ['GENERAL_STOP', 'Общий отбой', 'остановка всех инстанций и фиксация незавершённых событий'],
  ['COMPLETE', 'Завершение', 'итоговый снимок и материалы разбора без автоматического итогового балла'],
] as const;

export function LeaderWorkspace({ onExecute, onHandover }: { onExecute?: (command: typeof commands[number][0]) => string; onHandover?: () => void }) {
  const [selected, setSelected] = useState<typeof commands[number] | null>(null);
  const [result, setResult] = useState('');
  return <ConductShell title="Руководитель учения" onHandover={onHandover}>
    <section className="kshvi-conduct-panel"><h2>Этап и обстановка</h2><p>Этап: Этап 2 · скорость 2×</p><p>Учебные вопросы: управление, МТО, взаимодействие</p><p>Истина / эталон / факт — отдельные служебные слои</p></section>
    <LinkedPanels mapTitle="Общая служебная карта" />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Отклонения и просрочки</h2><p>node-2: доклад просрочен на 5 минут</p></section>
      <section className="kshvi-conduct-panel"><h2>Очередь на утверждение</h2><p>2 заявки · 1 адаптивная вводная · 1 скачок · 2 расчёта</p></section>
      <section className="kshvi-conduct-panel"><h2>Состояние участников и связи</h2><p>Посредники: 3 активны · инстанции: 6 · связь: частичное ограничение</p><p>Готовность к следующему этапу: требуется утверждение модели stage-2</p></section>
      <section className="kshvi-conduct-panel"><h2>Сводка исполнения целей</h2><p>Цель 1: исполняется; цель 2: данные неполны. Итог определяет руководитель.</p></section>
    </div>
    <section className="kshvi-conduct-panel"><h2>Критические команды</h2><div className="kshvi-command-row">{commands.map(command => <button type="button" key={command[0]} className={command[0].includes('STOP') ? 'kshvi-danger' : ''} onClick={() => { setSelected(command); setResult(''); }}>{command[1]}</button>)}</div>
      {selected && <div className="kshvi-confirmation"><p>Последствия: {selected[2]}</p><button type="button" className="kshvi-danger" onClick={() => setResult(onExecute?.(selected[0]) ?? 'Команда не отправлялась: требуется серверное подтверждение')}>Подтвердить: {selected[1]}</button></div>}
      {result && <p role="status">Фактический результат: {result}</p>}
    </section>
  </ConductShell>;
}
