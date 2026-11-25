import { useState } from 'react';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { validateSupplyPlan } from '../../../../../../packages/kshvi/src/logistics/supply-request';
import { terrainRoutesFromInitialMap } from '../../../../../../packages/kshvi/src/logistics/initial-map-routes';
import type { RouteGraph } from '../../../../../../packages/kshvi/src/terrain/route-graph';
import type { TerrainState } from '../../../../../../packages/kshvi/src/terrain/types';
import { SupplyRequestEditor } from './SupplyRequestEditor';

const statusLabels: Record<string, string> = {
  REQUESTED: 'Планируется', ALLOCATED: 'Выделено', PARTIALLY_ALLOCATED: 'Частично выделено', BLOCKED: 'Заблокировано',
  REQUIRES_REVIEW: 'Требует проверки', CANCELLED: 'Отменено',
};

export function LogisticsEditor({ draft, onChange, terrain }: {
  draft: PreparationDraft;
  onChange(draft: PreparationDraft): void;
  terrain?: Readonly<{ state: TerrainState; graph: RouteGraph }>;
}) {
  const [adding, setAdding] = useState(false);
  const plan = draft.logistics;
  const actualTerrain = terrain ?? (draft.initialMap ? terrainRoutesFromInitialMap(draft.initialMap) : undefined);
  const issues = plan ? validateSupplyPlan(plan).issues : [];
  return <section aria-label="Редактор материально-технического обеспечения">
    <h2>Материально-техническое обеспечение</h2>
    <p>Заявка связывает потребность, остаток, транспорт и конкретный маршрут. Выделение и отправка не означают поступление получателю.</p>
    <button type="button" onClick={() => setAdding(true)}>Добавить заявку</button>
    {adding && <SupplyRequestEditor draft={draft} terrain={actualTerrain} onSave={next => { onChange(next); setAdding(false); }} onClose={() => setAdding(false)} />}
    <h3>Заявки и дефицит</h3>
    {!plan?.requests.length && <p>Заявки ещё не созданы.</p>}
    <table><thead><tr><th>Номенклатура</th><th>Потребность</th><th>Выделено</th><th>Дефицит</th><th>Состояние</th><th>Требуется к</th></tr></thead>
      <tbody>{plan?.requests.map(request => <tr key={request.id}>
        <td>{request.resourceId}</td><td>{request.quantity} {request.unit}</td><td>{request.allocatedQuantity} {request.unit}</td>
        <td>{request.deficit} {request.unit}</td><td>{statusLabels[request.status] ?? request.status}</td><td>{request.requiredBy}</td>
      </tr>)}</tbody></table>
    <h3>Транспорт</h3>
    <ul>{plan?.transports?.map(transport => <li key={transport.id}>{transport.id}: количество до {transport.remainingCapacityQuantity ?? 'неизвестно'}, масса до {transport.remainingWeightTonnes ?? 'неизвестно'} т, объём до {transport.remainingVolumeM3 ?? 'неизвестно'} м³</li>)}</ul>
    <h3>Маршруты</h3>
    <ul>{plan?.routes.map(route => <li key={`${route.routeId}-${route.requestIds.join('-')}`}>{route.routeId}: {route.status === 'OPEN' ? 'открыт' : route.status === 'CLOSED' ? 'закрыт' : 'требует проверки'}</li>)}</ul>
    {!!issues.length && <section aria-label="Проверка плана снабжения"><h3>Проверка плана</h3><ul>{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></section>}
  </section>;
}
