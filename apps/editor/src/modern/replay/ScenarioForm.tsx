import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { modernCorpus } from '../../../../../packages/knowledge/src/modern';
import { useAtlasCatalog } from '../AtlasCatalog';
import { useAreaNames } from '../AreaNameEditor';
import { areaKey, automaticAreaName } from '../atlas-place-name';
import { loadRegion } from '../environment-region';
import { createPortal } from 'react-dom';
import { CoordinatePicker } from '../CoordinatePicker';
import '../environment.css';
import { readAuthorDraft, writeAuthorDraft, clearAuthorDraft, type AuthorDraft, type DraftSide, type DraftEvent, type AreaOption } from './author-draft';
import { ReplayAreaMap } from './ReplayAreaMap';
import type { Scenario, Side } from './session';

type Material = NonNullable<Scenario['sides'][Side]['materials']>[number];
type Choice = Scenario['choices'][number];
type ScenarioEvent = Scenario['events'][number];
type CatalogItem = { id: string; label: string; category: string; summary: string; sourceUrl?: string; evidence?: string };
const sideIds = ['a', 'b'] as const;
const sideName: Record<Side, string> = { a: 'А', b: 'Б' };
const countries = [...modernCorpus.countries].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
const countryTitles = new Map(countries.map(c => [c.code, c.title]));
const sourceById = new Map(modernCorpus.sources.map(s => [s.id, s]));
const classNames = new Map(modernCorpus.objectClasses.map(c => [c.id, c.title]));
const pageSize = 5;
const steps = ['Сценарий', 'Участники', 'Решения и события'] as const;

function countryMaterials(code: string): CatalogItem[] {
  const country = countries.find(c => c.code === code);
  if (!country) return [];
  const items: CatalogItem[] = [];
  for (const id of country.sources) {
    const source = sourceById.get(id);
    if (source) items.push({ id: 'modern:source:' + id, label: source.title, category: 'Источник о стране',
      summary: source.publisher + (source.note ? '. ' + source.note : ''), sourceUrl: source.url });
  }
  for (const org of modernCorpus.organizations) {
    if (org.country !== code) continue;
    items.push({ id: 'modern:org:' + org.id, label: org.title, category: 'Организация',
      summary: org.note || 'Организация в национальной классификации. ' + org.nativeName,
      sourceUrl: sourceById.get(org.sources[0])?.url });
  }
  for (const item of modernCorpus.representatives) {
    const refs = item.inventoryReferences ?? [];
    const listed = refs.find(ref => ref.catalogueStatus === 'listed');
    if (refs.length && !listed) continue;
    const operator = item.operatorCountries.includes(code);
    // Контекст разрешает показать документ с упоминанием. Страну-оператора подтверждает только отдельное поле.
    if (!operator && !(item.countryContext === code && listed)) continue;
    const evidence = operator ? 'В базе указан оператор' : 'Название в перечне страны';
    const source = sourceById.get(operator ? item.sources[0] : listed!.source);
    items.push({ id: 'modern:equipment:' + item.id, label: item.title, category: classNames.get(item.objectClass) ?? 'Каталожное обозначение',
      summary: evidence + ' «' + country.title + '».' + (!operator ? ' Оператор для этой страны не подтверждён.' : '') +
        (source ? ' Источник — ' + source.title + '.' : ''),
      evidence: operator ? 'Оператор указан' : 'Упоминание в перечне', sourceUrl: source?.url });
  }
  return items;
}

