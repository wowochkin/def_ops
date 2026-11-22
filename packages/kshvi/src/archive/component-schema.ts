export type ArchiveFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';
export type ArchiveComponentRule = {
  format: 'json' | 'text' | 'html';
  fields?: Readonly<Record<string, ArchiveFieldType>>;
  nonEmpty?: readonly string[];
  itemFields?: Readonly<Record<string, readonly string[]>>;
};
const json = (
  fields: Readonly<Record<string, ArchiveFieldType>>,
  nonEmpty: readonly string[] = [],
  itemFields: Readonly<Record<string, readonly string[]>> = {},
): ArchiveComponentRule => ({ format: 'json', fields, nonEmpty, itemFields });

/**
 * Минимальная обязательная семантика каждого компонента. Пустые истории допускаются,
 * но структура, версии и содержимое исходного состояния должны присутствовать явно.
 */
export const ARCHIVE_COMPONENT_RULES: Readonly<Record<string, ArchiveComponentRule>> = {
  'exercise.card': json({ 'payload.card': 'object', 'payload.card.id': 'string', 'payload.card.title': 'string', 'payload.card.organizationId': 'string' }, ['payload.card.id', 'payload.card.title', 'payload.card.organizationId']),
  'scenario.revisions': json({ 'payload.revisions': 'array' }, ['payload.revisions']),
  'assumptions.passport': json({ 'payload.assumptions': 'array', 'payload.limitations': 'array' }),
  'snapshots.initial': json({ 'payload.snapshots': 'array' }, ['payload.snapshots'], { 'payload.snapshots': ['state'] }),
  'snapshots.intermediate': json({ 'payload.snapshots': 'array' }, [], { 'payload.snapshots': ['state'] }),
  'snapshots.final': json({ 'payload.snapshots': 'array' }, ['payload.snapshots'], { 'payload.snapshots': ['state'] }),
  'journal.events': json({ 'payload.events': 'array' }, ['payload.events'], { 'payload.events': ['eventId', 'type'] }),
  'journal.hash-chain': json({ 'payload.algorithm': 'string', 'payload.links': 'array' }, ['payload.algorithm', 'payload.links']),
  'replay.archive': json({ events: 'array', snapshots: 'array', versions: 'object' }, ['versions']),
  'replay.control-points': json({ 'payload.points': 'array' }, ['payload.points']),
  'environment.map': json({ 'payload.map': 'object', 'payload.map.style': 'object', 'payload.map.bounds': 'array' }, ['payload.map.style', 'payload.map.bounds']),
  'environment.initial': json({ 'payload.state': 'object' }, ['payload.state']),
  'environment.tiles': json({ 'payload.tiles': 'array' }, ['payload.tiles'], { 'payload.tiles': ['data'] }),
  'environment.elevations': json({ 'payload.grid': 'object', 'payload.grid.width': 'number', 'payload.grid.height': 'number', 'payload.grid.values': 'array' }, ['payload.grid.values']),
  'environment.weather': json({ 'payload.frames': 'array' }, ['payload.frames'], { 'payload.frames': ['operationalAt'] }),
  'environment.terrain-initial': json({ 'payload.state': 'object', 'payload.initialVersionId': 'string' }, ['payload.state', 'payload.initialVersionId']),
  'environment.terrain-history': json({ 'payload.versions': 'array', 'payload.initialVersionId': 'string' }, ['payload.initialVersionId']),
  'environment.attribution': json({ 'payload.attribution': 'string', 'payload.license': 'string', 'payload.offlineExport': 'boolean' }, ['payload.attribution', 'payload.license']),
  'environment.tile-reference': json({ 'payload.reference': 'object', 'payload.attribution': 'string' }, ['payload.reference', 'payload.attribution']),
  'forces.structure': json({ 'payload.forces': 'array' }, ['payload.forces']),
  'forces.equipment': json({ 'payload.holdings': 'array' }, ['payload.holdings']),
  'forces.morale-psych': json({ 'payload.states': 'array' }, ['payload.states']),
  'forces.readiness': json({ 'payload.states': 'array' }, ['payload.states']),
  'forces.readiness-activities': json({ 'payload.activities': 'array' }),
  'forces.formation': json({ 'payload.formations': 'array' }, ['payload.formations']),
  'logistics.resources': json({ 'payload.balances': 'array' }, ['payload.balances']),
  'logistics.depots': json({ 'payload.depots': 'array' }, ['payload.depots']),
  'logistics.supply-requests': json({ 'payload.requests': 'array' }),
  'logistics.supply-movements': json({ 'payload.movements': 'array' }),
  'logistics.repair-evacuation': json({ 'payload.operations': 'array' }),
  'communications.queue': json({ 'payload.channels': 'array', 'payload.queue': 'array' }, ['payload.channels']),
  'communications.attempts': json({ 'payload.channels': 'array', 'payload.attempts': 'array' }, ['payload.channels']),
  'documents.revisions': json({ 'payload.revisions': 'array' }),
  'documents.printed-forms': json({ 'payload.revision': 'number', 'payload.forms': 'array' }),
  'event-catalog.versions': json({ 'payload.catalogs': 'array' }, ['payload.catalogs']),
  'event-catalog.intensity': json({ 'payload.profiles': 'array' }, ['payload.profiles']),
  'scheduler.candidates': json({ 'payload.algorithmVersion': 'number', 'payload.attempts': 'array' }),
  'scheduler.random-keys': json({ 'payload.algorithmVersion': 'number', 'payload.keys': 'array' }),
  'agents.assignments': json({ 'payload.assignments': 'array' }),
  'agents.profiles': json({ 'payload.profiles': 'array' }, ['payload.profiles']),
  'agents.decision-traces': json({ 'payload.traces': 'array' }),
  'agents.variant-runs': json({ 'payload.runs': 'array' }),
  'symbols.set': json({ 'payload.setId': 'string', 'payload.symbols': 'array' }, ['payload.setId', 'payload.symbols']),
  'symbols.vector-definitions': json({ 'payload.definitions': 'array' }, ['payload.definitions']),
  'symbols.sources': json({ 'payload.sources': 'array' }, ['payload.sources']),
  'symbols.render-rules': json({ 'payload.rules': 'array' }, ['payload.rules']),
  'symbols.legends': json({ 'payload.legends': 'array' }, ['payload.legends']),
  'decisions.records': json({ 'payload.algorithmVersions': 'array', 'payload.records': 'array' }, ['payload.algorithmVersions']),
  'calculations.records': json({ 'payload.algorithmVersions': 'array', 'payload.records': 'array' }, ['payload.algorithmVersions']),
  'models.versions': json({ 'payload.models': 'array' }, ['payload.models']),
  'models.algorithm-versions': json({ 'payload.algorithms': 'array' }, ['payload.algorithms']),
  'references.modern': json({ 'payload.references': 'array' }, ['payload.references']),
  'assessments.sheets': json({ 'payload.sheets': 'array' }),
  'debriefs.materials': json({ 'payload.sections': 'array' }, ['payload.sections']),
  'research.cards': json({ 'payload.cards': 'array' }),
  'branches.comparisons': json({ 'payload.comparisons': 'array' }),
  'participants.assignments': json({ 'payload.assignments': 'array' }, ['payload.assignments'], { 'payload.assignments': ['userId', 'role', 'sideId'] }),
  'viewer.engine': { format: 'text' },
  'viewer.resources': json({ 'payload.resources': 'object' }, ['payload.resources']),
  'viewer.index': { format: 'html' },
  'exposition.program': json({ 'payload.chapters': 'array' }, ['payload.chapters']),
  'exposition.explanations': json({ 'payload.resources': 'object' }, ['payload.resources']),
  'exposition.audience-policy': json({ 'payload.policy': 'object', 'payload.allowedAudiences': 'array' }, ['payload.policy', 'payload.allowedAudiences']),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function readPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => isObject(value) ? value[key] : undefined, root);
}
function matchesType(value: unknown, type: ArchiveFieldType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  return typeof value === type;
}
function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

