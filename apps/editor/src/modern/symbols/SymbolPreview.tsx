import { useState } from 'react';
import { renderSymbol, type SymbolDefinition } from '@def-ops/tactical-symbols';

export function SymbolPreview({ symbol }: { symbol: SymbolDefinition }) {
  const [label, setLabel] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [activeModifierIds, setActiveModifierIds] = useState<string[]>(symbol.modifiers.map(modifier => modifier.id));
  const [inscriptionValues, setInscriptionValues] = useState<Record<string, string>>({});
  const labels = { ...symbol.labels, ...inscriptionValues };
  if (label) labels.top = label;
  const modifiers = activeModifierIds.map(id => symbol.modifiers.find(modifier => modifier.id === id) ?? { id, kind: 'GRAPHIC_INDEX' as const, value: id });
  const svg = renderSymbol({ ...symbol, labels, modifiers }, { width: 320, height: 320, detail: semantic ? 'SEMANTIC' : 'FULL' });
  return <div className="symbol-preview">
    <div role="img" aria-label="Векторный образец знака" dangerouslySetInnerHTML={{ __html: svg }} />
    <label>Подпись сверху<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Без подписи" /></label>
    {symbol.inscriptions?.length ? <fieldset><legend>Исходные надписи</legend>
      {symbol.inscriptions.map(inscription => <label key={inscription.id}>Надпись {inscription.text}<input
        value={inscriptionValues[inscription.id] ?? inscription.text}
        onChange={event => setInscriptionValues(current => ({ ...current, [inscription.id]: event.target.value }))}
      /></label>)}
    </fieldset> : null}
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
