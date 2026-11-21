import { ConductShell, LinkedPanels } from './shared/browser';
import { DecisionEditor } from './DecisionEditor';
import { OrdersPanel } from './OrdersPanel';
import { ForceStateTabs } from './ForceStateTabs';

export function TraineeWorkspace({ onHandover, onOrderCancel }: { onHandover?: () => void; onOrderCancel?: (input: { reason: string }) => void }) {
  return <ConductShell title="Обучаемый" onHandover={onHandover}>
    <LinkedPanels mapTitle="Личная карта" />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Документы и вводные</h2><p>Донесение node-1 · получено с задержкой 60 с</p><p className="kshvi-data-stale">Устаревшие сведения отмечены отдельно</p></section>
      <section className="kshvi-conduct-panel"><h2>Задачи и ресурсы</h2><p>Задача task-1 · fuel: донесено 8 Л · остаток маршрута 4000 м</p></section>
      <section className="kshvi-conduct-panel"><h2>Входящие и исходящие сообщения</h2><p>Входящее: приказ order-1 · исходящее: доклад report-1</p></section>
    </div>
    <DecisionEditor />
    <OrdersPanel order={{ id: 'order-1', status: 'EXECUTING', receivedAt: '2030-01-01T01:05:00Z', actualCosts: { timeMinutes: 10, resources: { fuel: 2 } }, position: { remainingMeters: 4000, travelledMeters: 1000 } }} onCancel={onOrderCancel} />
    <ForceStateTabs />
  </ConductShell>;
}