function MaterialPicker({ code, selected, onChange }: {
  code: string; selected: Material[]; onChange: (items: Material[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const items = useMemo(() => countryMaterials(code), [code]);
  const categories = useMemo(() => [...new Set(items.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'ru')), [items]);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru');
    return items.filter(item => (!category || category === item.category) &&
      (item.label + ' ' + item.category).toLocaleLowerCase('ru').includes(term));
  }, [items, query, category]);
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const pageItems = matches.slice(page * pageSize, (page + 1) * pageSize);
  return <details className="replay-materials" open>
    <summary>Материалы · {countryTitles.get(code)} · {selected.length}</summary>
    <p className="replay-note">Перед первым периодом обязательные карточки уже включены в материалы стороны. Остальные участник выбирает сам.</p>
    {!!selected.length && <ul className="replay-selected">{selected.map(item => <li className="replay-material-row" key={item.id}>
      <span><strong>{item.label}</strong><small>{item.category}</small></span>
      <label><input type="checkbox" aria-label={'Обязательная карточка «' + item.label + '»'} checked={item.required} onChange={e =>
        onChange(selected.map(old => old.id === item.id ? { ...old, required: e.target.checked } : old))} /> Обязательная</label>
      <button type="button" aria-label={'Убрать «' + item.label + '»'} onClick={() => onChange(selected.filter(old => old.id !== item.id))}>Убрать</button>
    </li>)}</ul>}
    <div className="replay-filters">
      <label>Название или класс<input type="search" value={query} placeholder="Найти карточку"
        onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <label>Категория<select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
        <option value="">Все категории</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
    </div>
    <ul className="replay-material-list">{pageItems.map(({ evidence, ...item }) => {
      const added = selected.some(old => old.id === item.id);
      return <li className="replay-material-row" key={item.id}>
        <div><strong>{item.label}</strong><small>{item.category}{evidence && ' · ' + evidence}</small>
          <details><summary>О карточке</summary><p>{item.summary}</p>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Открыть источник ↗</a>}</details></div>
        <button type="button" aria-label={'Добавить «' + item.label + '»'} disabled={added}
          onClick={() => onChange([...selected, { ...item, required: false }])}>{added ? 'Добавлена' : 'Добавить'}</button>
      </li>;
    })}</ul>
    <div className="replay-pagination">
      <span role="status">{matches.length ? (page * pageSize + 1) + '–' + Math.min(matches.length, (page + 1) * pageSize) + ' из ' + matches.length : 'Карточек по этому запросу нет'}</span>
      {lastPage > 0 && <><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
        <button type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Далее</button></>}
    </div>
  </details>;
}

function SideFields({ id, value, onChange }: {
  id: Side; value: DraftSide; onChange: (side: DraftSide) => void;
}) {
  const alternatives = value.alternatives;
  const available = countries.filter(c => c.code !== value.code && !alternatives.some(alt => alt.code === c.code));
  function addAlternative(code: string) {
    if (available.some(c => c.code === code)) onChange({ ...value, alternatives: [...alternatives, { code, materials: [] }] });
  }
  return <fieldset className="replay-side"><legend>Участник {sideName[id]}</legend>
    <label>Страна участника {sideName[id]}<select required value={value.code}
      onChange={e => onChange({ ...value, code: e.target.value, materials: [] })}>
      <option value="">Выберите страну</option>{countries.map(c =>
        <option key={c.code} value={c.code} disabled={alternatives.some(alt => alt.code === c.code)}>{c.title}</option>)}</select></label>
    <label>Личная задача участника {sideName[id]}<textarea required rows={2} value={value.objective}
      onChange={e => onChange({ ...value, objective: e.target.value })} /></label>
    {value.code && available.length > 0 && <label>Добавить страну на выбор участнику {sideName[id]}
      <select value="" onChange={e => addAlternative(e.target.value)}>
        <option value="">Выберите дополнительную страну</option>
        {available.map(c => <option key={c.code} value={c.code}>{c.title}</option>)}
      </select></label>}
    {value.code && <MaterialPicker key={value.code} code={value.code} selected={value.materials}
      onChange={materials => onChange({ ...value, materials })} />}
    {alternatives.map(alt => <details key={alt.code} className="replay-alternative">
      <summary>Страна на выбор · {countryTitles.get(alt.code)}</summary>
      <MaterialPicker code={alt.code} selected={alt.materials} onChange={materials =>
        onChange({ ...value, alternatives: alternatives.map(other => other.code === alt.code ? { ...other, materials } : other) })} />
      <button type="button" onClick={() => onChange({ ...value, alternatives: alternatives.filter(other => other.code !== alt.code) })}>
        Убрать страну «{countryTitles.get(alt.code)}»</button>
    </details>)}
  </fieldset>;
}

