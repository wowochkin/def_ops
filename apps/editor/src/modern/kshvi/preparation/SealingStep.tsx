import { useRef, useState } from 'react';
import {
  READINESS_AREAS,
  REHEARSAL_CHECKS,
  sealScenario,
  type ExerciseInstance,
  type RehearsalReport,
  type SealScenarioInput,
  type SealedScenario,
  type StartInstanceCommand,
} from '../../../../../../packages/kshvi/src/scenario/sealing';
import type { ValidationReport } from '../../../../../../packages/kshvi/src/scenario/validation';
import { SealingConfirmations } from './SealingConfirmations';
import { createFetchSealingClient, type SealingClient } from './sealing-client';

export type SealingStepProps = Readonly<{
  report: ValidationReport;
  input: SealScenarioInput;
  onValidate: () => ValidationReport;
  onRehearsal: () => Promise<RehearsalReport> | RehearsalReport;
  onSealed?: (sealed: SealedScenario) => void;
  onStart?: (instance: ExerciseInstance) => void;
  startCommand: StartInstanceCommand;
  client?: SealingClient;
}>;

export function SealingStep({ report: initialReport, input, onValidate, onRehearsal, onSealed, onStart, startCommand, client }: SealingStepProps) {
  const [report, setReport] = useState(initialReport);
  const [rehearsal, setRehearsal] = useState(input.rehearsal);
  const [sealed, setSealed] = useState<SealedScenario | null>(null);
  const [instance, setInstance] = useState<ExerciseInstance | null>(null);
  const [error, setError] = useState('');
  const clientRef = useRef<SealingClient | null>(null);
  if (!clientRef.current) clientRef.current = client ?? createFetchSealingClient();

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
  const seal = async () => {
    try {
      const candidate = {
        ...input,
        issues: [...(input.issues ?? []), ...report.issues.map(item => ({
          code: item.code, severity: item.severity, area: item.area, message: item.message, waivable: item.waivable,
        }))],
        rehearsal,
      };
      // Локальная проверка даёт быструю диагностику, но не создаёт полномочный SEALED.
      sealScenario(candidate);
      const result = await clientRef.current!.seal(candidate);
      setSealed(result);
      setInstance(null);
      setError('');
      onSealed?.(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сценарий не зафиксирован');
    }
  };
  const start = async () => {
    try {
      if (!sealed) throw new Error('Сценарий ещё не зафиксирован');
      const result = await clientRef.current!.start(sealed.id, startCommand);
      setInstance(result);
      setError('');
      onStart?.(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Сеанс не запущен');
    }
  };

  return <section aria-labelledby="sealing-step-title">
    <h2 id="sealing-step-title">Проверка и фиксация сценария</h2>
    <p>Черновик → Проверка → Утверждение → Фиксация → Проведение ↔ Пауза → Завершение → Архив</p>
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

    <button type="button" onClick={() => void seal()}>Зафиксировать сценарий</button>
    {sealed && <section aria-label="Зафиксированная редакция">
      <p>Сценарий: {sealed.scenarioSha256}</p>
      <p>Карта: {sealed.hashes.initialMap}</p>
      <p>Среда: {sealed.hashes.environment}</p>
    </section>}
    <button type="button" onClick={() => void start()}>Запустить учение</button>
    {instance && <p>Сеанс: {instance.state}; журнал: {instance.eventLogId}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
