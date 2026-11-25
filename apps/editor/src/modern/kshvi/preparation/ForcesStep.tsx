import { useState } from 'react';
import { emptyPreparationDraft, type PreparationDraft, type ScenarioForce } from '@def-ops/kshvi/preparation-draft';
import type { ModernKnowledgeScenarioCopy } from '../../../../../../packages/kshvi/src/forces/modern-import';
import {
  applyEquipmentGroupChange, equipmentHoldingFromRow, equipmentRowFromHolding, exportEquipmentTable,
  importEquipmentTable, previewEquipmentGroupChange, validateEquipmentEditorRows,
} from '../../../../../../packages/kshvi/src/forces/equipment-editor';
import type { KshviClient } from '../kshvi-api';
import { bindForceToMapMarker, createScenarioForce, removeForce, upsertForce } from './force-operations';
import { ForceTree } from './ForceTree';
import { ForceEditor } from './ForceEditor';
import { ForceKnowledgeImport } from './ForceKnowledgeImport';
import { EquipmentStep, type EquipmentStepOperations } from './EquipmentStep';
import { FormationStep } from './FormationStep';
import { LogisticsStep } from './LogisticsStep';

const equipmentOperations: EquipmentStepOperations = {
  importTable: importEquipmentTable, exportTable: exportEquipmentTable,
  previewGroupChange: previewEquipmentGroupChange, applyGroupChange: applyEquipmentGroupChange, validateRows: validateEquipmentEditorRows,
};
const tabs = [
  { id: 'forces', label: 'Силы' }, { id: 'equipment', label: 'Оснащение' },
  { id: 'formation', label: 'Построение' }, { id: 'logistics', label: 'Снабжение' },
] as const;

export function ForcesStep({ draft = emptyPreparationDraft(new Date(0).toISOString()), onChange = () => {}, onOpenMap, client }: {
  draft?: PreparationDraft;
  onChange?(draft: PreparationDraft): void;
  onOpenMap?(): void;
  client?: Pick<KshviClient, 'importModernForce'>;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('forces');
  const [selectedId, setSelectedId] = useState(draft.forces[0]?.id ?? '');
  const [created, setCreated] = useState<ScenarioForce | null>(null);
  const [error, setError] = useState('');
  const selected = created?.id === selectedId ? created : draft.forces.find(force => force.id === selectedId) ?? null;

  function add() {
    const force = createScenarioForce(new Date().toISOString());
    setCreated(force); setSelectedId(force.id); setError('');
  }
  function apply(force: ScenarioForce, markerId: string) {
    try {
      setError('');
      onChange(markerId ? bindForceToMapMarker(draft, force, markerId) : upsertForce(draft, force));
      setCreated(null); setSelectedId(force.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить силу');
    }
  }
  function remove() {
    if (!selected) return;
    try {
      if (created?.id === selected.id) setCreated(null);
      else onChange(removeForce(draft, selected.id));
      setSelectedId(''); setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить силу');
    }
  }
  function imported(copy: ModernKnowledgeScenarioCopy, title: string) {
    const at = new Date().toISOString();
    const force = createScenarioForce(at, copy.id);
    const next: ScenarioForce = {
      ...force,
      identity: { ...force.identity, type: title, sideId: copy.sideId, nodeId: copy.parentNodeId, parentId: copy.parentNodeId },
      composition: { ...force.composition, equipment: structuredClone(copy.characteristics) as unknown as ScenarioForce['composition']['equipment'] },
      source: { sourceId: copy.sourceRecordId, reportedAt: at, sourceRevision: copy.sourceRevision, sourceSha256: copy.sourceHash },
    };
    onChange(upsertForce(draft, next)); setSelectedId(next.id); setCreated(null); setError('');
  }

  return <section aria-label="Силы и материально-техническое обеспечение">
    <div className="force-step-tabs" role="tablist" aria-label="Силы и МТО">
      {tabs.map(item => <button type="button" role="tab" key={item.id} aria-selected={tab === item.id} onClick={() => { setTab(item.id); setError(''); }}>{item.label}</button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {tab === 'forces' && <section aria-label="Силы и состояние">
      <h2>Силы и состояние</h2>
      <div className="forces-layout">
        <ForceTree forces={draft.forces} selectedId={selectedId} onSelect={id => { setSelectedId(id); setCreated(null); setError(''); }} onAdd={add} />
        {selected ? <ForceEditor draft={draft} force={selected} onApply={apply} onDelete={remove} onOpenMap={onOpenMap} />
          : <p>Выберите подразделение или добавьте новое. Положение, задача и состояние сохраняются в общей редакции сценария.</p>}
      </div>
      {client && selected && <ForceKnowledgeImport client={client} sideId={selected.identity.sideId} parentNodeId={selected.identity.nodeId} onImported={imported} />}
    </section>}
    {tab === 'equipment' && <EquipmentStep initialRows={draft.equipment.map(equipmentRowFromHolding)} operations={equipmentOperations}
      onSave={rows => {
        try { onChange({ ...draft, equipment: rows.map(equipmentHoldingFromRow) }); setError(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Ведомость не прошла проверку'); }
      }} />}
    {tab === 'formation' && <FormationStep draft={draft} onChange={onChange}
      plan={{ id: 'current', orderVersion: 1, echelons: [], reserves: [], columns: [], areas: [], controlPosts: [] }}
      issues={[]} execution={{ status: 'NOT_STARTED', positions: [] }} />}
    {tab === 'logistics' && <LogisticsStep requests={[]} movements={[]} balances={[]} repairs={[]} draft={draft} onChange={onChange} />}
  </section>;
}