export function validateArchiveComponent(componentId: string, bytes: Uint8Array): string[] {
  const rule = ARCHIVE_COMPONENT_RULES[componentId];
  if (!rule) return [`${componentId}: отсутствует схема содержимого`];
  const text = new TextDecoder().decode(bytes);
  if (rule.format === 'text') {
    return text.includes('recordedReplayAt') && text.trim().length > 20 ? [] : [`${componentId}: отсутствует локальный recordedReplayAt`];
  }
  if (rule.format === 'html') {
    return text.includes('<html') && text.includes('archive-package') ? [] : [`${componentId}: отсутствует автономная HTML-оболочка`];
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return [`${componentId}: некорректный JSON`]; }
  if (!isObject(value)) return [`${componentId}: содержимое должно быть объектом, не null/пустым значением`];
  if (value.schemaVersion !== 1) return [`${componentId}: требуется schemaVersion 1`];
  if (componentId !== 'replay.archive' && !isObject(value.payload)) return [`${componentId}: отсутствует объект payload`];
  const issues: string[] = [];
  for (const [path, type] of Object.entries(rule.fields ?? {})) {
    const field = readPath(value, path);
    if (!matchesType(field, type)) issues.push(`${componentId}: поле ${path} должно иметь тип ${type}`);
    if (type === 'array' && Array.isArray(field)) {
      field.forEach((item, index) => {
        if (item === null || item === undefined || (typeof item === 'string' && !item.trim())
          || (isObject(item) && Object.keys(item).length === 0) || (Array.isArray(item) && item.length === 0)) {
          issues.push(`${componentId}: пустая запись ${path}[${index}]`);
          return;
        }
        if (isObject(item)) {
          for (const requiredPath of rule.itemFields?.[path] ?? []) {
            if (!nonEmpty(readPath(item, requiredPath))) issues.push(`${componentId}: запись ${path}[${index}] не содержит ${requiredPath}`);
          }
        }
      });
    }
  }
  for (const path of rule.nonEmpty ?? []) {
    if (!nonEmpty(readPath(value, path))) issues.push(`${componentId}: поле ${path} не должно быть пустым`);
  }
  return issues;
}
