export function ArchiveWorkspace({ archiveId, manifestSha256, mode, missing, onExport }: {
  archiveId: string;
  manifestSha256: string;
  mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH';
  missing: readonly string[];
  onExport: () => void;
}) {
  const autonomous = mode === 'AUTONOMOUS';
  return <section>
    <h2>Архив {archiveId}</h2>
    <p role="status">{autonomous ? 'Автономное воспроизведение пройдено' : 'Ограниченное исследование: пакет неполный или неавтономен'}</p>
    <p>SHA-256 манифеста: <code>{manifestSha256}</code></p>
    {!autonomous && <p>Отсутствует: {missing.join(', ') || 'см. ограничения лицензии'}</p>}
    <button onClick={onExport}>Экспортировать архив</button>
  </section>;
}
