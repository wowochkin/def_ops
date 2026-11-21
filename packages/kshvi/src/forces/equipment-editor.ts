import {
  createEquipmentHolding,
  EQUIPMENT_CONDITIONS,
  type EquipmentAccounting,
  type EquipmentCondition,
  type EquipmentDistribution,
  type EquipmentHolding,
  type EquipmentMeasure,
  type EquipmentSource,
  type EquipmentStateCounts,
  type EquipmentType,
  type EquipmentUnitInput,
} from './equipment';

export type EquipmentEditorResource = Readonly<{
  resourceId: string;
  amountPerUnit: number;
  unit: string;
}>;

export type EquipmentEditorRow = Readonly<{
  id: string;
  forceId: string;
  accounting: EquipmentAccounting;
  typeId: string;
  typeRevision: number;
  typeSha256: string;
  typeTitle: string;
  movementClass: string;
  authorized: number | null;
  actual: number | null;
  stateCounts: EquipmentStateCounts;
  crewRequiredPerUnit: number | null;
  crewAssigned: number | null;
  massTonnes: number | null;
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  payloadTonnes: number | null;
  personnelCapacity: number | null;
  operatingResources: readonly EquipmentEditorResource[];
  allowedTasks: readonly string[];
  environmentLimits: readonly string[];
  distribution: readonly EquipmentDistribution[];
  sourceId: string;
  sourceRevision: number;
  sourceSha256: string;
  items?: readonly EquipmentUnitInput[];
}>;

export type EquipmentEditorIssue = Readonly<{
  code: 'STATE_SUM_MISMATCH' | 'DISTRIBUTION_EXCEEDS_ACTUAL' | 'INVALID_COUNT' | 'INVALID_MEASURE' | 'SOURCE_REQUIRED' | 'DUPLICATE_ROW';
  rowId: string;
  message: string;
}>;

export type EquipmentImportResult = Readonly<{
  rows: readonly EquipmentEditorRow[];
  unknown: readonly string[];
  issues: readonly EquipmentEditorIssue[];
}>;

export type EquipmentNullableField = 'authorized' | 'actual' | 'crewRequiredPerUnit' | 'crewAssigned' | 'massTonnes' | 'lengthM' | 'widthM' | 'heightM' | 'payloadTonnes' | 'personnelCapacity';
export type EquipmentGroupPatch = Partial<Readonly<Record<EquipmentNullableField, number | null>>>;
export type EquipmentGroupChange = Readonly<{
  rowId: string;
  field: EquipmentNullableField;
  from: number | null;
  to: number | null;
  status: 'KNOWN' | 'UNKNOWN';
}>;
export type EquipmentGroupPreview = Readonly<{
  status: 'CALCULATED' | 'REQUIRES_REVIEW';
  changes: readonly EquipmentGroupChange[];
  unknown: readonly string[];
  patch: EquipmentGroupPatch;
  rowIds: readonly string[];
}>;

export type EquipmentTemplateRow = Readonly<{
  id: string;
  forceId: string;
  typeId: string;
  typeRevision: number;
  typeSha256: string;
  typeTitle?: string;
  movementClass?: string;
  accounting?: EquipmentAccounting;
  authorized: number | null;
  allowedTasks?: readonly string[];
  sourceId: string;
  sourceRevision?: number;
  sourceSha256?: string;
  items?: readonly EquipmentUnitInput[];
}>;

const NULLABLE_FIELDS: readonly EquipmentNullableField[] = [
  'authorized', 'actual', 'crewRequiredPerUnit', 'crewAssigned', 'massTonnes',
  'lengthM', 'widthM', 'heightM', 'payloadTonnes', 'personnelCapacity',
];

const COLUMNS = [
  'id', 'forceId', 'accounting', 'typeId', 'typeRevision', 'typeSha256', 'typeTitle', 'movementClass',
  'authorized', 'actual', ...EQUIPMENT_CONDITIONS,
  'crewRequiredPerUnit', 'crewAssigned', 'massTonnes', 'lengthM', 'widthM', 'heightM',
  'payloadTonnes', 'personnelCapacity', 'operatingResources', 'allowedTasks', 'environmentLimits',
  'distribution', 'items', 'sourceId', 'sourceRevision', 'sourceSha256',
] as const;

