/**
 * Раздел инспектора «Объект реестра»: какой реальный объект обозначает знак,
 * его характеристики на момент шкалы времени, запись изменений с даты, история.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ENTITY_TYPES, LIBRARY, formatAttr, featureAt, toTime,
  type Entity, type EntityState, type EntityType, type Fact, type FieldDef, type Feature, type GeoJSONGeometry,
  type MapDocument, type TimeInstant,
} from '@def-ops/core';
import { updateFeature } from './store';
import { fmtMoment, fromInput, toInput } from './time';

/** Операции реестра, нужные панели (реализуются клиентом API). */
export interface RegistryApi {
  types(): Promise<EntityType[]>;
  search(q: string, o?: { type?: string; at?: TimeInstant | null; limit?: number }): Promise<{ entity: Entity; state?: EntityState }[]>;
  get(id: string, at?: TimeInstant | null): Promise<{ entity: Entity; state?: EntityState }>;
  create(e: Omit<Entity, 'id'>): Promise<Entity>;
  update(id: string, patch: Partial<Entity>): Promise<Entity>;
  facts(id: string): Promise<Fact[]>;
  addFact(id: string, f: Omit<Fact, 'id' | 'entityId'>): Promise<Fact>;
  removeFact(id: string, factId: string): Promise<void>;
  /** Подписка на изменения реестра; возвращает отписку. */
  subscribe?(fn: (e: { type: string; entityId?: string }) => void): () => void;
}

interface Props {
  api: RegistryApi | null;
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  feature: Feature;
  time: TimeInstant | null;
}

/** Тип объекта по знаку: элемент библиотеки, из пресета которого создан знак. */
function guessType(f: Feature, types: EntityType[]): string {
  const el = LIBRARY.find((e) => f.preset && (Object.values(e.variants).includes(f.preset) || e.alternates?.includes(f.preset)));
  return (el && types.find((t) => t.elements?.includes(el.id))?.id) ?? 'formation';
}

/** Подпись знака (текст надписи или знака) — как предложение имени объекта. */
const featureText = (f: Feature) => (f.kind === 'label' ? f.text : f.kind === 'symbol' ? f.style.text ?? '' : '') || f.name || '';

/** Геометрия знака на момент — для записи положения объекта в реестр. */
function geometryAt(f: Feature, t: TimeInstant | null): GeoJSONGeometry | null {
  const g = t ? featureAt(f, t) : f;
  if (!g) return null;
  if (g.kind === 'symbol' || g.kind === 'label') return { type: 'Point', coordinates: [g.at[0], g.at[1]] };
  if (g.kind === 'area') return { type: 'Polygon', coordinates: [[...g.points, g.points[0]].map((p) => [p[0], p[1]] as [number, number])] };
  return { type: 'LineString', coordinates: g.points.map((p) => [p[0], p[1]] as [number, number]) };
}

