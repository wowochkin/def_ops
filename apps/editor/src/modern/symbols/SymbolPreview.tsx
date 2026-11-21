import { useState } from 'react';
import { renderSymbol, type SymbolDefinition } from '@def-ops/tactical-symbols';

export function SymbolPreview({ symbol }: { symbol: SymbolDefinition }) {
  const [label, setLabel] = useState('');
  const [semantic, setSemantic] = useState(false);
  const labels = { ...symbol.labels };
  if (label) labels.top = label;
  const svg = renderSymbol({ ...symbol, labels }, { width: 180, height: 180, detail: semantic ? 'SEMANTIC' : 'FULL' });
  return <div className="symbol-preview">
    <div role="img" aria-label="Векторный образец знака" dangerouslySetInnerHTML={{ __html: svg }} />
    <label>Подпись сверху<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Без подписи" /></label>
    <label><input type="checkbox" checked={semantic} onChange={event => setSemantic(event.target.checked)} /> Семантическое упрощение</label>
  </div>;
}