function zeroCounts(): Record<EquipmentCondition, number> {
  return Object.fromEntries(EQUIPMENT_CONDITIONS.map(condition => [condition, 0])) as Record<EquipmentCondition, number>;
}

function sourceFor(row: EquipmentEditorRow): EquipmentSource {
  return { sourceId: row.sourceId, revision: row.sourceRevision, sha256: row.sourceSha256 };
}

function measure(value: number | null, unit: string, source: EquipmentSource): EquipmentMeasure {
  return value === null
    ? { status: 'UNKNOWN', value: null, unit, reason: 'Не заполнено в табличном редакторе' }
    : { status: 'KNOWN', value, unit, source };
}

function typeFromRow(row: EquipmentEditorRow): EquipmentType {
  const source = sourceFor(row);
  return {
    id: row.typeId,
    revision: row.typeRevision,
    sha256: row.typeSha256,
    title: row.typeTitle,
    movementClass: row.movementClass,
    massTonnes: measure(row.massTonnes, 'tonne', source),
    dimensions: {
      lengthM: measure(row.lengthM, 'm', source),
      widthM: measure(row.widthM, 'm', source),
      heightM: measure(row.heightM, 'm', source),
    },
    transportCapacity: {
      payloadTonnes: measure(row.payloadTonnes, 'tonne', source),
      personnel: measure(row.personnelCapacity, 'person', source),
    },
    operatingResources: row.operatingResources.map(resource => ({ ...resource, source })),
    allowedTasks: [...row.allowedTasks],
    environmentLimits: [...row.environmentLimits],
  };
}

export function equipmentHoldingFromRow(row: EquipmentEditorRow): EquipmentHolding {
  return createEquipmentHolding({
    id: row.id,
    forceId: row.forceId,
    accounting: row.accounting,
    equipmentType: typeFromRow(row),
    authorized: row.authorized,
    actual: row.actual,
    stateCounts: { ...row.stateCounts },
    crew: {
      requiredPerUnit: measure(row.crewRequiredPerUnit, 'person', sourceFor(row)),
      assigned: measure(row.crewAssigned, 'person', sourceFor(row)),
    },
    distribution: row.distribution.map(entry => ({ ...entry, unitIds: entry.unitIds ? [...entry.unitIds] : undefined })),
    items: row.items?.map(item => ({ ...item })),
    source: sourceFor(row),
  });
}

export function equipmentRowFromHolding(holding: EquipmentHolding): EquipmentEditorRow {
  const known = (value: EquipmentMeasure): number | null => value.status === 'KNOWN' ? value.value : null;
  return {
    id: holding.id,
    forceId: holding.forceId,
    accounting: holding.accounting,
    typeId: holding.equipmentType.id,
    typeRevision: holding.equipmentType.revision,
    typeSha256: holding.equipmentType.sha256,
    typeTitle: holding.equipmentType.title,
    movementClass: holding.equipmentType.movementClass,
    authorized: holding.authorized,
    actual: holding.actual,
    stateCounts: { ...holding.stateCounts },
    crewRequiredPerUnit: known(holding.crew.requiredPerUnit),
    crewAssigned: known(holding.crew.assigned),
    massTonnes: known(holding.equipmentType.massTonnes),
    lengthM: known(holding.equipmentType.dimensions.lengthM),
    widthM: known(holding.equipmentType.dimensions.widthM),
    heightM: known(holding.equipmentType.dimensions.heightM),
    payloadTonnes: known(holding.equipmentType.transportCapacity.payloadTonnes),
    personnelCapacity: known(holding.equipmentType.transportCapacity.personnel),
    operatingResources: holding.equipmentType.operatingResources.map(resource => ({
      resourceId: resource.resourceId,
      amountPerUnit: resource.amountPerUnit,
      unit: resource.unit,
    })),
    allowedTasks: [...holding.equipmentType.allowedTasks],
    environmentLimits: [...holding.equipmentType.environmentLimits],
    distribution: holding.distribution.map(entry => ({ ...entry, unitIds: entry.unitIds ? [...entry.unitIds] : undefined })),
    sourceId: holding.source.sourceId,
    sourceRevision: holding.source.revision ?? 0,
    sourceSha256: holding.source.sha256 ?? '',
    ...(holding.accounting === 'INDIVIDUAL' ? {
      items: holding.items.map(item => ({ unitId: item.unitId, serialNumber: item.serialNumber, state: item.state, causeId: item.causeId, assignedTo: item.assignedTo })),
    } : {}),
  };
}

