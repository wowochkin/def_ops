import type { ConfigVersion } from '../../../../../../services/kshvi/src/admin/config-catalog';
import type { RetentionPolicy } from '../../../../../../services/kshvi/src/admin/retention-service';

export function ConfigCatalog({ versions, retention }: {
  versions: readonly ConfigVersion[];
  retention: Omit<RetentionPolicy, 'organizationId'>;
}) {
  return <section className="modern-kshvi kshvi-admin" aria-labelledby="config-heading">
    <h2 id="config-heading">Версионные профили и хранение</h2>
    {versions.map(version => <article className="kshvi-admin-card" key={`${version.profileId}-${version.version}`}>
      <h3>{version.kind} · версия {version.version}</h3>
      <p>Состояние: {version.status}</p>
      <p>Тесты: {version.testReport.status}</p>
      <p>Источник: {version.source ?? 'не указан'} · допущение: {version.assumption ?? 'не требуется'}</p>
      <p>Утвердил: {version.approvedBy ?? 'не утверждено'}</p>
      <code>SHA-256: {version.sha256}</code>
    </article>)}
    <h3>Политика хранения</h3>
    <p>Активные данные: {retention.activeDays} дн. · архивы: {retention.archiveDays} дн. · копии: {retention.backupDays} дн.</p>
    <p>Аудит: {retention.auditDays} дн.</p>
    <p>Допустимые носители: {retention.allowedMedia.join(', ')}</p>
    <p>Ответственные: {retention.responsibleUserIds.join(', ')}</p>
  </section>;
}