export function EntityPanel({ api, doc, setDoc, feature: f, time }: Props) {
  const [types, setTypes] = useState<EntityType[]>(ENTITY_TYPES);
  const [data, setData] = useState<{ entity: Entity; state?: EntityState } | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);

  useEffect(() => { api?.types().then(setTypes).catch(() => undefined); }, [api]);
  useEffect(() => {
    setError(null);
    if (!api || !f.entityId) { setData(null); setFacts([]); return; }
    let alive = true;
    // без шкалы времени — последнее известное состояние
    api.get(f.entityId, time ?? '9999-12-31').then((d) => alive && setData(d)).catch((e) => alive && setError((e as Error).message));
    api.facts(f.entityId).then((x) => alive && setFacts(x)).catch(() => undefined);
    return () => { alive = false; };
  }, [api, f.entityId, time, rev]);
  useEffect(() => api?.subscribe?.((e) => { if (!e.entityId || e.entityId === f.entityId) reload(); }), [api, f.entityId]);

  const link = (id: string | null) => setDoc(updateFeature(doc, f.id, (x) => ({ ...x, entityId: id })));

  if (!api) {
    return (
      <div className="section">
        <div className="sec-h"><span>Объект реестра</span></div>
        <div className="muted">Реестр объектов доступен при подключении к серверу (npm run dev:services или docker compose).</div>
      </div>
    );
  }
  if (!f.entityId) return <LinkEntity api={api} f={f} types={types} time={time} onLink={link} />;

  const type = types.find((t) => t.id === data?.entity.type);
  return (
    <div className="section entity">
      <div className="sec-h">
        <span>Объект реестра</span>
        <button className="link" title="Отвязать знак от объекта (объект останется в реестре)" onClick={() => link(null)}>отвязать</button>
      </div>
      {error && <div className="err">{error}</div>}
      {data && type && (
        <>
          <div className="ent-title">
            <b>{data.entity.shortName || data.entity.name}</b> <span className="muted">· {type.name}</span>
            {data.entity.shortName && <div className="muted">{data.entity.name}</div>}
          </div>
          <div className="muted ent-at">{time ? `Состояние на ${fmtMoment(time)}` : 'Последнее известное состояние (шкала времени выключена)'}{data.state && !data.state.exists ? ' — объект в это время не существовал' : ''}</div>
          <AttrTable api={api} entity={data.entity} type={type} state={data.state} facts={facts} time={time} onChanged={reload} setError={setError} />
          <div className="btns">
            {(f.kind === 'symbol' || f.kind === 'label') && (data.entity.shortName || data.entity.name) && (
              <button title="Подпись знака — из краткого обозначения объекта" onClick={() => {
                const text = data.entity.shortName || data.entity.name;
                setDoc(updateFeature(doc, f.id, (x) => (x.kind === 'label' ? { ...x, text } : x.kind === 'symbol' ? { ...x, style: { ...x.style, text } } : x)));
              }}>Подпись из реестра</button>
            )}
            <button disabled={!time} title={time ? 'Записать в реестр, где находился объект на этот момент (по положению знака)' : 'Включите шкалу времени'}
              onClick={async () => {
                const g = geometryAt(f, time);
                if (!g || !time) return;
                try { await api.addFact(data.entity.id, { validFrom: time, attrs: {}, geometry: g, note: 'положение по знаку на карте' }); reload(); } catch (e) { setError((e as Error).message); }
              }}>Положение → в реестр</button>
          </div>
          <History api={api} entity={data.entity} type={type} facts={facts} onChanged={reload} setError={setError} />
        </>
      )}
    </div>
  );
}

/* --------------------- привязка: поиск или создание объекта --------------------- */
function LinkEntity({ api, f, types, time, onLink }: { api: RegistryApi; f: Feature; types: EntityType[]; time: TimeInstant | null; onLink: (id: string) => void }) {
  const [q, setQ] = useState(featureText(f));
  const [found, setFound] = useState<{ entity: Entity }[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { api.search(q, { limit: 8, at: time }).then(setFound).catch(() => setFound([])); }, 250);
    return () => clearTimeout(t);
  }, [api, q, time]);
  return (
    <div className="section entity">
      <div className="sec-h"><span>Объект реестра</span></div>
      <div className="muted">Свяжите знак с объектом — тогда характеристики (командир, численность, подчинение…) хранятся в реестре и видны на всех картах.</div>
      <input className="ent-search" placeholder="Поиск: 150 сд, Рейхстаг…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ent-found">
        {found.map(({ entity: e }) => (
          <button key={e.id} className="ent-item" onClick={() => onLink(e.id)}>
            <b>{e.shortName || e.name}</b> <span className="muted">{types.find((t) => t.id === e.type)?.name ?? e.type}{e.shortName ? ` · ${e.name}` : ''}</span>
          </button>
        ))}
        {!found.length && q && <div className="muted">Не найдено.</div>}
      </div>
      {creating
        ? <CreateEntity api={api} f={f} types={types} initialName={q} onDone={(id) => { setCreating(false); if (id) onLink(id); }} />
        : <div className="btns"><button onClick={() => setCreating(true)}>+ Новый объект{q ? ` «${q}»` : ''}</button></div>}
    </div>
  );
}

