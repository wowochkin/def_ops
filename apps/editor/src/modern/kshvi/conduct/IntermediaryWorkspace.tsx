import { ConductShell, LinkedPanels, defaultConductEvents } from './shared/browser';

export function IntermediaryWorkspace({ assignedNodeIds = ['node-1', 'node-2'], onHandover }: { assignedNodeIds?: readonly string[]; onHandover?: () => void }) {
  const events = defaultConductEvents.filter(event => event.nodeId && assignedNodeIds.includes(event.nodeId));
  return <ConductShell title="Посредник" onHandover={onHandover}>
    <section className="kshvi-conduct-panel"><h2>Делегированный участок</h2><p>Закреплённые инстанции: {assignedNodeIds.join(', ')}</p><p>Плановые вводные и документы доступны только в этом участке.</p></section>
    <LinkedPanels events={events} mapTitle="Карта закреплённого участка" />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Очередь на розыгрыш</h2><p>input-1 · calculation-1</p></section>
      <section className="kshvi-conduct-panel"><h2>Заявки руководителю</h2><p>request-1: ожидает решения</p></section>
      <section className="kshvi-conduct-panel"><h2>Таймеры докладов</h2>{assignedNodeIds.map(nodeId => <p key={nodeId}>{nodeId}: осталось 5 минут</p>)}</section>
      <section className="kshvi-conduct-panel"><h2>Лист наблюдения</h2><p>Источник sensor-1 · точность ±150 м · доставка с задержкой</p></section>
      <section className="kshvi-conduct-panel"><h2>Частный разбор</h2><p>Только действия и документы закреплённых инстанций.</p></section>
      <section className="kshvi-conduct-panel"><h2>Внеплановые вводные</h2><p><strong>в пределах делегирования</strong>: input-local</p><p><strong>требуется утверждение</strong>: input-outside</p></section>
    </div>
  </ConductShell>;
}
