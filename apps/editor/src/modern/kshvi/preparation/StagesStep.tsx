import { useState } from 'react';
import { stageImpact, type StageImpact, type StageImpactLinks } from '@def-ops/kshvi';

const links: StageImpactLinks = {
  inputs: [{ id: 'input-1', stageIds: ['stage-2'], affectedBy: ['expectedActions'] }],
  maps: [],
  documents: [{ id: 'doc-1', stageIds: ['stage-2'], affectedBy: ['expectedActions'] }],
  criteria: [{ id: 'criterion-1', stageIds: ['stage-2'], affectedBy: ['expectedActions'] }],
};

export function StagesStep() {
  const [impact, setImpact] = useState<StageImpact | null>(null);
  return <section>
    <h2>Этапы проведения</h2>
    <button onClick={() => setImpact(stageImpact('stage-2', ['expectedActions'], links))}>Показать влияние изменения</button>
    {impact && <><p>Документы: {impact.documents.join(', ') || 'нет'}</p><p>Критерии: {impact.criteria.join(', ') || 'нет'}</p></>}
  </section>;
}