function validCount(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

export function validateEquipmentEditorRows(rows: readonly EquipmentEditorRow[]): readonly EquipmentEditorIssue[] {
  const issues: EquipmentEditorIssue[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) issues.push({ code: 'DUPLICATE_ROW', rowId: row.id, message: 'Идентификатор строки повторяется' });
    seen.add(row.id);
    if (!validCount(row.authorized) || !validCount(row.actual) || Object.values(row.stateCounts).some(value => !validCount(value))) {
      issues.push({ code: 'INVALID_COUNT', rowId: row.id, message: 'Количество должно быть неотрицательным целым или UNKNOWN' });
    }
    const counted = Object.values(row.stateCounts).reduce((sum, value) => sum + value, 0);
    if (row.actual !== null && counted !== row.actual) {
      issues.push({ code: 'STATE_SUM_MISMATCH', rowId: row.id, message: 'Сумма состояний не равна фактическому количеству' });
    }
    if (row.actual === null && counted !== 0) {
      issues.push({ code: 'STATE_SUM_MISMATCH', rowId: row.id, message: 'При UNKNOWN фактическом количестве нельзя задавать известную сумму состояний' });
    }
    const distributed = row.distribution.reduce((sum, entry) => sum + entry.quantity, 0);
    if (row.actual !== null && distributed > row.actual) {
      issues.push({ code: 'DISTRIBUTION_EXCEEDS_ACTUAL', rowId: row.id, message: 'Распределение превышает фактическое количество' });
    }
    for (const field of NULLABLE_FIELDS) {
      if (field === 'authorized' || field === 'actual') continue;
      const value = row[field];
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        issues.push({ code: 'INVALID_MEASURE', rowId: row.id, message: `Поле ${field} должно быть неотрицательным числом или UNKNOWN` });
      }
    }
    if (!row.sourceId.trim() || !Number.isSafeInteger(row.sourceRevision) || row.sourceRevision < 1 || !/^[0-9a-f]{64}$/.test(row.sourceSha256)) {
      issues.push({ code: 'SOURCE_REQUIRED', rowId: row.id, message: 'Нужны источник, редакция и SHA-256' });
    }
  }
  return issues;
}

export function previewEquipmentGroupChange(
  rows: readonly EquipmentEditorRow[],
  rowIds: readonly string[],
  patch: EquipmentGroupPatch,
): EquipmentGroupPreview {
  const selected = new Set(rowIds);
  const changes: EquipmentGroupChange[] = [];
  const unknown = new Set<string>();
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    for (const field of NULLABLE_FIELDS) {
      if (row[field] === null) unknown.add(`${row.id}.${field}`);
    }
    for (const [field, to] of Object.entries(patch) as [EquipmentNullableField, number | null][]) {
      if (to !== null && (!Number.isFinite(to) || to < 0)) throw new Error(`Некорректное групповое значение ${field}`);
      const from = row[field];
      if (from === to) continue;
      changes.push({ rowId: row.id, field, from, to, status: to === null ? 'UNKNOWN' : 'KNOWN' });
      if (to === null) unknown.add(`${row.id}.${field}`);
    }
  }
  return {
    status: unknown.size ? 'REQUIRES_REVIEW' : 'CALCULATED',
    changes,
    unknown: [...unknown],
    patch: { ...patch },
    rowIds: [...rowIds],
  };
}

export function applyEquipmentGroupChange(rows: readonly EquipmentEditorRow[], preview: EquipmentGroupPreview): readonly EquipmentEditorRow[] {
  const selected = new Set(preview.rowIds);
  return rows.map(row => {
    if (!selected.has(row.id)) return row;
    const next = { ...row, stateCounts: { ...row.stateCounts } } as {
      -readonly [K in keyof EquipmentEditorRow]: EquipmentEditorRow[K]
    };
    for (const [field, value] of Object.entries(preview.patch) as [EquipmentNullableField, number | null][]) {
      next[field] = value;
    }
    return next;
  });
}

