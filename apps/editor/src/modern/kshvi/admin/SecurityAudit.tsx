import type { SecurityAuditEvent } from '../../../../../../services/kshvi/src/auth/security-audit';

export function SecurityAudit({ events, onExport }: {
  events: readonly SecurityAuditEvent[];
  onExport: () => void;
}) {
  return <section className="modern-kshvi kshvi-admin" aria-labelledby="audit-heading">
    <h2 id="audit-heading">Журнал безопасности</h2>
    <p>Только технические идентификаторы, действия и хеши. Содержание учения не выгружается.</p>
    <button onClick={onExport}>Экспортировать аудит</button>
    <div className="kshvi-admin-table" role="region" aria-label="Записи аудита" tabIndex={0}>
      <table><thead><tr><th>Номер</th><th>Время</th><th>Действие</th><th>Результат</th><th>Корреляция</th><th>Хеш</th></tr></thead>
        <tbody>{events.map(event => <tr key={event.eventId}>
          <td>{event.sequence}</td><td>{event.occurredAt}</td><td>{event.action}</td><td>{event.outcome}</td>
          <td>{event.correlationId}</td><td><code>{event.hash.slice(0, 12)}…</code></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
