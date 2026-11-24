import { useEffect, useState } from 'react';
import { AutonomyEditor, type AutonomyEditorProfile } from './AutonomyEditor';
import { EnvironmentMapPreparation } from './EnvironmentMapPreparation';
import type { ExerciseCard, KshviClient } from '../kshvi-api';
import { CatalogBrowser } from './CatalogBrowser';
import { RehearsalReport } from './RehearsalReport';
import { ReadinessStep } from './ReadinessStep';
import { LogisticsStep } from './LogisticsStep';
import { FormationStep } from './FormationStep';
import { EquipmentStep } from './EquipmentStep';
import { applyEquipmentGroupChange, createEquipmentRowsFromTemplate, exportEquipmentTable, importEquipmentTable, previewEquipmentGroupChange, validateEquipmentEditorRows } from '@def-ops/kshvi/browser';
import { preparationSteps, stepIndex, type PreparationStep } from './preparation-steps';
import './preparation.css';

const categories = ['CONTROL', 'RECONNAISSANCE', 'MANEUVER', 'COMBAT', 'ENGINEERING', 'ENVIRONMENT', 'LOGISTICS', 'MAINTENANCE', 'PERSONNEL', 'MEDICAL', 'SETTLEMENTS', 'INTERACTION'];
const defaultProfile: AutonomyEditorProfile = { version: 1, level: 'MEDIUM', categories: categories.map(category => ({ category, intensity: 2, maxSeverity: 2 })) };
const stateLabels: Record<string, string> = { DRAFT: 'Черновик', IN_REVIEW: 'На проверке', APPROVED: 'Утверждено', SEALED: 'Зафиксировано', ARCHIVED: 'В архиве', CANCELLED: 'Отменено' };

export function PreparationWorkspace({ client, exerciseId, revision, authorId, truthRole, onRevision, exerciseState, onStartOfficial, canStartOfficial = false }: {
  client?: KshviClient;
  exerciseId?: string;
  revision?: number;
  authorId?: string;
  truthRole?: string;
  onRevision?(card: ExerciseCard): void;
  exerciseState?: string;
  onStartOfficial?(): void;
  canStartOfficial?: boolean;
}) {
  const [step, setStep] = useState<PreparationStep>(exerciseId ? 'environment' : 'events');
  useEffect(() => { setStep(exerciseId ? 'environment' : 'events'); }, [exerciseId]);
  const index = stepIndex(step);
  const current = preparationSteps[index]!;
  const canUseEnvironment = client && exerciseId && revision !== undefined && authorId && truthRole && onRevision;

  return <section className="kshvi-preparation-workspace">
    <nav className="preparation-steps" aria-label="Этапы подготовки">
      {preparationSteps.map((item, itemIndex) => <button key={item.id} type="button" aria-label={item.label} aria-current={step === item.id ? 'step' : undefined} onClick={() => setStep(item.id)}>
        <span>{String(itemIndex + 1).padStart(2, '0')}</span>{item.label}
      </button>)}
    </nav>
    <header className="preparation-step-heading">
      <div><p>Шаг {index + 1} из {preparationSteps.length}</p><h2>{current.label}</h2></div>
      <p>{current.description}</p>
    </header>

    <div className="preparation-step-content">
      {step === 'environment' && (canUseEnvironment
        ? <EnvironmentMapPreparation client={client} exerciseId={exerciseId} revision={revision} authorId={authorId} truthRole={truthRole} onRevision={onRevision} />
        : <section className="preparation-empty"><h2>Сначала выберите учение</h2><p>Откройте «Рабочий цикл» в библиотеке. После этого здесь появятся атлас, погода и исходная карта.</p></section>)}
      {step === 'forces' && <>
        <EquipmentStep initialRows={createEquipmentRowsFromTemplate([])} operations={{ importTable: importEquipmentTable, exportTable: exportEquipmentTable, previewGroupChange: previewEquipmentGroupChange, applyGroupChange: applyEquipmentGroupChange, validateRows: validateEquipmentEditorRows }} />
        <FormationStep plan={{ id: 'План оперативного построения', orderVersion: 1, echelons: [], reserves: [], columns: [], areas: [], controlPosts: [] }} issues={[]} execution={{ status: 'PLANNED', positions: [] }} />
        <LogisticsStep requests={[]} movements={[]} balances={[]} repairs={[]} />
      </>}
      {step === 'events' && <><AutonomyEditor profile={defaultProfile} /><CatalogBrowser total={240} categories={12} operations={48} /></>}
      {step === 'readiness' && <>
        <RehearsalReport attempts={[]} />
        <ReadinessStep
          stage={{ title: 'Этап обеспечения боевой готовности', startsAt: 'не назначено', dueAt: 'не назначено', signal: { id: 'Сигнал готовности', receivedAt: null } }}
          activities={[]}
          readiness={{ status: 'NOT_STARTED', initialLevel: null, requiredLevel: null, limitations: ['SIGNAL_NOT_RECEIVED'] }}
        />
      </>}
      {step === 'launch' && <section className="preparation-launch">
        <h2>Проверка перед запуском</h2>
        <dl>
          <div><dt>Учение</dt><dd>{exerciseId ? 'Выбрано' : 'Не выбрано'}</dd></div>
          <div><dt>Редакция</dt><dd>{revision ?? 'Нет данных'}</dd></div>
          <div><dt>Состояние</dt><dd>{exerciseState ? stateLabels[exerciseState] ?? exerciseState : 'Нет данных'}</dd></div>
          <div><dt>Серверная фиксация</dt><dd>{exerciseState === 'SEALED' ? 'SEALED подтверждён' : 'Требуется SEALED'}</dd></div>
        </dl>
        {exerciseState !== 'SEALED' && <p>Завершите проверки и зафиксируйте сценарий на сервере. Кнопка станет доступной только после подтверждённого SEALED.</p>}
        <button className="kshvi-primary" type="button" disabled={!canStartOfficial || !onStartOfficial} onClick={onStartOfficial}>Запустить официальный сеанс</button>
      </section>}
    </div>

    <footer className="preparation-footer">
      <button type="button" disabled={index === 0} onClick={() => setStep(preparationSteps[index - 1]!.id)}>Назад</button>
      <p>{current.description}</p>
      {index < preparationSteps.length - 1 && <button className="kshvi-primary" type="button" onClick={() => setStep(preparationSteps[index + 1]!.id)}>Далее</button>}
    </footer>
  </section>;
}
