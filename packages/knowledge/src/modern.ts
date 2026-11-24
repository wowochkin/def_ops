/** Отдельный исследовательский корпус современного режима. Не входы исторической или боевой модели. */
import data from '../data/modern/corpus.json' with { type: 'json' };
import passportData from '../data/modern/passport-schema.json' with { type: 'json' };
import type { Entry } from './schema';

type Evidence = { sources: string[] };
export type OrganizationKind = 'organization' | 'service' | 'reported_service' | 'independent_branch' | 'branch_group' | 'branch' | 'component';
export interface ModernSource {
  id: string; title: string; publisher: string; url: string;
  kind: 'national_authority' | 'manufacturer' | 'intergovernmental' | 'research' | 'foreign_official_assessment' | 'encyclopedia';
  scopeDate: string | null; accessedOn: string;
  readLevel: 'page' | 'search_excerpt' | 'unavailable'; note: string;
}
export interface ModernOrganization extends Evidence {
  id: string; country: string; parent: string | null; title: string; nativeName: string;
  kind: OrganizationKind; status: 'draft'; note: string;
}
export interface ModernRepresentative extends Evidence {
  id: string; kind: 'equipment_model'; countryContext: string; title: string; objectClass: string;
  summary: string; relatedOrganizations: string[]; originCountries: string[]; operatorCountries: string[];
  status: 'draft'; note: string;
  granularity: 'family' | 'model' | 'variant'; parentModel: string | null;
  catalogueOnly?: boolean;
  inventoryReferences?: { source: string; section: string; designation: string; modelUrl: string | null; catalogueStatus: 'listed' | 'prospective' }[];
  passport: ReferencePassport;
}
export interface ReferenceCharacteristic {
  field: string; value: number | string; unit: string | null; source: string;
  locator: string; scope: string; status: 'reported';
  qualifier?: 'exact' | 'approximate' | 'at_least' | 'at_most' | 'greater_than' | 'less_than';
}
export interface ReferencePassport {
  profile: string; simulationValidated: false; characteristics: ReferenceCharacteristic[];
}
export interface HierarchyTemplate extends Evidence {
  id: string; country: string; service: string | null; title?: string; status: 'draft' | 'pending_research';
  levels: { id: string; title: string; nativeName: string; passport: ReferencePassport }[]; note: string;
  passport: ReferencePassport;
}
/** Подчинённость конкретных формирований хранится отдельно от классификации видов и родов войск. */
export interface ModernUnit extends Evidence {
  id: string; country: string; title: string; hierarchyTemplate: string; level: string;
  classifications: string[];
}
export interface Subordination extends Evidence {
  child: string; parent: string;
  kind: 'administrative' | 'operational' | 'attachment';
  from: string; to: string | null;
}
export interface ModernCorpus {
  schemaVersion: 1; mode: 'modern'; purpose: 'reference'; modelInputs: false; language: 'ru'; researchDate: string;
  countries: (Evidence & { code: string; title: string; root: string; coverage: 'partial'; gaps: string[] })[];
  sources: ModernSource[]; organizations: ModernOrganization[];
  objectClasses: { id: string; title: string }[];
  representatives: ModernRepresentative[]; hierarchyTemplates: HierarchyTemplate[];
  units: ModernUnit[]; subordination: Subordination[];
  principles: (Evidence & { id: string; title: string; text: string; basis: 'project_requirement' | 'research_note' })[];
  researchQueue: { id: string; targetKind: 'equipment' | 'hierarchy'; target: string;
    status: 'pending_research' | 'sources_identified' | 'in_progress'; sourceIds: string[]; tasks: string[] }[];
}
export const modernCorpus = data as ModernCorpus;
export const passportSchema = passportData as {
  version: number; purpose: string; note: string;
  fields: { id: string; title: string; unit: string | null; valueType: 'number' | 'string' }[];
  profiles: { id: string; title: string; required: string[] }[];
};
export const characteristicTitle = (field: string) => passportSchema.fields.find(f => f.id === field)?.title ?? field;
export const characteristicPrefix = (c: ReferenceCharacteristic) => ({ exact: '', approximate: '≈ ', at_least: '≥ ', at_most: '≤ ', greater_than: '> ', less_than: '< ' })[c.qualifier ?? 'exact'];
/** Границы связываются только в рамках одного источника и одной области применимости. */
export function organizationSizeLabels(passport: ReferencePassport): string[] {
  const groups = new Map<string, ReferenceCharacteristic[]>();
  for (const c of passport.characteristics) if (['personnel_reference', 'personnel_min', 'personnel_max'].includes(c.field) && typeof c.value === 'number') {
    const key = JSON.stringify([c.source, c.scope]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const number = (c: ReferenceCharacteristic) => Number(c.value).toLocaleString('ru-RU');
  return [...groups.values()].map(rows => {
    const point = rows.find(c => c.field === 'personnel_reference');
    if (point) return `${characteristicPrefix(point)}${number(point)} чел.`;
    const min = rows.find(c => c.field === 'personnel_min');
    const max = rows.find(c => c.field === 'personnel_max');
    if (min && max) return `${min.qualifier === 'approximate' || max.qualifier === 'approximate' ? '≈ ' : ''}${number(min)}–${number(max)} чел.`;
    return min ? `${min.qualifier === 'greater_than' ? '>' : '≥'} ${number(min)} чел.` : `${max!.qualifier === 'less_than' ? '<' : '≤'} ${number(max!)} чел.`;
  });
}
/** Документальная заполненность не означает достоверность параметров или готовность агента. Наследования между вариантами нет. */
export function passportCoverage(record: { passport: ReferencePassport }) {
  const required = passportSchema.profiles.find(p => p.id === record.passport.profile)?.required ?? [];
  const documented = new Set(record.passport.characteristics.map(c => c.field));
  return { required, missing: required.filter(id => !documented.has(id)), documented: required.filter(id => documented.has(id)).length, totalDocumented: documented.size,
    referenceComplete: required.length > 0 && required.every(id => documented.has(id)), simulationValidated: false as const };
}

/** Проверяет целостность корпуса, но не подтверждает достоверность внешних утверждений. */
export function validateModernCorpus(corpus: ModernCorpus): string[] {
  const errors: string[] = [];
  const unique = (rows: { id: string }[], group: string) => {
    const ids = new Set<string>();
    for (const r of rows) { if (ids.has(r.id)) errors.push(`${group}: повтор id ${r.id}`); ids.add(r.id); }
    return ids;
  };
  const sources = new Map(corpus.sources.map(s => [s.id, s]));
  unique(corpus.sources, 'источники');
  const countryIds = corpus.countries.map(c => ({ id: c.code }));
  const countries = unique(countryIds, 'страны');
  const nodes = new Map(corpus.organizations.map(n => [n.id, n]));
  unique(corpus.organizations, 'организации');
  const classes = unique(corpus.objectClasses, 'классы объектов');
  unique(corpus.representatives, 'представители');
  const templates = new Map(corpus.hierarchyTemplates.map(t => [t.id, t]));
  unique(corpus.hierarchyTemplates, 'схемы уровней');
  unique(corpus.principles, 'принципы');
  const evidence = (id: string, row: Evidence, required = true) => {
    if (required && !row.sources.length) errors.push(`${id}: отсутствует источник`);
    for (const s of row.sources) {
      if (!sources.has(s)) errors.push(`${id}: неизвестный источник ${s}`);
      else if (sources.get(s)?.readLevel === 'unavailable') errors.push(`${id}: недоступный источник не подтверждает факт`);
    }
  };
  const passport = (id: string, p: ReferencePassport, expectedProfile: string) => {
    if (!p || p.profile !== expectedProfile || !passportSchema.profiles.some(s => s.id === p.profile) || p.simulationValidated !== false) {
      errors.push(`${id}: неверный справочный паспорт`); return;
    }
    for (const c of p.characteristics) {
      evidence(id, { sources: [c.source] });
      const f = passportSchema.fields.find(f => f.id === c.field);
      if (!f || typeof c.value !== f.valueType) errors.push(`${id}: неизвестное поле или тип характеристики ${c.field}`);
      else if (c.unit !== f.unit) errors.push(`${id}: неверная единица измерения ${c.field}`);
      if (!c.locator || !c.scope || c.status !== 'reported') errors.push(`${id}: не указано происхождение и применимость характеристики`);
      if (c.qualifier !== undefined && (typeof c.value !== 'number' || !['exact', 'approximate', 'at_least', 'at_most', 'greater_than', 'less_than'].includes(c.qualifier))) errors.push(`${id}: неверный квалификатор значения`);
      if (typeof c.value === 'number' && (!Number.isFinite(c.value) || c.value < 0)) errors.push(`${id}: неверное числовое значение`);
    }
  };
  if (corpus.mode !== 'modern' || corpus.modelInputs !== false || corpus.purpose !== 'reference' || corpus.schemaVersion !== 1) errors.push('Корпус должен оставаться справочным и изолированным');
  for (const s of corpus.sources) {
    try { if (new URL(s.url).protocol !== 'https:') errors.push(`${s.id}: нужен HTTPS`); }
    catch { errors.push(`${s.id}: некорректный URL`); }
    if (!s.publisher || !s.title || !s.accessedOn || !['page', 'search_excerpt', 'unavailable'].includes(s.readLevel)) errors.push(`${s.id}: неполная карточка источника`);
  }
  for (const c of corpus.countries) {
    evidence(c.code, c);
    const root = nodes.get(c.root);
    if (!root || root.country !== c.code || root.parent !== null) errors.push(`${c.code}: некорректный корень страны`);
    if (!corpus.hierarchyTemplates.some(t => t.country === c.code)) errors.push(`${c.code}: нет задания на организационную иерархию`);
  }
  const kinds: OrganizationKind[] = ['organization', 'service', 'reported_service', 'independent_branch', 'branch_group', 'branch', 'component'];
  for (const n of corpus.organizations) {
    evidence(n.id, n);
    if (!kinds.includes(n.kind)) errors.push(`${n.id}: неверный вид узла организации`);
    if (!countries.has(n.country)) errors.push(`${n.id}: неизвестная страна`);
    if (n.parent) {
      const parent = nodes.get(n.parent);
      if (!parent) errors.push(`${n.id}: неизвестный родитель`);
      else if (parent.country !== n.country) errors.push(`${n.id}: родитель другой страны`);
    }
    const seen = new Set<string>();
    let current: ModernOrganization | undefined = n;
    while (current) {
      if (seen.has(current.id)) { errors.push(`${n.id}: цикл классификации`); break; }
      seen.add(current.id); current = current.parent ? nodes.get(current.parent) : undefined;
    }
  }
  for (const r of corpus.representatives) {
    evidence(r.id, r);
    passport(r.id, r.passport, r.objectClass);
    for (const ref of r.inventoryReferences ?? []) {
      evidence(r.id, { sources: [ref.source] });
      if (sources.get(ref.source)?.kind !== 'encyclopedia' || !ref.designation || !ref.section || !['listed', 'prospective'].includes(ref.catalogueStatus)) errors.push(`${r.id}: неверная номенклатурная ссылка`);
    }
    if (r.catalogueOnly && r.passport.characteristics.length) errors.push(`${r.id}: номенклатурная запись подменяет технический паспорт`);
    if (!['family', 'model', 'variant'].includes(r.granularity)) errors.push(`${r.id}: не указан масштаб описания модели`);
    if (r.parentModel && !corpus.representatives.some(p => p.id === r.parentModel && p.id !== r.id && p.objectClass === r.objectClass)) errors.push(`${r.id}: неверное семейство модели`);
    if (r.kind !== 'equipment_model' || !classes.has(r.objectClass)) errors.push(`${r.id}: неверный класс представителя`);
    if (!countries.has(r.countryContext) || [...r.originCountries, ...r.operatorCountries].some(c => !countries.has(c))) errors.push(`${r.id}: неизвестная страна`);
    for (const id of r.relatedOrganizations) if (!nodes.has(id) || nodes.get(id)?.country !== r.countryContext) errors.push(`${r.id}: неверная связь с организацией ${id}`);
  }
  for (const t of corpus.hierarchyTemplates) {
    passport(t.id, t.passport, 'organization-levels');
    for (const level of t.levels) passport(`${t.id}:${level.id}`, level.passport, 'organization-levels');
    evidence(t.id, t, t.status !== 'pending_research');
    if (!countries.has(t.country)) errors.push(`${t.id}: неизвестная страна`);
    if (t.service && nodes.get(t.service)?.country !== t.country) errors.push(`${t.id}: неизвестный вид ВС страны`);
    if (t.status === 'pending_research' && t.levels.length) errors.push(`${t.id}: неисследованная схема содержит уровни`);
    unique(t.levels, t.id);
  }
  const units = new Map(corpus.units.map(u => [u.id, u]));
  unique(corpus.units, 'формирования');
  for (const u of corpus.units) {
    evidence(u.id, u);
    const t = templates.get(u.hierarchyTemplate);
    if (!t || t.country !== u.country || !t.levels.some(l => l.id === u.level)) errors.push(`${u.id}: неверный организационный уровень`);
    for (const id of u.classifications) if (nodes.get(id)?.country !== u.country) errors.push(`${u.id}: неверная классификация формирования`);
  }
  for (const r of corpus.subordination) {
    evidence(`${r.child} → ${r.parent}`, r);
    if (!units.has(r.child) || !units.has(r.parent) || r.child === r.parent) errors.push('Некорректная связь подчинённости');
    if (!Number.isFinite(Date.parse(r.from)) || (r.to !== null && (!Number.isFinite(Date.parse(r.to)) || r.to <= r.from))) errors.push('Неверный период подчинённости');
  }
  for (const p of corpus.principles) evidence(p.id, p, p.basis !== 'project_requirement');
  unique(corpus.researchQueue, 'исследовательские задания');
  for (const q of corpus.researchQueue) {
    const target = q.targetKind === 'equipment' ? corpus.representatives.some(r => r.id === q.target) : templates.has(q.target);
    if (!target) errors.push(`${q.id}: неизвестный предмет исследования`);
    evidence(q.id, { sources: q.sourceIds }, false);
  }
  return errors;
}

/** Адаптер справочных записей для отдельного индекса и пользовательского слоя современного режима. */
export function modernSeedEntries(corpus: ModernCorpus = modernCorpus): Entry[] {
  const sourceId = (id: string) => `modern:source:${id}`;
  const orgId = (id: string) => `modern:org:${id}`;
  const countryName = (code: string) => corpus.countries.find(c => c.code === code)?.title ?? code;
  const className = (id: string) => corpus.objectClasses.find(c => c.id === id)?.title ?? id;
  const facts = (refs: string[], value: string) => refs.map(source => ({ key: 'reference', value, source: sourceId(source) }));
  return [
    ...corpus.countries.map((c): Entry => ({ id: `modern:country:${c.code}`, category: 'organization', title: c.title,
      summary: 'Частичный исследовательский профиль страны; классификация и каталог требуют дальнейшей проверки.',
      facts: facts(c.sources, c.title), sections: [{ title: 'Пробелы исследования', text: c.gaps.join('\n') }],
      relations: [{ type: 'related', target: orgId(c.root) }], status: 'draft', origin: 'seed' })),
    ...corpus.sources.map((s): Entry => ({ id: sourceId(s.id), category: 'sources', group: 'web', title: s.title,
      summary: `${s.publisher}. ${s.note}`, facts: [{ key: 'ref', value: s.url }, { key: 'scope', value: s.scopeDate ?? 'Период источника не установлен' }, { key: 'review', value: s.readLevel }], status: 'draft', origin: 'seed' })),
    ...corpus.organizations.map((n): Entry => ({ id: orgId(n.id), category: 'organization', title: n.title, aliases: [n.nativeName],
      summary: n.note || 'Узел национальной классификации; требует предметной проверки.',
      facts: [...facts(n.sources, n.title), { key: 'country', value: `${countryName(n.country)} (${n.country})` }, { key: 'kind', value: n.kind }],
      relations: n.parent ? [{ type: 'part_of', target: orgId(n.parent) }] : [], status: 'draft', origin: 'seed' })),
    ...corpus.representatives.map((r): Entry => ({ id: `modern:equipment:${r.id}`, category: 'equipment', title: r.title,
      summary: r.summary, sections: [{ title: 'Статус исследования', text: r.note }],
      facts: [...facts(r.sources, r.summary), { key: 'country_context', value: `${countryName(r.countryContext)} (${r.countryContext})` }, { key: 'object_class', value: `${className(r.objectClass)} (${r.objectClass})` },
        ...r.passport.characteristics.map(c => ({ key: c.field, value: `${characteristicPrefix(c)}${c.value}${c.unit ? ` ${c.unit}` : ''}. ${c.scope}`, source: sourceId(c.source), pages: c.locator }))],
      relations: r.relatedOrganizations.map(id => ({ type: 'related', target: orgId(id) })), status: 'draft', origin: 'seed' })),
    ...corpus.hierarchyTemplates.map((t): Entry => ({ id: `modern:hierarchy:${t.id}`, category: 'organization', title: `${t.title ?? 'Организационные уровни'} — ${countryName(t.country)}`,
      summary: t.note, facts: [...facts(t.sources, t.levels.map(l => `${l.title} (${l.nativeName})`).join('; ')),
        ...t.passport.characteristics.map(c => ({ key: c.field, value: `${characteristicPrefix(c)}${c.value}${c.unit ? ` ${c.unit}` : ''}. ${c.scope}`, source: sourceId(c.source), pages: c.locator }))],
      relations: t.service ? [{ type: 'related', target: orgId(t.service) }] : [],
      sections: [{ title: 'Готовность', text: t.status === 'pending_research' ? 'Сбор национальной схемы ещё не выполнен.' : 'Обзор уровней; подчинённость конкретных формирований не задана.' }], status: 'draft', origin: 'seed' })),
    ...corpus.hierarchyTemplates.flatMap(t => t.levels.map((l): Entry => ({
      id: `modern:hierarchy-level:${t.id}:${l.id}`, category: 'organization', title: `${l.title} — ${countryName(t.country)}`, aliases: [l.nativeName],
      summary: l.passport.characteristics.filter(c => c.field === 'composition_description').map(c => String(c.value)).join(' ') || t.note,
      facts: [{ key: 'country_context', value: `${countryName(t.country)} (${t.country})` },
        ...l.passport.characteristics.map(c => ({ key: c.field, value: `${characteristicPrefix(c)}${c.value}${c.unit ? ` ${c.unit}` : ''}. ${c.scope}`, source: sourceId(c.source), pages: c.locator }))],
      sections: [{ title: 'Область применимости схемы', text: t.note }],
      relations: [{ type: 'part_of', target: `modern:hierarchy:${t.id}` }, ...(t.service ? [{ type: 'related' as const, target: orgId(t.service) }] : [])],
      status: 'draft', origin: 'seed',
    }))),
    ...corpus.principles.map((p): Entry => ({ id: `modern:principle:${p.id}`, category: 'organization', title: p.title,
      summary: p.text, facts: facts(p.sources, p.text), status: 'draft', origin: 'seed' })),
  ];
}
