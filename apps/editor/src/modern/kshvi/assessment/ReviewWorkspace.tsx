import type { DebriefRecord } from '../kshvi-api';
import { AssessmentEditor } from './AssessmentEditor';
import { DebriefWorkspace } from './DebriefWorkspace';
import { MetricExplorer } from './MetricExplorer';

export function ReviewWorkspace({ debrief, canApprove, onApprove, onArchive }: {
  debrief: DebriefRecord;
  canApprove: boolean;
  onApprove: (value: { finalAssessment: string; comment: string }) => void;
  onArchive?: () => void;
}) {
  return <div className="kshvi-review-workspace">
    <DebriefWorkspace scope={debrief.scope} revision={debrief.revision} audience={debrief.audience} referenceIntent={debrief.referenceIntent} />
    <section aria-labelledby="kshvi-assessment-title">
      <h2 id="kshvi-assessment-title">Оценка с доказательствами</h2>
      <MetricExplorer metric={{ id: 'official-lifecycle', formula: 'evidence(official.events)', version: debrief.revision, unit: 'событие', period: 'официальный сеанс', value: 'UNKNOWN', missingData: ['Числовая метрика не рассчитывалась'], evidenceIds: [] }} onEvidence={() => undefined} />
      {canApprove ? <AssessmentEditor systemProposal="Автоматическая итоговая оценка не формировалась" onApprove={onApprove} />
        : <p>Итоговую оценку подтверждает руководитель учения в своей серверной роли.</p>}
    </section>
    {onArchive && <button type="button" className="kshvi-primary" onClick={onArchive}>Архивировать и перейти в архив</button>}
  </div>;
}
