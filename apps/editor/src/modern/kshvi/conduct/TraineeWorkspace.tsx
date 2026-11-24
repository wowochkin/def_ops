import { ConductShell } from './shared/ConductShell';
import { LinkedPanels } from './shared/LinkedPanels';
import { DecisionEditor } from './DecisionEditor';
import { OrdersPanel } from './OrdersPanel';
import { ForceStateTabs } from './ForceStateTabs';
import type { ConductCommands, ConductProjection } from './shared/types';

export function TraineeWorkspace({ projection, commands, onHandover }: {
  projection: ConductProjection;
  commands: Pick<ConductCommands, 'cancelOrder' | 'saveDecision' | 'transitionDecision'>;
  onHandover?: () => void | Promise<void>;
}) {
  return <ConductShell title="Обучаемый" projection={projection} onHandover={onHandover}>
    <LinkedPanels mapTitle="Личная карта" events={projection.events} live={projection.live} />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Документы и вводные</h2><p>{projection.live.document}</p></section>
      <section className="kshvi-conduct-panel"><h2>Задачи и ресурсы</h2><p>{projection.live.state}</p></section>
      <section className="kshvi-conduct-panel"><h2>Входящие и исходящие сообщения</h2><p>{projection.order ? `Приказ ${projection.order.id} · ${projection.order.status}` : 'Нет активных приказов'}</p></section>
    </div>
    <DecisionEditor decision={projection.decision} commands={commands} />
    {projection.order && <OrdersPanel order={projection.order} commands={commands} />}
    <ForceStateTabs force={projection.force} />
  </ConductShell>;
}
