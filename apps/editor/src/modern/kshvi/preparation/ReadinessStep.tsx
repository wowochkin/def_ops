type ReadinessStepProps = Readonly<{
  stage: Readonly<{
    title: string;
    startsAt: string;
    dueAt: string;
    signal: Readonly<{ id: string; receivedAt: string | null }>;
  }>;
  activities: readonly Readonly<{
    id: string;
    title: string;
    responsibleNodeId: string;
    dueAt: string;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'PARTIAL' | 'FAILED';
    report: string | null;
  }>[];
  readiness: Readonly<{
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'PARTIAL' | 'FAILED';
    initialLevel: number | null;
    requiredLevel: number | null;
    limitations: readonly string[];
    authorization?: Readonly<{ decisionId: string; basis: string }>;
  }>;
  onAdvance?: () => void;
  onAuthorize?: () => void;
}>;

/** Браузерная проекция: команды передаются наружу, доменное состояние здесь не пересчитывается. */
export function ReadinessStep({ stage, activities, readiness, onAdvance, onAuthorize }: ReadinessStepProps) {
  return <section aria-label="Этап боевой готовности">
    <h2>{stage.title}</h2>
    <p>Начало: {stage.startsAt}</p>
    <p>Срок: {stage.dueAt}</p>
    <p>{stage.signal.id}</p>
    <p>{stage.signal.receivedAt ? `Сигнал получен ${stage.signal.receivedAt}` : 'Сигнал не получен'}</p>
    <p>Исходный уровень: {readiness.initialLevel ?? 'неизвестен'}; требуемый: {readiness.requiredLevel ?? 'неизвестен'}</p>
    <p>Состояние: {readiness.status}</p>
    <table>
      <caption>Мероприятия и донесения</caption>
      <thead><tr><th>Мероприятие</th><th>Ответственный</th><th>Срок</th><th>Состояние</th><th>Доклад</th></tr></thead>
      <tbody>{activities.map(activity => <tr key={activity.id}>
        <td>{activity.title}</td><td>{activity.responsibleNodeId}</td><td>{activity.dueAt}</td><td>{activity.status}</td>
        <td>{activity.report ?? 'Доклад не получен'}</td>
      </tr>)}</tbody>
    </table>
    <h3>Ограничения первого приказа</h3>
    {readiness.limitations.length ? <ul>{readiness.limitations.map(code => <li key={code}>{code}</li>)}</ul> : <p>Ограничений нет</p>}
    {readiness.authorization && <p>{readiness.authorization.decisionId}: {readiness.authorization.basis}</p>}
    <div>
      <button type="button" onClick={onAdvance}>Обновить готовность</button>
      <button type="button" onClick={onAuthorize} disabled={readiness.status !== 'PARTIAL'}>Разрешить частичную готовность</button>
    </div>
  </section>;
}
