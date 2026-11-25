import { useEffect, useState } from 'react';
import { knownQuantity, unknownQuantity } from '@def-ops/kshvi/browser';
import type {
  EquipmentEditorIssue,
  EquipmentEditorRow,
  EquipmentGroupPatch,
  EquipmentGroupPreview,
  EquipmentImportResult,
} from '../../../../../../packages/kshvi/src/forces/equipment-editor';

export type EquipmentStepOperations = Readonly<{
  importTable(text: string): EquipmentImportResult;
  exportTable(rows: readonly EquipmentEditorRow[]): string;
  previewGroupChange(rows: readonly EquipmentEditorRow[], rowIds: readonly string[], patch: EquipmentGroupPatch): EquipmentGroupPreview;
  applyGroupChange(rows: readonly EquipmentEditorRow[], preview: EquipmentGroupPreview): readonly EquipmentEditorRow[];
  validateRows(rows: readonly EquipmentEditorRow[]): readonly EquipmentEditorIssue[];
}>;

function quantity(value: number | null, unit = 'шт.'): string {
  const result = value === null ? unknownQuantity(unit) : knownQuantity(value, unit);
  return result.status === 'UNKNOWN' ? 'UNKNOWN' : `${result.value} ${result.unit}`;
}

function sumKnown(rows: readonly EquipmentEditorRow[], select: (row: EquipmentEditorRow) => number | null): number | null {
  let sum = 0;
  for (const row of rows) {
    const value = select(row);
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

function dimensions(row: EquipmentEditorRow): string {
  if (row.lengthM === null || row.widthM === null || row.heightM === null) return 'UNKNOWN';
  return `${row.lengthM} × ${row.widthM} × ${row.heightM} m`;
}

function groupNumber(value: string, field: string): number | null {
  if (!value.trim() || value.trim().toUpperCase() === 'UNKNOWN') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Поле ${field} должно содержать неотрицательное число или UNKNOWN`);
  return parsed;
}

export function EquipmentStep({ initialRows, operations, onChange, onSave }: {
  initialRows: readonly EquipmentEditorRow[];
  operations: EquipmentStepOperations;
  onChange?: (rows: readonly EquipmentEditorRow[]) => void;
  onSave?: (rows: readonly EquipmentEditorRow[]) => void;
}) {
  const [rows, setRows] = useState<readonly EquipmentEditorRow[]>(initialRows);
  const [tableText, setTableText] = useState('');
  const [exportText, setExportText] = useState('');
  const [mass, setMass] = useState('');
  const [crew, setCrew] = useState('');
  const [preview, setPreview] = useState<EquipmentGroupPreview | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setRows(initialRows), [initialRows]);
  const issues = operations.validateRows(rows);

  const updateRows = (next: readonly EquipmentEditorRow[]) => {
    setRows(next);
    onChange?.(next);
  };
  const importRows = () => {
    try {
      const result = operations.importTable(tableText);
      updateRows(result.rows);
      setPreview(null);
      setApplied(false);
      setExportText('');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось импортировать таблицу');
    }
  };
  const buildPreview = () => {
    try {
      const patch = { massTonnes: groupNumber(mass, 'массы'), crewAssigned: groupNumber(crew, 'экипажа') };
      setPreview(operations.previewGroupChange(rows, rows.map(row => row.id), patch));
      setApplied(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось построить предпросмотр');
    }
  };
  const applyPreview = () => {
    if (!preview) return;
    updateRows(operations.applyGroupChange(rows, preview));
    setApplied(true);
  };

  const updateQuantity = (id: string, field: 'actual' | 'SERVICEABLE', value: string) => {
    const quantity = value === '' ? null : Number(value);
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0)) return;
    updateRows(rows.map(row => row.id === id ? {
      ...row,
      ...(field === 'actual' ? { actual: quantity } : { stateCounts: { ...row.stateCounts, SERVICEABLE: quantity ?? 0 } }),
    } : row));
  };

  const authorized = sumKnown(rows, row => row.authorized);
  const actual = sumKnown(rows, row => row.actual);
  const serviceable = sumKnown(rows, row => row.stateCounts.SERVICEABLE);

  return <section aria-label="Техническая оснащённость">
    <h2>Техническая оснащённость</h2>
    <p>Штат: {quantity(authorized)}</p>
    <p>Факт: {quantity(actual)}</p>
    <p>Исправно: {quantity(serviceable)}</p>
    {onSave && <button type="button" onClick={() => onSave(rows)}>Применить ведомость</button>}

    {error && <p role="alert">{error}</p>}
    {issues.length > 0 && <ul aria-label="Ошибки ведомости" role="alert">
      {issues.map(issue => <li key={`${issue.rowId}-${issue.code}`}>{issue.message}</li>)}
    </ul>}

    <table>
      <caption>Ведомость штат/факт/исправно</caption>
      <thead><tr><th>Запись</th><th>Тип</th><th>Учёт</th><th>Штат</th><th>Факт</th><th>Исправно</th><th>Распределение</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.id}</td>
        <td>{row.typeTitle}</td>
        <td>{row.accounting === 'AGGREGATE' ? 'Агрегированный учёт' : 'Поштучный учёт'}</td>
        <td>{quantity(row.authorized)}</td>
        <td><input aria-label={`Факт ${row.id}`} type="number" min="0" value={row.actual ?? ''} onChange={event => updateQuantity(row.id, 'actual', event.target.value)} /></td>
        <td><input aria-label={`Исправно ${row.id}`} type="number" min="0" value={row.stateCounts.SERVICEABLE ?? ''} onChange={event => updateQuantity(row.id, 'SERVICEABLE', event.target.value)} /></td>
        <td>{row.actual === null ? 'UNKNOWN' : `${row.distribution.reduce((sum, entry) => sum + entry.quantity, 0)} / ${row.actual}`}</td>
      </tr>)}</tbody>
    </table>

    {rows.map(row => <details key={`details-${row.id}`}>
      <summary>Характеристики {row.id}</summary>
      <p>Масса: {quantity(row.massTonnes, 'tonne')}</p>
      <p>Габариты: {dimensions(row)}</p>
      <p>Ёмкость: {quantity(row.payloadTonnes, 'tonne')}; личный состав: {quantity(row.personnelCapacity, 'person')}</p>
      <p>Экипаж: {quantity(row.crewAssigned, 'person')}; требуется на единицу: {quantity(row.crewRequiredPerUnit, 'person')}</p>
      <p>Ресурсы: {row.operatingResources.length ? row.operatingResources.map(resource => `${resource.resourceId} ${resource.amountPerUnit} ${resource.unit}/ед.`).join(', ') : 'UNKNOWN'}</p>
      <p>Задачи: {row.allowedTasks.length ? row.allowedTasks.join(', ') : 'UNKNOWN'}</p>
      <p>Источник: {row.sourceId}; редакция {row.sourceRevision || 'UNKNOWN'}</p>
    </details>)}

    <fieldset>
      <legend>Табличный импорт и экспорт</legend>
      <label htmlFor="equipment-table">Таблица оснащённости</label>
      <textarea id="equipment-table" value={tableText} onChange={event => setTableText(event.target.value)} rows={5} />
      <button type="button" onClick={importRows}>Импортировать таблицу</button>
      <button type="button" onClick={() => setExportText(operations.exportTable(rows))}>Экспортировать таблицу</button>
      <label htmlFor="equipment-export">Результат экспорта</label>
      <textarea id="equipment-export" value={exportText} readOnly rows={5} />
    </fieldset>

    <fieldset>
      <legend>Групповое изменение всех показанных записей</legend>
      <label htmlFor="equipment-group-mass">Масса группы, tonne; пусто — UNKNOWN</label>
      <input id="equipment-group-mass" value={mass} onChange={event => setMass(event.target.value)} />
      <label htmlFor="equipment-group-crew">Экипаж группы, person; пусто — UNKNOWN</label>
      <input id="equipment-group-crew" value={crew} onChange={event => setCrew(event.target.value)} />
      <button type="button" onClick={buildPreview}>Предпросмотр группового изменения</button>
      {preview && <div>
        <p role="status">{preview.status}</p>
        <p>UNKNOWN: {preview.unknown.join(', ') || 'нет'}</p>
        <ul>{preview.changes.map(change => <li key={`${change.rowId}-${change.field}`}>
          {`${change.rowId}.${change.field}: ${change.from ?? 'UNKNOWN'} → ${change.to ?? 'UNKNOWN'}`}
        </li>)}</ul>
        {!applied && <button type="button" onClick={applyPreview}>Применить групповое изменение</button>}
      </div>}
    </fieldset>
  </section>;
}