export function createEquipmentRowsFromTemplate(template: readonly EquipmentTemplateRow[]): readonly EquipmentEditorRow[] {
  return template.map(row => ({
    id: row.id,
    forceId: row.forceId,
    accounting: row.accounting ?? (row.items?.length ? 'INDIVIDUAL' : 'AGGREGATE'),
    typeId: row.typeId,
    typeRevision: row.typeRevision,
    typeSha256: row.typeSha256,
    typeTitle: row.typeTitle ?? row.typeId,
    movementClass: row.movementClass ?? 'UNKNOWN',
    authorized: row.authorized,
    actual: row.items?.length ?? null,
    stateCounts: row.items?.length
      ? row.items.reduce((counts, item) => ({ ...counts, [item.state]: counts[item.state] + 1 }), zeroCounts())
      : zeroCounts(),
    crewRequiredPerUnit: null,
    crewAssigned: null,
    massTonnes: null,
    lengthM: null,
    widthM: null,
    heightM: null,
    payloadTonnes: null,
    personnelCapacity: null,
    operatingResources: [],
    allowedTasks: [...(row.allowedTasks ?? [])],
    environmentLimits: [],
    distribution: [],
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision ?? 0,
    sourceSha256: row.sourceSha256 ?? '',
    items: row.items?.map(item => ({ ...item })),
  }));
}

function delimiterFor(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(';')) return ';';
  return ',';
}

function parseCsv(text: string): string[][] {
  const delimiter = delimiterFor(text);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === delimiter) {
      record.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Незакрытая кавычка в таблице оснащённости');
  if (cell.length || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records.filter(cells => cells.some(value => value.trim() !== ''));
}

function nullableNumber(value: string | undefined): number | null {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.toUpperCase() === 'UNKNOWN') return null;
  const parsed = Number(normalized.replace(',', '.'));
  if (!Number.isFinite(parsed)) throw new Error(`Некорректное числовое значение: ${normalized}`);
  return parsed;
}

function requiredNumber(value: string | undefined, fallback = 0): number {
  return nullableNumber(value) ?? fallback;
}

function stringList(value: string | undefined): string[] {
  return (value ?? '').split('|').map(item => item.trim()).filter(Boolean);
}

function parseResources(value: string | undefined): EquipmentEditorResource[] {
  return stringList(value).map(entry => {
    const [resourceId, amount, unit] = entry.split(':');
    const amountPerUnit = Number(amount);
    if (!resourceId || !Number.isFinite(amountPerUnit) || amountPerUnit < 0 || !unit) throw new Error('Некорректный ресурс в таблице');
    return { resourceId, amountPerUnit, unit };
  });
}

function parseDistribution(value: string | undefined): EquipmentDistribution[] {
  return stringList(value).map(entry => {
    const [targetId, allocated] = entry.split(':');
    if (!targetId || !allocated) throw new Error('Некорректное распределение в таблице');
    if (/^\d+$/.test(allocated)) return { targetId, quantity: Number(allocated) };
    const unitIds = allocated.split('+').filter(Boolean);
    if (!unitIds.length) throw new Error('Пустое поштучное распределение');
    return { targetId, quantity: unitIds.length, unitIds };
  });
}

function parseItems(value: string | undefined): EquipmentUnitInput[] | undefined {
  if (!value?.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Поштучные записи таблицы должны быть массивом');
  return parsed.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Некорректная поштучная запись таблицы');
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.unitId !== 'string' || typeof candidate.serialNumber !== 'string' || !EQUIPMENT_CONDITIONS.includes(candidate.state as EquipmentCondition)) {
      throw new Error('Поштучная запись требует unitId, serialNumber и состояние');
    }
    return {
      unitId: candidate.unitId,
      serialNumber: candidate.serialNumber,
      state: candidate.state as EquipmentCondition,
      causeId: typeof candidate.causeId === 'string' ? candidate.causeId : null,
      assignedTo: typeof candidate.assignedTo === 'string' ? candidate.assignedTo : null,
    };
  });
}

