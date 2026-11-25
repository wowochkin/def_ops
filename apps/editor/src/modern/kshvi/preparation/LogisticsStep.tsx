import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { RouteGraph } from '../../../../../../packages/kshvi/src/terrain/route-graph';
import type { TerrainState } from '../../../../../../packages/kshvi/src/terrain/types';
import { LogisticsEditor } from './LogisticsEditor';

type LogisticsStepProps = Readonly<{
  requests: readonly Readonly<{
    id: string;
    resourceId: string;
    priority: number;
    quantity: number;
    allocatedQuantity: number;
    deficit: number;
    status: string;
  }>[];
  movements: readonly Readonly<{
    id: string;
    status: string;
    sentQuantity: number;
    deliveredQuantity: number;
    delayMinutes: number;
    remainingMeters: number;
  }>[];
  balances: readonly Readonly<{
    resourceId: string;
    expected: number | null;
    actual: number | null;
    onHand: number;
    inTransit: number;
    consumed: number;
    lost: number;
    deficit: number;
  }>[];
  repairs: readonly Readonly<{
    id: string;
    equipmentId: string;
    status: string;
    evacuationRequired: boolean;
  }>[];
  onAdvanceSupply?: (movementId: string) => void;
  onRequestRepair?: (equipmentId: string) => void;
  draft?: PreparationDraft;
  onChange?(draft: PreparationDraft): void;
  terrain?: Readonly<{ state: TerrainState; graph: RouteGraph }>;
}>;

/** Только браузерная проекция серверных данных, без собственного списания или подтверждения поступления. */
export function LogisticsStep({ requests, movements, balances, repairs, onAdvanceSupply, onRequestRepair, draft, onChange, terrain }: LogisticsStepProps) {
  if (draft) return <LogisticsEditor draft={draft} onChange={onChange ?? (() => {})} terrain={terrain} />;
  return <section aria-label="Материально-техническое обеспечение">
    <h2>Материально-техническое обеспечение</h2>
    <h3>Заявки и приоритеты</h3>
    <ul>{requests.map(request => <li key={request.id}>
      <strong>{request.id}: {request.resourceId}</strong> — приоритет {request.priority}, потребность {request.quantity}, выделено {request.allocatedQuantity}, {request.status}
      <p>Дефицит: {request.deficit}</p>
    </li>)}</ul>
    <h3>Поставки в пути</h3>
    <ul>{movements.map(movement => <li key={movement.id}>
      <strong>{movement.id}: {movement.status}</strong>
      <p>Отправлено: {movement.sentQuantity}; подтверждено: {movement.deliveredQuantity}</p>
      <p>Остаток пути: {movement.remainingMeters} м; задержка: {movement.delayMinutes} мин</p>
      <button type="button" onClick={() => onAdvanceSupply?.(movement.id)}>Продвинуть поставку {movement.id}</button>
    </li>)}</ul>
    <h3>Баланс номенклатур</h3>
    <table><thead><tr><th>Номенклатура</th><th>Ожидается / фактически</th><th>Остаток</th><th>В пути</th><th>Расход</th><th>Потери</th><th>Дефицит</th></tr></thead>
      <tbody>{balances.map(balance => <tr key={balance.resourceId}>
        <td>{balance.resourceId}</td><td>Баланс: {balance.expected ?? 'неизвестно'} / {balance.actual ?? 'неизвестно'}</td>
        <td>{balance.onHand}</td><td>{balance.inTransit}</td><td>{balance.consumed}</td><td>{balance.lost}</td><td>{balance.deficit}</td>
      </tr>)}</tbody></table>
    <h3>Ремонт и эвакуация</h3>
    <ul>{repairs.map(repair => <li key={repair.id}>
      {repair.id}: {repair.equipmentId}, {repair.status}
      {repair.evacuationRequired && <p>Требуется эвакуация</p>}
      <button type="button" onClick={() => onRequestRepair?.(repair.equipmentId)}>Оформить ремонт {repair.equipmentId}</button>
    </li>)}</ul>
  </section>;
}
