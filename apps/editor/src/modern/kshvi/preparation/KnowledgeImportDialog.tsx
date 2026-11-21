import { useState } from 'react';
import { commitModernImport, previewModernImport, type ModernImportSource, type ModernKnowledgeScenarioCopy } from '@def-ops/kshvi/browser';

export function KnowledgeImportDialog({ source, title, onCommit }: { source: ModernImportSource; title?: string; onCommit?: (created: ModernKnowledgeScenarioCopy) => void }) {
  const [created, setCreated] = useState<ModernKnowledgeScenarioCopy | null>(null);
  const preview = previewModernImport(source);
  const commit = () => {
    const result = commitModernImport(preview, { sideId: 'blue', parentNodeId: 'node-1', scenarioValues: [] });
    setCreated(result);
    onCommit?.(result);
  };
  return <section aria-label="Импорт в КШВИ">
    <h2>Сценарная копия источника {title ?? source.sourceRecordId}</h2>
    <p>Источник: {source.sourceRecordId} · редакция {source.sourceRevision}</p>
    <p>Неизвестно: {preview.unknown.join(', ') || 'нет'}</p>
    <p>Справочный паспорт не становится расчётным нормативом автоматически.</p>
    <button onClick={commit}>Создать сценарную копию</button>
    {created && <p role="status">Сценарная копия создана; исходный корпус не изменён</p>}
  </section>;
}