export function importEquipmentTable(text: string): EquipmentImportResult {
  const records = parseCsv(text);
  if (!records.length) return { rows: [], unknown: [], issues: [] };
  const headers = records[0].map(header => header.trim());
  const unknown = new Set<string>();
  const rows = records.slice(1).map(cells => {
    const get = (name: string): string | undefined => {
      const index = headers.indexOf(name);
      return index >= 0 ? cells[index]?.trim() : undefined;
    };
    const id = get('id') ?? '';
    const stateCounts = zeroCounts();
    for (const condition of EQUIPMENT_CONDITIONS) stateCounts[condition] = requiredNumber(get(condition));
    const row: EquipmentEditorRow = {
      id,
      forceId: get('forceId') ?? '',
      accounting: get('accounting') === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'AGGREGATE',
      typeId: get('typeId') ?? '',
      typeRevision: requiredNumber(get('typeRevision'), 1),
      typeSha256: get('typeSha256') ?? '',
      typeTitle: get('typeTitle') || (get('typeId') ?? ''),
      movementClass: get('movementClass') || 'UNKNOWN',
      authorized: nullableNumber(get('authorized')),
      actual: nullableNumber(get('actual')),
      stateCounts,
      crewRequiredPerUnit: nullableNumber(get('crewRequiredPerUnit')),
      crewAssigned: nullableNumber(get('crewAssigned')),
      massTonnes: nullableNumber(get('massTonnes')),
      lengthM: nullableNumber(get('lengthM')),
      widthM: nullableNumber(get('widthM')),
      heightM: nullableNumber(get('heightM')),
      payloadTonnes: nullableNumber(get('payloadTonnes')),
      personnelCapacity: nullableNumber(get('personnelCapacity')),
      operatingResources: parseResources(get('operatingResources')),
      allowedTasks: stringList(get('allowedTasks')),
      environmentLimits: stringList(get('environmentLimits')),
      distribution: parseDistribution(get('distribution')),
      items: parseItems(get('items')),
      sourceId: get('sourceId') ?? '',
      sourceRevision: requiredNumber(get('sourceRevision')),
      sourceSha256: get('sourceSha256') ?? '',
    };
    for (const field of NULLABLE_FIELDS) if (row[field] === null) unknown.add(`${id}.${field}`);
    return row;
  });
  return { rows, unknown: [...unknown], issues: validateEquipmentEditorRows(rows) };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? 'UNKNOWN' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportEquipmentTable(rows: readonly EquipmentEditorRow[]): string {
  const lines = [COLUMNS.join(';')];
  for (const row of rows) {
    const values: Record<string, string | number | null> = {
      id: row.id,
      forceId: row.forceId,
      accounting: row.accounting,
      typeId: row.typeId,
      typeRevision: row.typeRevision,
      typeSha256: row.typeSha256,
      typeTitle: row.typeTitle,
      movementClass: row.movementClass,
      authorized: row.authorized,
      actual: row.actual,
      crewRequiredPerUnit: row.crewRequiredPerUnit,
      crewAssigned: row.crewAssigned,
      massTonnes: row.massTonnes,
      lengthM: row.lengthM,
      widthM: row.widthM,
      heightM: row.heightM,
      payloadTonnes: row.payloadTonnes,
      personnelCapacity: row.personnelCapacity,
      operatingResources: row.operatingResources.map(resource => `${resource.resourceId}:${resource.amountPerUnit}:${resource.unit}`).join('|'),
      allowedTasks: row.allowedTasks.join('|'),
      environmentLimits: row.environmentLimits.join('|'),
      distribution: row.distribution.map(entry => `${entry.targetId}:${entry.unitIds?.length ? entry.unitIds.join('+') : entry.quantity}`).join('|'),
      items: row.items?.length ? JSON.stringify(row.items) : '',
      sourceId: row.sourceId,
      sourceRevision: row.sourceRevision,
      sourceSha256: row.sourceSha256,
    };
    for (const condition of EQUIPMENT_CONDITIONS) values[condition] = row.stateCounts[condition];
    lines.push(COLUMNS.map(column => csvCell(values[column] ?? null)).join(';'));
  }
  return `${lines.join('\r\n')}\r\n`;
}
