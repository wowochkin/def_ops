import { useState } from 'react';
import { renderSymbol, type SymbolDefinition } from '@def-ops/tactical-symbols';

export function SymbolPreview({ symbol }: { symbol: SymbolDefinition }) {
  const [label, setLabel] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [activeModifierIds, setActiveModifierIds] = useState<string[]>(symbol.modifiers.map(modifier => modifier.id));
  const labels = { ...symbol.labels };
  if (label) labels.top = label;
  const modifiers = activeModifierIds.map(id => symbol.modifiers.find(modifier => modifier.id === id) ?? { id, kind: 'GRAPHIC_INDEX' as const, value: id });
  const svg = renderSymbol({ ...symbol, labels, modifiers }, { width: 180, height: 180, detail: semantic ? 'SEMANTIC' : 'FULL' });
  return <div className="symbol-preview">
    <div role="img" aria-label="Векторный образец знака" dangerouslySetInnerHTML={{ __html: svg }} />
    <label>Подпись сверху<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Без подписи" /></label>
    <fieldset><legend>Модификаторы</legend>
      {symbol.allowedModifierIds.length ? symbol.allowedModifierIds.map(id => <label key={id}>
        <input
          type="checkbox"
          checked={activeModifierIds.includes(id)}
          onChange={() => setActiveModifierIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
        />{id}
      </label>) : <p>Не предусмотрены</p>}
    </fieldset>
    <label><input type="checkbox" checked={semantic} onChange={event => setSemantic(event.target.checked)} /> Семантическое упрощение</label>
  </div>;
}
