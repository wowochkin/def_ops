import type { OfflineDataSet } from '../../../../../../services/kshvi/src/admin/offline-assets';

export function DataSetsPanel({ datasets }: { datasets: readonly OfflineDataSet[] }) {
  return <section className="modern-kshvi kshvi-admin" aria-labelledby="datasets-heading">
    <h2 id="datasets-heading">Локальные наборы данных</h2>
    {datasets.map(dataset => <article className="kshvi-admin-card" key={dataset.id}>
      <h3>{dataset.name}</h3><p>Тип: {dataset.kind} · версия: {dataset.version}</p>
      <p>Источник: <span>{dataset.source}</span></p><p>Лицензия: <span>{dataset.license}</span></p>
      <p>Атрибуция: {dataset.attribution}</p><code>SHA-256: {dataset.sha256}</code>
      <p>{dataset.offlineReady ? 'Доступно offline' : 'Локальные данные отсутствуют'}</p>
      {dataset.autonomousArchive === 'LINK_ONLY' && <p>Полностью автономное воспроизведение невозможно; разрешён экспорт ссылки/стиля.</p>}
      {dataset.autonomousArchive === 'FORBIDDEN' && <p>Включение в автономный архив запрещено лицензией.</p>}
      {dataset.autonomousArchive === 'ALLOWED' && <p>Автономный архив разрешён.</p>}
    </article>)}
  </section>;
}
