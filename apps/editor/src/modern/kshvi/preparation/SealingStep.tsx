import { useRef, useState } from 'react';
import {
  READINESS_AREAS,
  REHEARSAL_CHECKS,
  createInstanceRegistry,
  sealScenario,
  startInstance,
  type ExerciseInstance,
  type InstanceRegistry,
  type RehearsalReport,
  type SealScenarioInput,
  type SealedScenario,
  type StartInstanceCommand,
} from '../../../../../../packages/kshvi/src/scenario/sealing';
import type { ValidationReport } from '../../../../../../packages/kshvi/src/scenario/validation';
import { SealingConfirmations } from './SealingConfirmations';

export type SealingStepProps = Readonly<{
  report: ValidationReport;
  input: SealScenarioInput;
  onValidate: () => ValidationReport;
  onRehearsal: () => Promise<RehearsalReport> | RehearsalReport;
  onSealed?: (sealed: SealedScenario) => void;
  onStart?: (instance: ExerciseInstance) => void;
  startCommand: StartInstanceCommand;
}>;

export function SealingStep({ report: initialReport, input, onValidate, onRehearsal, onSealed, onStart, startCommand }: SealingStepProps) {
  const [report, setReport] = useState(initialReport);
  const [rehearsal, setRehearsal] = useState(input.rehearsal);
  const [sealed, setSealed] = useState<SealedScenario | null>(null);
  const [instance, setInstance] = useState<ExerciseInstance | null>(null);
  const [error, setError] = useState('');
  const registry = useRef<InstanceRegistry | null>(null);
  if (!registry.current) registry.current = createInstanceRegistry();

  const validate = () => {
    try {
      setReport(onValidate());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Проверка не выполнена');
    }
  };
  const rehearse = async () => {
    try {
      const result = await onRehearsal();
      if (!result) throw new Error('REHEARSAL_REQUIRED');
      setRehearsal(result);
      setSealed(null);
      setInstance(null);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Пробный прогон не выполнен');
    }
  };
  const seal = () => {
    try {
      const result = sealScenario({
        ...input,
        issues: [...(input.issues ?? []), ...report.issues.map(item => ({
          code: item.code, severity: item.severity, area: item.area, message: item.message, waivable: item.waivable,
        }))],
        rehearsal,
      });
      setSealed(result);
      setInstance(null);
      setError('');
      onSealed?.(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сценарий не зафиксирован');
    }
  };
  const start = () => {
    try {
      if (!sealed) throw new Error('SEALED_REQUIRED');
      const result = startInstance(sealed, startCommand, registry.current!);
      setInstance(result);
      setError('');
      onStart?.(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сеанс не запущен');
    }
  };

  return <section aria-labelledby="sealing-step-title">
    <h2 id="sealing-step-title">Проверка и фиксация сценария</h2>
    <p>DRAFT → IN_REVIEW → APPROVED → SEALED → ACTIVE ↔ PAUSED → COMPLETED → ARCHIVED</p>
    <p>Областей проверено: {report.checkedAreas.length}</p>
    <p>Итог проверки: {report.status}</p>
    <button type="button" onClick={validate}>Проверить сценарий</button>
    {report.issues.length > 0 && <ul aria-label="Результаты проверки">{report.issues.map((item, index) => <li key={`${item.area}-${item.code}-${index}`}>
      {item.severity} / {item.area} / {item.code}: {item.message}
    </li>)}</ul>}
    <SealingConfirmations required={READINESS_AREAS} confirmations={input.confirmations} />

    <section aria-labelledby="sealing-rehearsal-title">
      <h3 id="sealing-rehearsal-title">Обязательный полный пробный прогон</h3>
      <button type="button" onClick={() => void rehearse()}>Запустить полный пробный прогон</button>
      {rehearsal && <>
        <p>Пробный прогон: {rehearsal.status}; проверок: {REHEARSAL_CHECKS.filter(check => rehearsal.checks[check] === true).length}</p>
        {rehearsal.isolated && <p>Журнал репетиции изолирован от официального учения</p>}
      </>}
    </section>

    <button type="button" onClick={seal}>Зафиксировать SEALED</button>
    {sealed && <section aria-label="Зафиксированная редакция">
      <p>Сценарий: {sealed.scenarioSha256}</p>
      <p>Карта: {sealed.hashes.initialMap}</p>
      <p>Среда: {sealed.hashes.environment}</p>
    </section>}
    <button type="button" onClick={start}>Запустить сеанс</button>
    <p>Зарегистрировано сеансов: {registry.current.count}</p>
    {instance && <p>Сеанс: {instance.state}; журнал: {instance.eventLogId}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
