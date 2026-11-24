import { ConductShell } from './shared/ConductShell';
import { LinkedPanels } from './shared/LinkedPanels';
import type { ConductProjection } from './shared/types';

export function IntermediaryWorkspace({ projection, onHandover }: { projection: ConductProjection; onHandover?: () => void | Promise<void> }) {
  const assigned = projection.assignedNodeIds;
  const events = projection.events.filter(event => !event.nodeId || assigned.includes(event.nodeId));
  return <ConductShell title="Посредник" projection={projection} onHandover={onHandover}>
    <section className="kshvi-conduct-panel"><h2>Делегированный участок</h2><p>Закреплённые инстанции: {assigned.join(', ') || 'не назначены'}</p></section>
    <LinkedPanels events={events} live={projection.live} mapTitle="Карта закреплённого участка" />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Очередь на розыгрыш</h2><p>{projection.playgroup?.queue ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>Заявки руководителю</h2><p>Заявки создаются отдельными серверными командами участка.</p></section>
      <section className="kshvi-conduct-panel"><h2>Таймеры докладов</h2>{assigned.map(nodeId => <p key={nodeId}>{nodeId}: срок определяется серверной проекцией</p>)}</section>
      <section className="kshvi-conduct-panel"><h2>Лист наблюдения</h2><p>Наблюдения отображаются только после серверной санитизации.</p></section>
      <section className="kshvi-conduct-panel"><h2>Частный разбор</h2><p>Только действия и документы закреплённых инстанций.</p></section>
      <section className="kshvi-conduct-panel"><h2>Внеплановые вводные</h2><p><strong>в пределах делегирования</strong> или <strong>требуется утверждение</strong> определяется ответом серверной проверки.</p></section>
    </div>
  </ConductShell>;
}