function useScenarioAreas() {
  const { names } = useAreaNames();
  const [current] = useState(() => loadRegion().bounds);
  const catalog = useAtlasCatalog();
  const options = useMemo(() => {
    const all = new Map<string, AreaOption>();
    for (const bounds of [current, ...(catalog?.groups.map(group => group.bounds) ?? [])]) {
      const key = areaKey(bounds);
      all.set(key, { key, name: names[key] || automaticAreaName(bounds), bounds });
    }
    return [...all.values()];
  }, [current, catalog, names]);
  return { options, catalog };
}

function initialTimes() {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return { start: midnight.toISOString().slice(0, 16), end: new Date(midnight.getTime() + 86400000).toISOString().slice(0, 16) };
}
function toUtc(value: string) {
  const time = Date.parse(value + 'Z');
  if (!Number.isFinite(time)) throw Error('Проверьте дату и время UTC.');
  return new Date(time).toISOString();
}
function EventFields({ event, number, start, end, choices, onChange, onRemove }: {
  event: DraftEvent; number: number; start: string; end: string; choices: readonly Choice[];
  onChange: (event: DraftEvent) => void; onRemove: () => void;
}) {
  function changeCondition(side: Side, id: string) {
    const when = { ...event.when };
    if (id) when[side] = id;
    else delete when[side];
    onChange({ ...event, when });
  }
  function changeAudience(audience: ScenarioEvent['audience']) {
    const reportAt = { ...event.reportAt };
    for (const side of sideIds) if (audience !== 'both' && side !== audience) delete reportAt[side];
    onChange({ ...event, audience, reportAt, announcement: audience === 'none' ? undefined : event.announcement });
  }
  function changeReportTime(side: Side, time: string) {
    const reportAt = { ...event.reportAt };
    if (time) reportAt[side] = time;
    else delete reportAt[side];
    onChange({ ...event, reportAt });
  }
  return <fieldset className="replay-event"><legend>Событие {number}</legend>
    <label>Текст события<textarea required rows={2} value={event.text}
      placeholder="Например, в редакцию поступила уточнённая справка" onChange={e => onChange({ ...event, text: e.target.value })} /></label>
    <div className="replay-fields">
      <label>Время события (UTC)<input type="datetime-local" required min={start} max={end} value={event.at} onChange={e => onChange({ ...event, at: e.target.value })} /></label>
      <label>Кому показать<select value={event.audience} onChange={e => changeAudience(e.target.value as ScenarioEvent['audience'])}>
        <option value="both">Обоим участникам</option><option value="a">Участнику А</option><option value="b">Участнику Б</option>
        <option value="none">Только в совместном разборе</option></select></label>
      {sideIds.map(side => <label key={side}>Решение участника {sideName[side]}<select value={event.when?.[side] ?? ''}
        onChange={e => changeCondition(side, e.target.value)}><option value="">Любое решение</option>
        {choices.filter(c => c.label.trim()).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>)}
      {sideIds.filter(side => event.audience === 'both' || event.audience === side).map(side =>
        <label key={'report-' + side}>Время оповещения участника {sideName[side]} (UTC)
          <input type="datetime-local" min={event.at} value={event.reportAt?.[side] ?? ''}
            onChange={e => changeReportTime(side, e.target.value)} />
          <small>Если оставить пустым, сообщение поступит в момент события.</small></label>)}
    </div>
    {event.audience !== 'none' && <label>Заголовок оповещения (по желанию)<input value={event.announcement ?? ''} onChange={e => onChange({ ...event, announcement: e.target.value })} /></label>}
    <label><input type="checkbox" checked={event.ends ?? false} onChange={e => onChange({ ...event, ends: e.target.checked })} />
      Завершить сеанс при этом событии</label>
    <button type="button" onClick={onRemove}>Убрать событие</button>
  </fieldset>;
}

export function ScenarioForm({ onCreate, onSavingChange }: {
  onCreate: (scenario: Scenario) => void | Promise<void>; onSavingChange?: (saving: boolean) => void;
}) {
  const [restored] = useState(() => readAuthorDraft(countryTitles));
  const [step, setStep] = useState(restored?.step ?? 0);
  const [title, setTitle] = useState(restored?.title ?? 'Сверка источников');
  const [{ start, end }, setTimes] = useState(() => restored?.times ?? initialTimes());
  const [periodHours, setPeriodHours] = useState<6 | 12>(restored?.periodHours ?? 6);
  const [disclosure, setDisclosure] = useState<Scenario['disclosure']>(restored?.disclosure ?? 'mutual');
  const { options, catalog } = useScenarioAreas();
  const [area, setArea] = useState<AreaOption>(restored?.area ?? options[0]);
  const [pickerBounds, setPickerBounds] = useState<AreaOption['bounds'] | null>(null);
  const knownArea = options.some(item => item.key === area.key);
  const areas = knownArea ? options : [...options, area];
  function applyBounds(bounds: AreaOption['bounds']) {
    const key = areaKey(bounds);
    setArea(options.find(item => item.key === key) ?? { key, name: automaticAreaName(bounds), bounds });
    setPickerBounds(null);
  }
  const [sides, setSides] = useState<Record<Side, DraftSide>>(restored?.sides ?? {
    a: { code: '', objective: 'Выяснить, какие утверждения в справке подтверждены источниками.', materials: [], alternatives: [] },
    b: { code: '', objective: 'Отметить расхождения и предложить уточнения к общей справке.', materials: [], alternatives: [] },
  });
  const [choices, setChoices] = useState<Choice[]>(restored?.choices ?? [
    { id: 'c1', label: 'Запросить второй источник' }, { id: 'c2', label: 'Подготовить общую справку' },
  ]);
  const [events, setEvents] = useState<DraftEvent[]>(restored?.events ?? []);
  const [nextKey, setNextKey] = useState(restored?.nextKey ?? 3);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savingLock = useRef(false);
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const serialized = useMemo(() => JSON.stringify({ step, title, times: { start, end }, periodHours, disclosure, area, sides,
    choices, events, nextKey } satisfies AuthorDraft), [step, title, start, end, periodHours, disclosure, area, sides, choices, events, nextKey]);
  const previous = useRef(serialized);
  useEffect(() => {
    if (previous.current === serialized || savingLock.current) return;
    const saved = writeAuthorDraft(serialized);
    if (saved) previous.current = serialized;
    setDraftUnavailable(!saved);
  }, [serialized]);
  function goTo(index: number) {
    setStep(index);
    setError('');
  }
  const referencedChoices = new Set(events.flatMap(event => Object.values(event.when ?? {})));
  function validateStep(index: number) {
    if (index === 0) {
      if (!title.trim()) throw Error('Введите название сценария.');
      if (toUtc(start) >= toUtc(end)) throw Error('Укажите окончание сеанса после его начала.');
      return;
    }
    if (index === 1) {
      if (!sides.a.code || !sides.b.code) throw Error('Выберите страну для каждого участника.');
      for (const side of sideIds) {
        const codes = [sides[side].code, ...sides[side].alternatives.map(alt => alt.code)];
        if (new Set(codes).size !== codes.length) throw Error('Страны для одного участника должны различаться.');
      }
      if (!sides.a.objective.trim() || !sides.b.objective.trim()) throw Error('Заполните обе личные задачи.');
      return;
    }
    const labels = choices.map(choice => choice.label.trim().toLocaleLowerCase('ru'));
    if (!labels.length || labels.some(label => !label)) throw Error('Дайте название каждому варианту решения.');
    if (new Set(labels).size !== labels.length) throw Error('Варианты решений должны различаться.');
    for (const event of events) {
      const at = toUtc(event.at);
      if (at < toUtc(start) || at > toUtc(end)) throw Error('Время каждого события должно входить в период сеанса.');
      if (!event.text.trim()) throw Error('Заполните текст каждого события.');
      for (const time of Object.values(event.reportAt ?? {})) {
        if (toUtc(time) < at) throw Error('Оповещение не может предшествовать событию.');
      }
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingLock.current) return;
    for (const index of (step === 2 ? [0, 1, 2] : [step])) {
      try { validateStep(index); }
      catch (cause) {
        setStep(index);
        setError(cause instanceof Error ? cause.message : 'Проверьте поля формы.');
        return;
      }
    }
    if (step < 2) { goTo(step + 1); return; }
    const participant = (side: Side) => ({
      country: countryTitles.get(sides[side].code)!,
      objective: sides[side].objective.trim(),
      materials: sides[side].materials,
      alternatives: sides[side].alternatives.map(alt => ({ country: countryTitles.get(alt.code)!, materials: alt.materials })),
    });
    savingLock.current = true;
    setSaveState('saving');
    onSavingChange?.(true);
    setError('');
    try {
      await onCreate({ title: title.trim(), area: area.name, areaKey: area.key, areaBounds: area.bounds,
        start: toUtc(start), end: toUtc(end), sides: { a: participant('a'), b: participant('b') }, periodHours, disclosure,
        choices: choices.map(c => ({ ...c, label: c.label.trim() })),
        events: events.map(({ key: _key, ...event }) => ({ ...event, at: toUtc(event.at), text: event.text.trim(),
          reportAt: Object.fromEntries(Object.entries(event.reportAt ?? {}).map(([side, time]) => [side, toUtc(time)])),
          announcement: event.announcement?.trim() || undefined })) });
      clearAuthorDraft();
      setSaveState('saved');
    } catch (cause) {
      savingLock.current = false;
      setSaveState('idle');
      setError('Не удалось сохранить сеанс. ' + (cause instanceof Error ? cause.message + ' ' : '') + 'Можно повторить попытку.');
    } finally {
      onSavingChange?.(false);
    }
  }
  return <><form className="replay-form" aria-label="Конструктор сценария" noValidate onSubmit={submit} aria-busy={saveState === 'saving'}>
    <fieldset disabled={saveState !== 'idle'} style={{ display: 'contents' }}>
    {restored && <p className="replay-note" role="status">Авторский черновик восстановлен на этом компьютере.</p>}
    {draftUnavailable && <p className="replay-error" role="status">Черновик не удалось записать на этом компьютере. Данные пока доступны в открытой форме.</p>}
    <nav className="replay-steps" aria-label="Шаги создания сценария">{steps.map((label, i) =>
      <button type="button" aria-current={step === i ? 'step' : undefined} key={label} onClick={() => goTo(i)}>{label}</button>)}</nav>
    {step === 0 && <section className="replay-section"><h2>Параметры сеанса</h2>
      <div className="replay-fields">
        <label>Название сценария<input required value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label>Область атласа<select value={area.key} onChange={e => { const selected = areas.find(item => item.key === e.target.value); if (selected) setArea(selected); }}>
          {areas.map((area, i) => <option key={area.key} value={area.key}>{area.name}{i === 0 ? ' · текущая область' : i >= options.length ? ' · выбранная рамка' : ''}{areas.some(other => area.key !== other.key && area.name === other.name) ? ' · ' + area.bounds.join(', ') : ''}</option>)}</select></label>
        <label>Начало (UTC)<input type="datetime-local" required value={start} onChange={e => setTimes({ start: e.target.value, end })} /></label>
        <label>Окончание (UTC)<input type="datetime-local" required value={end} min={start} onChange={e => setTimes({ start, end: e.target.value })} /></label>
        <label>Длительность периода<select value={periodHours} onChange={e => setPeriodHours(e.target.value === '12' ? 12 : 6)}>
          <option value={6}>6 часов</option><option value={12}>12 часов</option></select></label>
        <label>Совместный разбор<select value={disclosure} onChange={e => setDisclosure(e.target.value as Scenario['disclosure'])}>
          <option value="mutual">После согласия обоих</option><option value="immediate">Сразу после завершения</option></select></label>
      </div>
      <button type="button" onClick={() => setPickerBounds([...area.bounds])}>Выбрать рамку на карте</button>
      <ReplayAreaMap bounds={area.bounds} name={area.name} catalog={catalog} />
      {catalog?.failed && <p className="replay-note">Каталог загруженных карт недоступен. Доступны текущая область и выбор рамки на карте.</p>}
    </section>}
    {step === 1 && <section className="replay-section"><h2>Участники и материалы</h2>
      <p className="replay-note">Если разрешить несколько стран, участник сам выберет одну перед первым периодом. Каждой стране можно назначить свои карточки.</p>
      <div className="replay-sides">{sideIds.map(id => <SideFields key={id} id={id} value={sides[id]}
        onChange={value => setSides({ ...sides, [id]: value })} />)}</div>
    </section>}
    {step === 2 && <><section className="replay-section"><h2>Варианты решений</h2>
      <p className="replay-note">В каждом периоде участник выбирает один вариант и может пояснить свой ответ.</p>
      <div className="replay-choices">{choices.map((choice, i) => <div key={choice.id}>
        <label>Вариант {i + 1}<input required value={choice.label}
          onChange={e => setChoices(choices.map(item => item.id === choice.id ? { ...item, label: e.target.value } : item))} /></label>
        <button type="button" disabled={choices.length <= 1 || referencedChoices.has(choice.id)}
          title={referencedChoices.has(choice.id) ? 'Этот вариант используется в условии события' : undefined}
          aria-label={'Убрать вариант ' + (i + 1)} onClick={() => setChoices(choices.filter(item => item.id !== choice.id))}>Убрать</button>
      </div>)}</div>
      <button type="button" onClick={() => { setChoices([...choices, { id: 'c' + nextKey, label: '' }]); setNextKey(nextKey + 1); }}>Добавить вариант</button>
    </section>
    <section className="replay-section"><h2>События и завершение</h2>
      <p className="replay-note">Сеанс заканчивается в указанное время. Событие может завершить его раньше, если выполнены заданные условия.</p>
      {events.map((event, i) => <EventFields key={event.key} event={event} number={i + 1} start={start} end={end} choices={choices}
        onChange={value => setEvents(events.map(row => row.key === event.key ? value : row))}
        onRemove={() => setEvents(events.filter(row => row.key !== event.key))} />)}
      <button type="button" onClick={() => { setEvents([...events, { key: nextKey, at: end, audience: 'both', text: '' }]); setNextKey(nextKey + 1); }}>Добавить событие</button>
    </section></>}
    {error && <p className="replay-error" role="alert">{error}</p>}
    <div className="replay-actions">
      {step > 0 && <button type="button" onClick={() => goTo(step - 1)}>Назад</button>}
      <button type="submit" className="replay-primary" disabled={saveState !== 'idle'}>{saveState === 'saving' ? 'Сохранение…' : saveState === 'saved' ? 'Сеанс сохранён' : step === 2 ? 'Начать сеанс' : 'Продолжить'}</button>
    </div>
    </fieldset>
  </form>
  {pickerBounds && createPortal(<div className="env-view" style={{ display: 'contents' }}>
    <CoordinatePicker mode="bounds" offline value={pickerBounds}
    onChange={bounds => { if (bounds.length === 4) setPickerBounds([bounds[0], bounds[1], bounds[2], bounds[3]]); }}
    onClose={() => setPickerBounds(null)} onConfirm={() => applyBounds(pickerBounds)} />
  </div>, document.body)}
  </>;
}
