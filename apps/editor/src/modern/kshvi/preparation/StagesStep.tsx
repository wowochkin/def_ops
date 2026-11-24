import { useState } from 'react';
import { stageImpact, type StageImpact, type StageImpactLinks } from '@def-ops/kshvi/browser';

const emptyLinks: StageImpactLinks = { inputs: [], maps: [], documents: [], criteria: [] };
export type StagesStepProps = Readonly<{
  stageId?: string;
  affectedBy?: readonly string[];
  links?: StageImpactLinks;
}>;

export function StagesStep({ stageId = '', affectedBy = ['expectedActions'], links = emptyLinks }: StagesStepProps) {
  const [impact, setImpact] = useState<StageImpact | null>(null);
  return <section>
    <h2>Этапы проведения</h2>
    <button disabled={!stageId} onClick={() => setImpact(stageImpact(stageId, affectedBy, links))}>Показать влияние изменения</button>
    {impact && <><p>Документы: {impact.documents.join(', ') || 'нет'}</p><p>Критерии: {impact.criteria.join(', ') || 'нет'}</p></>}
  </section>;
}