function CreateEntity({ api, f, types, initialName, onDone }: { api: RegistryApi; f: Feature; types: EntityType[]; initialName: string; onDone: (id: string | null) => void }) {
  const [typeId, setTypeId] = useState(() => guessType(f, types));
  const [name, setName] = useState(initialName);
  const [shortName, setShortName] = useState(initialName);
  const [attrs, setAttrs] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<string | null>(null);
  const type = types.find((t) => t.id === typeId)!;
  const statics = type.fields.filter((x) => !x.temporal);
  return (
    <div className="ent-create">
      <label className="row"><span className="lbl">Тип</span><span className="ctl">
        <select value={typeId} onChange={(e) => { setTypeId(e.target.value); setAttrs({}); }}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </span></label>
      <label className="row"><span className="lbl">Наименование</span><span className="ctl"><input value={name} placeholder="150-я стрелковая дивизия" onChange={(e) => setName(e.target.value)} /></span></label>
      <label className="row"><span className="lbl">Кратко</span><span className="ctl"><input value={shortName} placeholder="150 сд" onChange={(e) => setShortName(e.target.value)} /></span></label>
      {statics.map((fd) => (
        <label key={fd.key} className="row"><span className="lbl">{fd.label}{fd.required ? ' *' : ''}</span><span className="ctl">
          <FieldInput api={api} field={fd} value={attrs[fd.key]} onChange={(v) => setAttrs({ ...attrs, [fd.key]: v })} />
        </span></label>
      ))}
      {err && <div className="err">{err}</div>}
      <div className="btns">
        <button onClick={async () => {
          try {
            const clean = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== '' && v !== undefined));
            const e = await api.create({ type: typeId, name: name.trim() || shortName.trim(), shortName: shortName.trim() || undefined, side: f.side, attrs: clean });
            onDone(e.id);
          } catch (e) { setErr((e as Error).message); }
        }}>Создать и связать</button>
        <button className="link" onClick={() => onDone(null)}>отмена</button>
      </div>
    </div>
  );
}

