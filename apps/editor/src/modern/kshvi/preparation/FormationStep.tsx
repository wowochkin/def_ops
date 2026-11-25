import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { FormationEditor } from './FormationEditor';

type FormationStepProps = Readonly<{
  plan: Readonly<{
    id: string;
    orderVersion: number;
    echelons: readonly Readonly<{ id: string; readyAt: string }>[];
    reserves: readonly Readonly<{ id: string; readyAt: string }>[];
    columns: readonly Readonly<{ id: string; routeId: string; startAt: string; endAt: string }>[];
    areas: readonly Readonly<{ id: string; kind: string }>[];
    controlPosts: readonly Readonly<{ id: string }>[];
  }>;
  issues: readonly Readonly<{ code: string; severity: 'ERROR' | 'WARNING' | 'REVIEW'; message: string }>[];
  execution: Readonly<{
    status: string;
    positions: readonly Readonly<{ elementId: string; travelledMeters: number; remainingMeters: number }>[];
  }>;
  onValidate?: () => void;
  draft?: PreparationDraft;
  onChange?(draft: PreparationDraft): void;
}>;

/** Проекция показывает фактический остаток пути и не подменяет его назначенным районом. */
export function FormationStep({ plan, issues, execution, onValidate, draft, onChange }: FormationStepProps) {
  if (draft) return <FormationEditor draft={draft} onChange={onChange ?? (() => {})} />;
  return <section aria-label="Оперативное построение">
    <h2>Оперативное построение</h2>
    <p>{plan.id}</p><p>Версия приказа: {plan.orderVersion}</p>
    <h3>Эшелоны и резервы</h3>
    <ul>{plan.echelons.map(item => <li key={item.id}>{item.id} — готовность {item.readyAt}</li>)}</ul>
    <ul>{plan.reserves.map(item => <li key={item.id}>{item.id} — готовность {item.readyAt}</li>)}</ul>
    <h3>Районы, рубежи и пункты управления</h3>
    <ul>{plan.areas.map(item => <li key={item.id}>{item.id}: {item.kind}</li>)}</ul>
    <ul>{plan.controlPosts.map(item => <li key={item.id}>{item.id}</li>)}</ul>
    <h3>Колонны и маршруты</h3>
    <ul>{plan.columns.map(item => <li key={item.id}>{item.id}: {item.routeId}, {item.startAt}–{item.endAt}</li>)}</ul>
    <h3>Проверка возможности</h3>
    {issues.length ? <ul>{issues.map((item, index) => <li key={`${item.code}-${index}`} data-severity={item.severity}>{item.message}</li>)}</ul> : <p>Нарушений не выявлено</p>}
    <button type="button" onClick={onValidate}>Проверить построение</button>
    <h3>{execution.status === 'PARTIAL' ? 'Частичное исполнение' : `Исполнение: ${execution.status}`}</h3>
    <ul>{execution.positions.map(item => <li key={item.elementId}>{item.elementId}: пройдено {item.travelledMeters} м, осталось {item.remainingMeters} м</li>)}</ul>
  </section>;
}
