import { useMemo, useState } from 'react';
import { modernCorpus } from '../../../../../../packages/knowledge/src/modern';
import type { ModernImportSource, ModernKnowledgeScenarioCopy } from '../../../../../../packages/kshvi/src/forces/modern-import';
import type { KshviClient } from '../kshvi-api';
import { KnowledgeImportDialog } from './KnowledgeImportDialog';

export function ForceKnowledgeImport({ client, sideId, parentNodeId, onImported }: {
  client: Pick<KshviClient, 'importModernForce'>;
  sideId: string;
  parentNodeId: string;
  onImported(created: ModernKnowledgeScenarioCopy, title: string): void;
}) {
  const [query, setQuery] = useState('');
  const [recordId, setRecordId] = useState('');
  const [source, setSource] = useState<ModernImportSource | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const records = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return modernCorpus.representatives.filter(record => !needle || `${record.title} ${record.summary}`.toLocaleLowerCase('ru').includes(needle)).slice(0, 50);
  }, [query]);
  const selected = modernCorpus.representatives.find(record => record.id === recordId) ?? records[0];

  async function open() {
    if (!selected) return;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(selected)));
      const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      setTitle(selected.title);
      setSource({
        sourceRecordId: selected.id, sourceRevision: 1, sourceHash, modelInputs: false, simulationValidated: false,
        characteristics: selected.passport.characteristics.map(fact => ({ field: fact.field, value: fact.value })),
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось проверить источник');
    }
  }

  return <section className="force-knowledge-import" aria-label="Добавление из базы знаний">
    <h3>Добавить из базы знаний</h3>
    <label>Поиск записи базы знаний<input type="search" value={query} onChange={event => { setQuery(event.target.value); setRecordId(''); }} /></label>
    <label>Запись базы знаний<select value={selected?.id ?? ''} onChange={event => setRecordId(event.target.value)}>
      {records.map(record => <option key={record.id} value={record.id}>{record.title}</option>)}
    </select></label>
    <button type="button" disabled={!selected || !sideId || !parentNodeId} onClick={() => void open()}>Добавить из базы знаний</button>
    {!sideId || !parentNodeId ? <p>Сначала укажите сторону и инстанцию в карточке силы.</p> : null}
    {error && <p role="alert">{error}</p>}
    {source && <KnowledgeImportDialog source={source} title={title} sideId={sideId} parentNodeId={parentNodeId}
      onImport={input => client.importModernForce(input)} onCommit={created => { onImported(created, title); setSource(null); }} />}
  </section>;
}