/* --------------------- характеристики на момент --------------------- */
function AttrTable({ api, entity, type, state, facts, time, onChanged, setError }: {
  api: RegistryApi; entity: Entity; type: EntityType; state?: EntityState; facts: Fact[]; time: TimeInstant | null;
  onChanged: () => void; setError: (s: string | null) => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const [value, setValue] = useState<unknown>(undefined);
  const [from, setFrom] = useState<TimeInstant | null>(time);
  const [source, setSource] = useState('');
  useEffect(() => { setFrom(time); }, [time, edit]);
  const attrs = state?.attrs ?? entity.attrs;
  const factById = useMemo(() => new Map(facts.map((x) => [x.id, x])), [facts]);
  const extra = Object.keys(attrs).filter((k) => !type.fields.some((fd) => fd.key === k));

  const save = async (fd: FieldDef) => {
    try {
      if (fd.temporal) {
        if (!from) { setError('Укажите, с какого момента действует значение'); return; }
        await api.addFact(entity.id, { validFrom: from, attrs: { [fd.key]: value === '' ? null : value }, source: source || undefined });
      } else {
        await api.update(entity.id, { attrs: { [fd.key]: value === '' ? null : value } });
      }
      setEdit(null); setError(null); onChanged();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <table className="attrs">
      <tbody>
        {type.fields.map((fd) => {
          const v = attrs[fd.key];
          const fact = state?.from[fd.key] ? factById.get(state.from[fd.key]) : undefined;
          if (edit === fd.key) {
            return (
              <tr key={fd.key} className="editing"><td colSpan={2}>
                <div className="lbl">{fd.label}{fd.temporal ? '' : ' (постоянная)'}</div>
                <FieldInput api={api} field={fd} value={value} onChange={setValue} />
                {fd.temporal && (
                  <>
                    <div className="row"><span className="lbl">действует с</span><span className="ctl">
                      <input type="datetime-local" value={toInput(from)} onChange={(e) => setFrom(fromInput(e.target.value))} />
                    </span></div>
                    <input className="src-in" placeholder="источник (архив, литература)" value={source} onChange={(e) => setSource(e.target.value)} />
                  </>
                )}
                <div className="btns"><button onClick={() => save(fd)}>Записать{fd.temporal && from ? ` с ${fmtMoment(from, true)}` : ''}</button><button className="link" onClick={() => setEdit(null)}>отмена</button></div>
              </td></tr>
            );
          }
          return (
            <tr key={fd.key} onClick={() => { setEdit(fd.key); setValue(v ?? ''); setSource(''); }} title={fd.temporal ? 'Щёлкните, чтобы записать новое значение с даты' : 'Щёлкните, чтобы изменить'}>
              <td className="k">{fd.label}{fd.temporal ? <span className="tm" title="меняется во времени">⏱</span> : null}</td>
              <td className="v">
                {fd.type === 'ref' ? <RefName api={api} id={v as string | undefined} /> : formatAttr(fd, v)}
                {fact && <div className="muted since" title={fact.source ?? ''}>с {fmtMoment(fact.validFrom, true)}{fact.validTo ? ` по ${fmtMoment(fact.validTo, true)}` : ''}{fact.source ? ' · ист.' : ''}</div>}
              </td>
            </tr>
          );
        })}
        {extra.map((k) => <tr key={k}><td className="k">{k}</td><td className="v">{String(attrs[k])}</td></tr>)}
      </tbody>
    </table>
  );
}

/** Поле ввода значения по типу характеристики. */
function FieldInput({ api, field: fd, value, onChange }: { api: RegistryApi; field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const v = value ?? '';
  switch (fd.type) {
    case 'integer': case 'number':
      return <input type="number" step={fd.type === 'integer' ? 1 : 'any'} value={v as number | string} placeholder={fd.unit}
        onChange={(e) => onChange(e.target.value === '' ? '' : fd.type === 'integer' ? Math.round(+e.target.value) : +e.target.value)} />;
    case 'boolean': return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'date': return <input type="date" value={String(v).slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
    case 'enum':
      return (
        <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {fd.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'ref': return <RefPicker api={api} refType={fd.refType} value={value as string | undefined} onChange={onChange} />;
    case 'text': return <textarea rows={2} value={String(v)} onChange={(e) => onChange(e.target.value)} />;
    default: return <input value={String(v)} onChange={(e) => onChange(e.target.value)} />;
  }
}

function RefName({ api, id }: { api: RegistryApi; id?: string }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setName(null); return; }
    api.get(id).then((d) => setName(d.entity.shortName || d.entity.name)).catch(() => setName(id));
  }, [api, id]);
  return <>{id ? name ?? '…' : '—'}</>;
}

function RefPicker({ api, refType, value, onChange }: { api: RegistryApi; refType?: string; value?: string; onChange: (v: unknown) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Entity[]>([]);
  useEffect(() => {
    const t = setTimeout(() => api.search(q, { type: refType, limit: 8 }).then((r) => setList(r.map((x) => x.entity))).catch(() => setList([])), 200);
    return () => clearTimeout(t);
  }, [api, q, refType]);
  return (
    <span className="refpick">
      <span className="cur">{value ? <RefName api={api} id={value} /> : '—'}{value && <button className="link" onClick={() => onChange('')}>✕</button>}</span>
      <input placeholder="найти…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && <span className="opts">{list.map((e) => <button key={e.id} className="link" onClick={() => { onChange(e.id); setQ(''); }}>{e.shortName || e.name}</button>)}</span>}
    </span>
  );
}

/* --------------------- история фактов --------------------- */
function History({ api, entity, type, facts, onChanged, setError }: {
  api: RegistryApi; entity: Entity; type: EntityType; facts: Fact[]; onChanged: () => void; setError: (s: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...facts].sort((a, b) => toTime(a.validFrom) - toTime(b.validFrom));
  const label = (k: string) => type.fields.find((x) => x.key === k)?.label ?? k;
  const val = (k: string, v: unknown) => formatAttr(type.fields.find((x) => x.key === k), v);
  return (
    <div className="history">
      <button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} История изменений ({facts.length})</button>
      {open && sorted.map((x) => (
        <div key={x.id} className="fact">
          <div className="fact-h">
            <b>с {fmtMoment(x.validFrom, true)}</b>{x.validTo ? ` по ${fmtMoment(x.validTo, true)}` : ''}
            <button className="link danger" title="Удалить запись" onClick={async () => {
              if (!confirm('Удалить запись истории?')) return;
              try { await api.removeFact(entity.id, x.id); onChanged(); } catch (e) { setError((e as Error).message); }
            }}>✕</button>
          </div>
          {Object.entries(x.attrs ?? {}).map(([k, v]) => <div key={k}>{label(k)}: {v === null ? 'снято' : type.fields.find((q) => q.key === k)?.type === 'ref' ? <RefName api={api} id={v as string} /> : val(k, v)}</div>)}
          {x.geometry && <div>Положение: {x.geometry.type === 'Point' ? x.geometry.coordinates.map((c) => c.toFixed(4)).join(', ') : x.geometry.type}</div>}
          {(x.source || x.note) && <div className="muted">{[x.note, x.source].filter(Boolean).join(' · ')}</div>}
        </div>
      ))}
    </div>
  );
}
