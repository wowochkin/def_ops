/** Просмотр отдельного исследовательского корпуса. Исторический индекс и его пользовательский слой не используются. */
import { useMemo, useState } from 'react';
import { modernCorpus as corpus, characteristicTitle, characteristicPrefix, passportCoverage, organizationSizeLabels, type ReferencePassport, type ModernOrganization, type ModernSource, type OrganizationKind, type ModernRepresentative } from '../../../../packages/knowledge/src/modern';
import type { ModernImportSource } from '@def-ops/kshvi/browser';
import { KnowledgeImportDialog } from './kshvi/preparation/KnowledgeImportDialog';
import './modern-knowledge.css';

const KIND: Record<OrganizationKind, string> = {
  organization: 'Военная организация', service: 'Вид вооружённых сил', reported_service: 'Вид по классификации источника',
  independent_branch: 'Отдельный род войск или сил', branch_group: 'Группа родов войск', branch: 'Род войск или специализация', component: 'Иной компонент',
};
const SOURCE_KIND: Record<ModernSource['kind'], string> = {
  national_authority: 'Национальный официальный источник', manufacturer: 'Производитель', intergovernmental: 'Международная организация',
  encyclopedia: 'Энциклопедический перечень', research: 'Исследование', foreign_official_assessment: 'Внешняя государственная оценка',
};
const READ: Record<ModernSource['readLevel'], string> = { page: 'Страница прочитана', search_excerpt: 'Изучен поисковый фрагмент', unavailable: 'Содержимое недоступно' };
const TABS = [
  { id: 'structure', title: 'Виды ВС и рода войск' }, { id: 'hierarchy', title: 'Организационные уровни' },
  { id: 'equipment', title: 'Техника' }, { id: 'sources', title: 'Источники' },
] as const;
type Tab = typeof TABS[number]['id'];
const sourceById = new Map(corpus.sources.map(s => [s.id, s]));
const className = (id: string) => corpus.objectClasses.find(c => c.id === id)?.title ?? id;

function Sources({ ids }: { ids: string[] }) {
  return <ul className="mk-references">{ids.map(id => {
    const s = sourceById.get(id);
    return s ? <li key={id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a>
      <small>{s.publisher} · Период сведений: {s.scopeDate ?? 'не установлен'}</small></li> : null;
  })}</ul>;
}

const UNITS: Record<string, string> = { kg: 'кг', m: 'м', person: 'чел.', 'km/h': 'км/ч', km: 'км', h: 'ч', l: 'л', round: 'выстр.', item: 'ед.' };
function Passport({ record }: { record: { passport: ReferencePassport } }) {
  const coverage = passportCoverage(record);
  return <section className="mk-passport" aria-label="Справочный паспорт">
    <h4>Справочный паспорт</h4>
    <p className="mk-source-meta">Базовых полей: {coverage.documented} из {coverage.required.length}. Всего полей с данными: {coverage.totalDocumented}. Допуск к расчётной модели не выполнен.</p>
    <dl>{record.passport.characteristics.map((fact, i) => {
      const source = sourceById.get(fact.source);
      return <div key={`${fact.field}-${i}`}><dt>{characteristicTitle(fact.field)}</dt><dd>
        <strong>{characteristicPrefix(fact)}{typeof fact.value === 'number' ? fact.value.toLocaleString('ru-RU') : fact.value}{fact.unit ? ` ${UNITS[fact.unit] ?? fact.unit}` : ''}</strong>
        <small>{fact.scope}</small>
        {source && <small><a href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher} ↗</a> · {fact.locator}</small>}
      </dd></div>;
    })}</dl>
    {!!coverage.missing.length && <details><summary>Не заполнено полей: {coverage.missing.length}</summary>
      <ul>{coverage.missing.map(field => <li key={field}>{characteristicTitle(field)}</li>)}</ul>
    </details>}
  </section>;
}

