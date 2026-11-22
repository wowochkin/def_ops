import { useState } from 'react';
import { previewModernImport, type ModernImportSource, type ModernKnowledgeScenarioCopy, type ScenarioValue } from '@def-ops/kshvi/browser';

export type KnowledgeImportRequest = Readonly<{
  source: ModernImportSource;
  sideId: string;
  parentNodeId: string;
  scenarioValues: readonly ScenarioValue[];
}>;
export type KnowledgeImportDialogProps = Readonly<{
  source: ModernImportSource;
  title?: string;
  sideId?: string;
  parentNodeId?: string;
  onImport?: (input: KnowledgeImportRequest) => Promise<ModernKnowledgeScenarioCopy>;
  onCommit?: (created: ModernKnowledgeScenarioCopy) => void;
}>;

export function KnowledgeImportDialog({ source, title, sideId = '', parentNodeId = '', onImport, onCommit }: KnowledgeImportDialogProps) {
  const [created, setCreated] = useState<ModernKnowledgeScenarioCopy | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const preview = previewModernImport(source);
  const ready = Boolean(onImport && sideId && parentNodeId);
  async function commit() {
    if (!onImport || !ready) return;
    setPending(true);
    setError('');
    try {
      const result = await onImport({ source, sideId, parentNodeId, scenarioValues: [] });
      setCreated(result);
      onCommit?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Серверный импорт не выполнен');
    } finally {
      setPending(false);
    }
  }
  return <section aria-label="Импорт в КШВИ">
    <h2>Сценарная копия источника {title ?? source.sourceRecordId}</h2>
    <p>Источник: {source.sourceRecordId} · редакция {source.sourceRevision}</p>
    <p>Неизвестно: {preview.unknown.join(', ') || 'нет'}</p>
    <p>Справочный паспорт не становится расчётным нормативом автоматически.</p>
    {!ready && <p role="alert">Серверный импорт не подключён</p>}
    {error && <p role="alert">{error}</p>}
    <button disabled={!ready || pending} onClick={commit}>Создать сценарную копию</button>
    {created && <p role="status">Сценарная копия сохранена на сервере; исходный корпус не изменён</p>}
  </section>;
}
