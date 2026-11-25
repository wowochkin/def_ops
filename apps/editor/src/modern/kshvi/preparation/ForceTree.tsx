import type { ScenarioForce } from '@def-ops/kshvi/preparation-draft';

export function ForceTree({ forces, selectedId, onSelect, onAdd }: {
  forces: readonly ScenarioForce[];
  selectedId: string;
  onSelect(id: string): void;
  onAdd(): void;
}) {
  const sides = [...new Set(forces.map(force => force.identity.sideId || 'Без стороны'))];
  return <nav className="force-tree" aria-label="Подразделения сценария">
    <div className="force-tree-heading"><h3>Подразделения</h3><button type="button" onClick={onAdd}>Добавить силу</button></div>
    {!forces.length && <p>Силы ещё не добавлены. Создайте подразделение и свяжите его с объектом исходной карты.</p>}
    {sides.map(side => <section key={side}>
      <h4>{side}</h4>
      {[...new Set(forces.filter(force => (force.identity.sideId || 'Без стороны') === side).map(force => force.identity.nodeId || 'Без инстанции'))].map(nodeId => <div key={nodeId}>
        <strong>{nodeId}</strong>
        <ul>{forces.filter(force => (force.identity.sideId || 'Без стороны') === side && (force.identity.nodeId || 'Без инстанции') === nodeId).map(force => <li key={force.id}>
          <button type="button" aria-pressed={selectedId === force.id} onClick={() => onSelect(force.id)}>{force.identity.type}</button>
        </li>)}</ul>
      </div>)}
    </section>)}
  </nav>;
}