export function ModernKnowledgeView() {
  const [country, setCountry] = useState(corpus.countries[0].code);
  const [tab, setTab] = useState<Tab>('structure');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [allSources, setAllSources] = useState(false);
  const [equipmentClass, setEquipmentClass] = useState('all');
  const [importSource, setImportSource] = useState<ModernImportSource | null>(null);
  const [importTitle, setImportTitle] = useState('');
  const profile = corpus.countries.find(c => c.code === country)!;
  const nodes = useMemo(() => corpus.organizations.filter(n => n.country === country), [country]);
  const representatives = useMemo(() => corpus.representatives.filter(r => r.countryContext === country), [country]);
  const hierarchies = corpus.hierarchyTemplates.filter(t => t.country === country);
  const active = nodes.find(n => n.id === selected) ?? nodes.find(n => n.id === profile.root)!;
  const q = query.trim().toLocaleLowerCase('ru');
  const matches = (...strings: string[]) => !q || strings.join(' ').toLocaleLowerCase('ru').includes(q);
  const visibleRepresentatives = representatives.filter(r => (equipmentClass === 'all' || r.objectClass === equipmentClass) && matches(r.title, r.summary, className(r.objectClass), ...(r.inventoryReferences?.map(i => i.designation) ?? [])));
  const equipmentGroups = corpus.objectClasses.map(c => ({ ...c, records: visibleRepresentatives.filter(r => r.objectClass === c.id) })).filter(c => c.records.length);
  const openImport = async (record: ModernRepresentative) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)));
    const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    setImportTitle(record.title);
    setImportSource({
      sourceRecordId: record.id, sourceRevision: 1, sourceHash,
      modelInputs: false, simulationValidated: false,
      characteristics: record.passport.characteristics.map(fact => ({ field: fact.field, value: fact.value })),
    });
  };
  const countrySources = new Set([
    ...profile.sources, ...nodes.flatMap(n => n.sources), ...representatives.flatMap(r => r.sources), ...hierarchies.flatMap(h => h.sources),
  ]);
  const sources = corpus.sources.filter(s => (allSources || countrySources.has(s.id)) && matches(s.title, s.publisher, s.note));
  const children = (id: string | null) => nodes.filter(n => n.parent === id);
  const nodeMatches = (n: ModernOrganization): boolean => matches(n.title, n.nativeName, KIND[n.kind]) || children(n.id).some(nodeMatches);
  const tree = (parent: string | null) => <ul>{children(parent).filter(nodeMatches).map(n => <li key={n.id}>
    <button type="button" className={active.id === n.id ? 'selected' : ''} aria-pressed={active.id === n.id} onClick={() => setSelected(n.id)}>
      <span>{n.title}</span><small>{KIND[n.kind]}</small>
    </button>{tree(n.id)}
  </li>)}</ul>;

  return <section className="modern-knowledge" aria-labelledby="modern-knowledge-title">
    <header className="mk-heading">
      <div><p className="modern-kicker">Современный режим</p><h1 id="modern-knowledge-title">База знаний</h1>
        <p>Страны: {corpus.countries.length} · Источники: {corpus.sources.length} · Карточки техники: {corpus.representatives.length}</p></div>
      <span className="mk-draft">Исследовательский корпус</span>
    </header>
    <p className="mk-notice">Начальное наполнение неполное. Все предметные записи — черновики и требуют проверки. Сведения пока не используются в расчётной модели.</p>
    <div className="mk-layout">
      <nav className="mk-countries" aria-label="Страны базы знаний"><h2>Страны</h2>
        {corpus.countries.map(c => <button type="button" key={c.code} aria-pressed={country === c.code} onClick={() => { setCountry(c.code); setSelected(''); setQuery(''); setEquipmentClass('all'); }}>
          <span>{c.title}</span><small>{c.code}</small>
        </button>)}
      </nav>
      <div className="mk-content">
        <div className="mk-country-heading"><h2>{profile.title}</h2><span>Частичное наполнение</span></div>
        <div className="mk-tabs" role="tablist" aria-label="Материалы страны">
          {TABS.map((t, i) => <button type="button" role="tab" id={`mk-tab-${t.id}`} aria-controls="mk-panel" key={t.id} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => { setTab(t.id); setQuery(''); }} onKeyDown={e => {
              const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
              if (next === null) return;
              e.preventDefault(); setTab(TABS[next].id); setQuery(''); document.getElementById(`mk-tab-${TABS[next].id}`)?.focus();
            }}>{t.title}</button>)}
        </div>
        <label className="mk-search">Поиск по {tab === 'sources' && allSources ? 'источникам корпуса' : 'материалам страны'}
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Название, термин или источник" />
        </label>
        <div id="mk-panel" role="tabpanel" aria-labelledby={`mk-tab-${tab}`}>
          {tab === 'structure' && <>
            <p className="mk-explanation">Национальная классификация видов ВС и родов войск. Организационные уровни и подчинённость формирований рассматриваются отдельно.</p>
            <div className="mk-structure">
              <nav className="mk-tree" aria-label="Виды ВС и рода войск">{tree(null)}{!nodes.some(nodeMatches) && <p>Совпадений нет</p>}</nav>
              <article className="mk-detail"><p className="mk-type">{KIND[active.kind]}</p><h3>{active.title}</h3>
                {active.nativeName !== active.title && <p className="mk-native">{active.nativeName}</p>}
                <p>{active.note || 'Запись национальной классификации; требуется предметная проверка.'}</p>
                <h4>Источники записи</h4><Sources ids={active.sources} />
              </article>
            </div>
          </>}
          {tab === 'hierarchy' && <>
            {hierarchies.filter(h => matches(h.title ?? '', h.note, ...h.levels.map(l => `${l.title} ${l.nativeName}`))).map(h => <article className="mk-record" key={h.id}>
              <h3>{h.title ?? 'Организационные уровни'}</h3>
              <p className="mk-type">{h.status === 'pending_research' ? 'Национальная схема ещё не собрана' : 'Обзор организационных уровней'}</p><p>{h.note}</p>
              {!!h.levels.length && <div>{h.levels.map(l => <details key={l.id} className="mk-level-passport"><summary>
                <span className="mk-level-title">{l.title} · {l.nativeName}</span>
                <span className="mk-level-size">{organizationSizeLabels(l.passport).join(' / ') || 'Численность не установлена'}</span>
                <span className="mk-level-composition">{l.passport.characteristics.filter(c => c.field === 'composition_description').map(c => c.value).join(' ') || 'Количественный состав не установлен'}</span>
              </summary><Passport record={l} /></details>)}</div>}
              {!!h.passport.characteristics.length && <Passport record={h} />}
              {!!h.sources.length && <Sources ids={h.sources} />}
            </article>)}
            <p className="mk-explanation">Реестр конкретных формирований и связи их административного, оперативного и временного подчинения пока не заполнены.</p>
          </>}
          {tab === 'equipment' && <>
            <p className="mk-explanation">Каталог моделей и семейств по категориям. Это не отдельные машины и не сведения о текущем наличии. Категория техники не заменяет род войск.</p>
            <nav className="mk-equipment-categories" aria-label="Категории техники">
              <button type="button" aria-pressed={equipmentClass === 'all'} onClick={() => setEquipmentClass('all')}>Все категории <span>{representatives.length}</span></button>
              {corpus.objectClasses.map(c => {
                const count = representatives.filter(r => r.objectClass === c.id).length;
                return <button type="button" key={c.id} aria-pressed={equipmentClass === c.id} disabled={!count} onClick={() => setEquipmentClass(c.id)}>{c.title} <span>{count || 'нет данных'}</span></button>;
              })}
            </nav>
            <p className="mk-source-meta">Найдено карточек: {visibleRepresentatives.length}. Раскройте категорию и модель, чтобы посмотреть паспорт.</p>
            <div className="mk-records">{equipmentGroups.map(group => <details className="mk-equipment-group" key={`${country}-${group.id}`} open={!!q || equipmentClass !== 'all'}>
              <summary><span>{group.title}</span><small>{group.records.length}</small></summary>
              {group.records.map(r => <article className="mk-record" key={r.id}><details className="mk-equipment-card">
                <summary><h3>{r.title}</h3><small>{r.granularity === 'family' ? 'Семейство' : r.granularity === 'variant' ? 'Модификация' : 'Модель'}</small></summary>
                <p>{r.summary}</p>
                {r.catalogueOnly && <p className="mk-catalogue-note">Номенклатура из энциклопедического перечня. Характеристики и предварительная категория требуют проверки.</p>}
                <Passport record={r} />
                <button type="button" onClick={() => void openImport(r)}>Добавить в КШВИ</button>
                {r.inventoryReferences?.length ? <details className="mk-inventory-references"><summary>В перечнях: {r.inventoryReferences.length}</summary>{r.inventoryReferences.map((ref, index) => <p key={index}><a href={sourceById.get(ref.source)?.url} target="_blank" rel="noreferrer">{ref.designation}</a> — {ref.section}{ref.catalogueStatus === 'prospective' ? ' · перспективная программа' : ''}</p>)}</details> : null}
                <Sources ids={r.sources} />
              </details></article>)}
            </details>)}</div>
            {!visibleRepresentatives.length && <p className="mk-empty">{representatives.length ? 'Совпадений нет' : 'Примеры техники этой страны ещё не внесены'}</p>}
          </>}
          {tab === 'sources' && <>
            <label className="mk-check"><input type="checkbox" checked={allSources} onChange={e => setAllSources(e.target.checked)} /> Все источники корпуса</label>
            <div className="mk-records">{sources.map(s => <article className="mk-record" key={s.id}>
              <p className="mk-type">{SOURCE_KIND[s.kind]}</p><h3><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a></h3>
              <p>{s.publisher}</p><p className="mk-source-meta">Период сведений: {s.scopeDate ?? 'не установлен'} · {READ[s.readLevel]}</p>
              {s.note && <p>{s.note}</p>}
            </article>)}</div>
            {!sources.length && <p className="mk-empty">Совпадений нет</p>}
          </>}
        </div>
      </div>
    </div>
    {importSource && <KnowledgeImportDialog source={importSource} title={importTitle} />}
  </section>;
}
