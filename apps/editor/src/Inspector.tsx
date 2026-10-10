/** Инспектор свойств выделенного объекта. Все параметры знака доступны для точной подгонки. */
import type {
  AreaFeature, ArrowFeature, ArrowStyle, ColorStop, Decoration, Feature, LabelFeature, LineFeature, MapDocument,
  StrokeLayer, SymbolFeature, TextStyle, SymbolType,
} from '@def-ops/core';
import { PRESETS, SYMBOL_PRESETS, scaleStyle, inScaleRange, scaleRangeLabel } from '@def-ops/core';
import { ScaleRangeField } from './ScaleRange';
import { restyle } from '@def-ops/core';
import { setFeatureLayer, GLYPH_NAMES, featureAt, geometryOf, geometryAt, setKeyframe, removeKeyframe, sortedKeyframes, keyframeAt, type TimeInstant } from '@def-ops/core';
import { fmtMoment, useZones } from './time';
import { MomentInput } from './MomentInput';
import { updateFeature, removeFeature } from './store';
import { Num, ColorF, Check, Select, Text, DashF, Section, Row } from './fields';
import { newBranch } from './geometry';

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  feature: Feature;
  onDeselect: () => void;
  /** Момент, на который показана карта (null — время выключено). */
  time?: TimeInstant | null;
  setTime?: (t: TimeInstant | null) => void;
  /** Дополнительные разделы (например, объект реестра). */
  extra?: React.ReactNode;
  /** Текущий масштаб вида «1 : N». */
  viewScale?: number | null;
}

export function Inspector({ doc, setDoc, feature: f, onDeselect, time = null, setTime, extra, viewScale = null }: Props) {
  const k = f.scale ?? 1;
  const set = (fn: (f: Feature) => Feature, field: string) => setDoc(updateFeature(doc, f.id, fn), `insp-${f.id}-${field}`);
  const presetTable = PRESETS[f.kind] as Record<string, { name: string; group: string }>;

  return (
    <div className="inspector">
      <Section title={kindName(f.kind)} right={<button className="link" onClick={onDeselect}>✕</button>}>
        <Text label="Имя" value={f.name ?? ''} onChange={(v) => set((x) => ({ ...x, name: v }), 'name')} />
        <Select label="Слой" value={f.layerId} options={[...doc.layers].reverse().map((l) => [l.id, l.locked ? `${l.name} (заблокирован)` : l.name] as [string, string])}
          onChange={(v) => setDoc(setFeatureLayer(doc, f.id, v))} />
        <Select label="Пресет" value={f.preset ?? ''} options={[['', '—'], ...Object.entries(presetTable).map(([id, p]) => [id, `${p.group}: ${p.name}`] as [string, string])]}
          onChange={(v) => v && setDoc(updateFeature(doc, f.id, (x) => restyle(x, v)))} />
        {f.side && (
          <Select label="Принадлежность" value={f.side} options={[['own', 'свои (красный)'], ['enemy', 'противник (синий)'], ['neutral', 'нейтральное (чёрный)']]}
            onChange={(v) => f.preset && setDoc(updateFeature(doc, f.id, (x) => restyle(x, x.preset!, v)))} />
        )}
        <Num label="Масштаб знака" value={k} min={0.05} max={8} step={0.05} hint="Пропорционально меняет все размеры знака"
          onChange={(v) => v > 0 && set((x) => ({ ...x, scale: v, style: scaleStyle(x.style, v / (x.scale ?? 1)) }) as Feature, 'scale')} />
        <ScaleRangeField value={f.scales} current={viewScale} what="знак"
          onChange={(r) => setDoc(updateFeature(doc, f.id, (x) => ({ ...x, scales: r })))} />
        {viewScale != null && !inScaleRange(doc.layers.find((l) => l.id === f.layerId)?.scales, viewScale) && (
          <div className="muted sr-note">Слой «{doc.layers.find((l) => l.id === f.layerId)?.name}» на этом масштабе скрыт ({scaleRangeLabel(doc.layers.find((l) => l.id === f.layerId)?.scales)}).</div>
        )}
        <div className="btns">
          <button onClick={() => setDoc(updateFeature(doc, f.id, (x) => ({ ...x, hidden: !x.hidden })))}>{f.hidden ? 'Показать' : 'Скрыть'}</button>
          <button onClick={() => setDoc(updateFeature(doc, f.id, (x) => ({ ...x, locked: !x.locked })))}>{f.locked ? 'Разблокировать' : 'Заблокировать'}</button>
          {(f.kind === 'arrow' || f.kind === 'line') && (
            <button title="Развернуть направление (стрелка в обратную сторону, зубцы на другую сторону)"
              onClick={() => setDoc(updateFeature(doc, f.id, (x) => ({ ...x, points: (x as LineFeature).points.slice().reverse(), ...(x.kind === 'arrow' ? { anchor: null } : {}) }) as Feature))}>
              Развернуть
            </button>
          )}
          <button className="danger" onClick={() => { setDoc(removeFeature(doc, f.id)); onDeselect(); }}>Удалить</button>
        </div>
      </Section>
      {extra}
      <TimeInspector f={f} doc={doc} setDoc={setDoc} time={time} setTime={setTime} />
      {f.kind === 'arrow' && <ArrowInspector f={f} doc={doc} set={set} k={k} />}
      {f.kind === 'line' && <LineInspector f={f} set={set} k={k} />}
      {f.kind === 'area' && <AreaInspector f={f} set={set} k={k} />}
      {f.kind === 'symbol' && <SymbolInspector f={f} set={set} k={k} />}
      {f.kind === 'label' && <LabelInspector f={f} set={set} k={k} />}
    </div>
  );
}

type SetFn = (fn: (f: Feature) => Feature, field: string) => void;

/* ---------------- время: период на карте и положение по датам ---------------- */
function TimeInspector({ f, doc, setDoc, time, setTime }: {
  f: Feature; doc: MapDocument; setDoc: (d: MapDocument, key?: string) => void; time: TimeInstant | null; setTime?: (t: TimeInstant | null) => void;
}) {
  const up = (fn: (x: Feature) => Feature, key?: string) => setDoc(updateFeature(doc, f.id, fn), key);
  const span = f.time ?? {};
  const setSpan = (p: { from?: TimeInstant | null; to?: TimeInstant | null }) => up((x) => {
    const next = { ...(x.time ?? {}), ...p };
    return { ...x, time: next.from || next.to ? next : null };
  });
  const { local } = useZones();
  const kfs = sortedKeyframes(f);
  const motionDefault = doc.timeline?.motion ?? 'smooth';
  const at = time ? geometryAt(f, time, f.motion ?? motionDefault) : null;
  const active = time && at && !at.interpolated && at.key ? kfs.find((k) => k.t === at.key) ?? null : time ? keyframeAt(f, time) : null;
  const visible = time ? featureAt(f, time) !== null : true;
  return (
    <Section title="Время">
      <Row label="На карте с" hint="С какого момента знак есть на карте (пусто — всегда)">
        <MomentInput value={span.from} onChange={(t) => setSpan({ from: t })} />
        {time && <button className="link" title="С текущей даты" onClick={() => setSpan({ from: time })}>⏱</button>}
      </Row>
      <Row label="по" hint="До какого момента (не включительно); пусто — без конца">
        <MomentInput value={span.to} onChange={(t) => setSpan({ to: t })} />
        {time && <button className="link" title="По текущую дату" onClick={() => setSpan({ to: time })}>⏱</button>}
      </Row>
      {time && !visible && <div className="muted">На {fmtMoment(time, false, local)} знака на карте нет.</div>}
      <Row label="Переход" hint="Как знак меняет положение между датами">
        <select value={f.motion ?? ''} onChange={(e) => up((x) => ({ ...x, motion: (e.target.value || undefined) as Feature['motion'] }))}>
          <option value="">как для карты ({motionDefault === 'smooth' ? 'плавно' : 'скачком'})</option>
          <option value="smooth">плавно</option>
          <option value="step">скачком</option>
        </select>
      </Row>
      <div className="kf-list">
        <div className={`kf${!active && !at?.interpolated ? ' cur' : ''}`}>
          <span>{kfs.length ? (f.time?.from ? `с ${fmtMoment(f.time.from, true, local)}` : `до ${fmtMoment(kfs[0].t, true, local)}`) : 'положение'}</span><span className="muted">основное</span>
        </div>
        {kfs.map((k) => (
          <div key={k.t} className={`kf${active?.t === k.t ? ' cur' : ''}`}>
            <button className="link" title="Показать карту на эту дату" onClick={() => setTime?.(k.t)}>{fmtMoment(k.t, true, local)}</button>
            <input className="kf-note" placeholder="пояснение" value={k.note ?? ''}
              onChange={(e) => up((x) => ({ ...x, keyframes: (x.keyframes ?? []).map((q) => (q.t === k.t ? { ...q, note: e.target.value || undefined } : q)) }), `kfnote-${f.id}-${k.t}`)} />
            <button className="link danger" title="Удалить это положение" onClick={() => up((x) => removeKeyframe(x, k.t))}>✕</button>
          </div>
        ))}
      </div>
      <div className="btns">
        <button disabled={!time || !visible || active?.t === time}
          title={time ? 'Знак получит новое положение с этого момента; тяните его на карте — изменится только оно' : 'Включите шкалу времени под картой'}
          onClick={() => time && up((x) => setKeyframe(x, time, geometryOf(featureAt(x, time) ?? x)))}>
          Новое положение на {time ? fmtMoment(time, true, local) : '…'}
        </button>
      </div>
      {time && <div className="muted hint">{at?.interpolated
        ? `Показано промежуточное положение на ${fmtMoment(time, true, local)}; перетаскивание создаст новое положение на этот момент.`
        : `Перетаскивание на карте меняет положение, действующее на ${fmtMoment(time, true, local)}${active ? ` (с ${fmtMoment(active.t, true, local)})` : kfs.length ? ' (основное)' : ''}.`}</div>}
    </Section>
  );
}

function kindName(k: Feature['kind']) {
  return { arrow: 'Стрелка', line: 'Линия', area: 'Район', symbol: 'Знак', label: 'Надпись' }[k];
}

/* ---------------- стрелка ---------------- */
function ArrowInspector({ f, doc, set, k }: { f: ArrowFeature; doc: MapDocument; set: SetFn; k: number }) {
  const s = f.style;
  const up = (p: Partial<ArrowStyle>, field: string) => set((x) => ({ ...x, style: { ...(x as ArrowFeature).style, ...p } }) as Feature, field);
  const M = 120 * k;
  const anchorName = f.anchor ? (doc.features.find((q) => q.id === f.anchor!.featureId)?.name || f.anchor.featureId) : null;
  return (
    <>
      <Section title="Хвост">
        <Row label="Привязка">
          {f.anchor ? (
            <>
              <span className="tag">к «{anchorName}»</span>
              <button onClick={() => set((x) => ({ ...x, anchor: null }) as Feature, 'anchor')}>Отвязать</button>
            </>
          ) : <span className="muted">нет — перетащите хвост на линию</span>}
        </Row>
        {f.anchor && <Num label="Положение на линии" value={f.anchor.t} min={0} max={1} step={0.001}
          onChange={(v) => set((x) => ({ ...x, anchor: { ...(x as ArrowFeature).anchor!, t: v } }) as Feature, 'anchorT')} />}
        <Num label="Ширина хвоста" value={s.tailWidth} max={M} onChange={(v) => up({ tailWidth: v }, 'tw')} />
        {f.anchor
          ? <Num label="Заход под линию" value={s.anchorOverlap} max={20 * k} onChange={(v) => up({ anchorOverlap: v }, 'ov')} />
          : <>
            <Select label="Форма хвоста" value={s.tailShape} options={[['flat', 'прямой'], ['notch', 'вырез (ласточкин хвост)'], ['round', 'скруглённый']]} onChange={(v) => up({ tailShape: v }, 'ts')} />
            {s.tailShape === 'notch' && <Num label="Глубина выреза" value={s.tailNotch} min={0} max={1.5} step={0.01} onChange={(v) => up({ tailNotch: v }, 'tn')} />}
          </>}
      </Section>
      <Section title="Тело">
        <Check label="Сглаживание" value={s.smooth} onChange={(v) => up({ smooth: v }, 'sm')} />
        <Num label="Ширина у шейки" value={s.neckWidth} max={M} onChange={(v) => up({ neckWidth: v }, 'nw')} />
        <Num label="Характер сужения" value={s.taper} min={0.2} max={4} step={0.05} hint="1 — линейно; >1 — быстро сужается у хвоста; <1 — у шейки" onChange={(v) => up({ taper: v }, 'tp')} />
        <StopsEditor stops={s.fill} onChange={(fill) => up({ fill }, 'fill')} />
        <OptStroke label="Контур" value={s.outline} k={k} def={{ color: '#d43834', width: 1.1 * k }} onChange={(outline) => up({ outline }, 'ol')} />
        {s.outline && !f.anchor && <Check label="Обводить торец хвоста" value={s.outlineTail} onChange={(v) => up({ outlineTail: v }, 'olt')} />}
        <OptStroke label="Осевая линия" value={s.centerLine} k={k} def={{ color: '#d43834', width: 1 * k }} onChange={(centerLine) => up({ centerLine }, 'cl')} />
        <Check label="Объёмный блик" value={!!s.highlight} onChange={(v) => up({ highlight: v ? { color: '#ffffff', opacity: 0.6, widthRatio: 0.5 } : null }, 'hl')} />
        {s.highlight && <>
          <ColorF label="Цвет блика" value={s.highlight.color} opacity={s.highlight.opacity}
            onChange={(c) => up({ highlight: { ...s.highlight!, color: c } }, 'hlc')} onOpacity={(o) => up({ highlight: { ...s.highlight!, opacity: o } }, 'hlo')} />
          <Num label="Ширина блика" value={s.highlight.widthRatio} min={0.05} max={1} step={0.01} onChange={(v) => up({ highlight: { ...s.highlight!, widthRatio: v } }, 'hlw')} />
        </>}
      </Section>
      <Section title="Наконечник">
        <Num label="Размах «усов»" value={s.headWidth} max={M * 1.5} onChange={(v) => up({ headWidth: v }, 'hw')} />
        <Num label="Длина" value={s.headLength} max={M * 1.5} onChange={(v) => up({ headLength: v }, 'hl')} />
        <Num label="Стреловидность" value={s.barbSweep} min={-30 * k} max={40 * k} hint="На сколько концы «усов» отнесены назад" onChange={(v) => up({ barbSweep: v }, 'bs')} />
        <Num label="Кривизна граней" value={s.headCurve} min={0.4} max={2.5} step={0.01} hint="1 — прямые, <1 — выпуклые, >1 — вогнутые" onChange={(v) => up({ headCurve: v }, 'hc')} />
        <Check label="Свой цвет" value={!!s.headFill} onChange={(v) => up({ headFill: v ? (s.fill[s.fill.length - 1]?.color ?? '#d43834') : null }, 'hf')} />
        {s.headFill && <ColorF label="Цвет" value={s.headFill} opacity={s.headOpacity} onChange={(c) => up({ headFill: c }, 'hfc')} onOpacity={(o) => up({ headOpacity: o }, 'hfo')} />}
      </Section>
      <Section title="Окончание и дата">
        <Select label="Окончание" value={s.tip ?? 'head'} options={[['head', 'наконечник'], ['bar', 'черта — рубеж достигнут'], ['none', 'без окончания']]} onChange={(v) => up({ tip: v as ArrowStyle['tip'] }, 'tip')} />
        <Text label="Надпись у острия" value={f.tipText ?? ''} onChange={(v) => set((x) => ({ ...x, tipText: v || undefined }) as Feature, 'tipText')} />
      </Section>
      <Section title={`Ветви${f.branches?.length ? ` · ${f.branches.length}` : ''}`} right={<button onClick={() => { const b = newBranch(doc, f); if (b) set((x) => ({ ...x, branches: [...((x as ArrowFeature).branches ?? []), b] }) as Feature, 'branchAdd'); }}>+ ветвь</button>}>
        {!f.branches?.length && <p className="muted small">Удар, расходящийся на несколько направлений: «+ ветвь» — ветвь от развилки на стволе (ромб на карте тянется вдоль стрелки, точки ветви — как у стрелки).</p>}
        {(f.branches ?? []).map((b, i) => (
          <div key={i} className="branch-row">
            <Num label={`Развилка ${i + 1} (доля длины)`} value={b.t} min={0.05} max={0.95} step={0.01} onChange={(v) => set((x) => ({ ...x, branches: (x as ArrowFeature).branches!.map((q, j) => (j === i ? { ...q, t: v } : q)) }) as Feature, `bt${i}`)} />
            <Text label="Надпись у острия ветви" value={b.text ?? ''} onChange={(v) => set((x) => ({ ...x, branches: (x as ArrowFeature).branches!.map((q, j) => (j === i ? { ...q, text: v || undefined } : q)) }) as Feature, `bx${i}`)} />
            <button className="link danger" onClick={() => set((x) => ({ ...x, branches: (x as ArrowFeature).branches!.filter((_, j) => j !== i) }) as Feature, `bd${i}`)}>Удалить ветвь</button>
          </div>
        ))}
        {(f.branches?.length ?? 0) > 0 && <Num label="Ширина ветвей (доля ствола)" value={s.branchWidth ?? 0.7} min={0.3} max={1} step={0.01} onChange={(v) => up({ branchWidth: v }, 'bw')} />}
      </Section>
      <DecorationsEditor list={s.decorations} k={k} onChange={(decorations) => up({ decorations }, 'dec')} />
    </>
  );
}

function StopsEditor({ stops, onChange }: { stops: ColorStop[]; onChange: (s: ColorStop[]) => void }) {
  const upd = (i: number, p: Partial<ColorStop>) => onChange(stops.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const css = stops.slice().sort((a, b) => a.t - b.t).map((s) => `${hexA(s.color, s.opacity)} ${s.t * 100}%`).join(',');
  return (
    <div className="stops">
      <div className="stops-h">
        <span>Заливка вдоль оси (хвост → шейка)</span>
        <button onClick={() => onChange([...stops, { t: 0.5, color: stops[stops.length - 1]?.color ?? '#d43834', opacity: 1 }])}>+</button>
      </div>
      <div className="grad" style={{ background: `linear-gradient(90deg, ${css}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/10px 10px` }} />
      {stops.map((s, i) => (
        <div key={i} className="stop">
          <input type="number" className="num sm" title="Положение 0..1" min={0} max={1} step={0.05} value={s.t} onChange={(e) => upd(i, { t: +e.target.value })} />
          <input type="color" value={s.color} onChange={(e) => upd(i, { color: e.target.value })} />
          <input type="text" className="hex" value={s.color} onChange={(e) => upd(i, { color: e.target.value })} />
          <input type="number" className="num sm" title="Непрозрачность" min={0} max={1} step={0.05} value={s.opacity} onChange={(e) => upd(i, { opacity: +e.target.value })} />
          {stops.length > 1 && <button className="link" onClick={() => onChange(stops.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
    </div>
  );
}

function hexA(c: string, a: number) {
  const n = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(c) ? c + n : c;
}

function OptStroke({ label, value, def, onChange, k }: {
  label: string; value: { color: string; width: number; opacity?: number; dash?: number[] } | null; def: { color: string; width: number };
  onChange: (v: { color: string; width: number; opacity?: number; dash?: number[] } | null) => void; k: number;
}) {
  return (
    <>
      <Check label={label} value={!!value} onChange={(v) => onChange(v ? def : null)} />
      {value && <>
        <ColorF label="  цвет" value={value.color} opacity={value.opacity ?? 1} onChange={(c) => onChange({ ...value, color: c })} onOpacity={(o) => onChange({ ...value, opacity: o })} />
        <Num label="  толщина" value={value.width} max={10 * k} step={0.05} onChange={(w) => onChange({ ...value, width: w })} />
      </>}
    </>
  );
}

function DecorationsEditor({ list, onChange, k }: { list: Decoration[]; onChange: (d: Decoration[]) => void; k: number }) {
  const upd = (i: number, p: Partial<Decoration>) => onChange(list.map((d, j) => (j === i ? { ...d, ...p } : d)));
  return (
    <Section title="Украшения на оси" right={
      <select value="" onChange={(e) => {
        const t = e.target.value as Decoration['type'];
        if (!t) return;
        const base: Decoration = { type: t, at: 0.5, length: 14 * k, width: 8 * k, fill: '#d43834', stroke: null };
        if (t === 'bar') Object.assign(base, { to: 0.7, width: 4 * k });
        if (t === 'chevron') Object.assign(base, { repeat: 0.2, at: 0.15, to: 0.8, length: 4 * k, width: 9 * k, stroke: { color: '#d43834', width: 1.3 * k } });
        onChange([...list, base]);
      }}>
        <option value="">+ добавить</option>
        <option value="diamond">ромб (танки)</option>
        <option value="bar">полоса</option>
        <option value="tick">засечка</option>
        <option value="chevron">«птички»</option>
      </select>
    }>
      {list.map((d, i) => (
        <div key={i} className="sub">
          <div className="sub-h"><b>{{ diamond: 'Ромб', bar: 'Полоса', tick: 'Засечка', chevron: '«Птички»', glyph: 'Знак на оси' }[d.type]}</b>
            <button className="link" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button></div>
          <Num label="Положение" value={d.at} min={0} max={1} step={0.005} onChange={(v) => upd(i, { at: v })} />
          {(d.type === 'bar' || d.repeat) && <Num label="До" value={d.to ?? 1} min={0} max={1} step={0.005} onChange={(v) => upd(i, { to: v })} />}
          {d.type === 'chevron' && <Num label="Шаг повтора" value={d.repeat ?? 0} min={0} max={1} step={0.01} onChange={(v) => upd(i, { repeat: v })} />}
          {d.type !== 'bar' && <Num label="Длина" value={d.length} max={60 * k} onChange={(v) => upd(i, { length: v })} />}
          <Num label="Ширина" value={d.width} max={40 * k} onChange={(v) => upd(i, { width: v })} />
          <ColorF label="Цвет" value={d.fill ?? '#000000'} onChange={(c) => upd(i, { fill: c })} />
          {d.type === 'diamond' && <OptStroke label="Обводка" value={d.stroke ?? null} k={k} def={{ color: '#ffffff', width: 1.5 * k }} onChange={(v) => upd(i, { stroke: v })} />}
        </div>
      ))}
    </Section>
  );
}

/* ---------------- линии ---------------- */
function LayersEditor({ layers, onChange, k, title = 'Слои штриха' }: { layers: StrokeLayer[]; onChange: (l: StrokeLayer[]) => void; k: number; title?: string }) {
  const upd = (i: number, p: Partial<StrokeLayer>) => onChange(layers.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const move = (i: number, d: number) => {
    const a = layers.slice(); const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; onChange(a);
  };
  return (
    <Section title={title} right={<button onClick={() => onChange([...layers, { offset: 0, width: 1.5 * k, color: '#d43834', opacity: 1 }])}>+ слой</button>}>
      {layers.map((l, i) => (
        <div key={i} className="sub">
          <div className="sub-h"><b>Слой {i + 1}</b>
            <span>
              <button className="link" title="Ниже" onClick={() => move(i, -1)}>↑</button>
              <button className="link" title="Выше" onClick={() => move(i, 1)}>↓</button>
              <button className="link" onClick={() => onChange(layers.filter((_, j) => j !== i))}>✕</button>
            </span></div>
          <ColorF label="Цвет" value={l.color} opacity={l.opacity} onChange={(c) => upd(i, { color: c })} onOpacity={(o) => upd(i, { opacity: o })} />
          <Num label="Толщина" value={l.width} max={20 * k} step={0.05} onChange={(v) => upd(i, { width: v })} />
          <Num label="Смещение" value={l.offset} min={-15 * k} max={15 * k} step={0.05} hint="> 0 — влево по ходу линии" onChange={(v) => upd(i, { offset: v })} />
          <DashF label="Пунктир" value={l.dash} onChange={(v) => upd(i, { dash: v })} />
          <Select label="Концы" value={l.cap ?? 'butt'} options={[['butt', 'срез'], ['round', 'круглые'], ['square', 'квадратные']]} onChange={(v) => upd(i, { cap: v })} />
          <Check label="Зубцы" value={!!l.ticks} onChange={(v) => upd(i, { ticks: v ? { spacing: 10 * k, length: 5 * k, width: 1.5 * k, side: 1 } : undefined })} />
          {l.ticks && <>
            <Num label="  шаг" value={l.ticks.spacing} max={40 * k} min={0.5 * k} onChange={(v) => upd(i, { ticks: { ...l.ticks!, spacing: v } })} />
            <Num label="  длина" value={l.ticks.length} max={20 * k} onChange={(v) => upd(i, { ticks: { ...l.ticks!, length: v } })} />
            <Num label="  толщина" value={l.ticks.width} max={8 * k} step={0.05} onChange={(v) => upd(i, { ticks: { ...l.ticks!, width: v } })} />
            <Num label="  наклон°" value={l.ticks.angle ?? 0} min={-60} max={60} step={1} onChange={(v) => upd(i, { ticks: { ...l.ticks!, angle: v } })} />
            <Select label="  сторона" value={l.ticks.side} options={[[1, 'слева'], [-1, 'справа'], [0, 'обе']]} onChange={(v) => upd(i, { ticks: { ...l.ticks!, side: v } })} />
            <Select label="  форма" value={l.ticks.shape ?? 'line'} options={[['line', 'штрих'], ['triangle', 'треугольник']]} onChange={(v) => upd(i, { ticks: { ...l.ticks!, shape: v } })} />
          </>}
          <Check label="Засечки на концах" value={!!l.endTicks} onChange={(v) => upd(i, { endTicks: v ? { length: 6 * k, width: l.width, side: -1 } : undefined })} />
          {l.endTicks && <>
            <Num label="  длина" value={l.endTicks.length} max={20 * k} onChange={(v) => upd(i, { endTicks: { ...l.endTicks!, length: v } })} />
            <Select label="  сторона" value={l.endTicks.side} options={[[1, 'слева'], [-1, 'справа']]} onChange={(v) => upd(i, { endTicks: { ...l.endTicks!, side: v } })} />
          </>}
        </div>
      ))}
    </Section>
  );
}

function LineInspector({ f, set, k }: { f: LineFeature; set: SetFn; k: number }) {
  return (
    <>
      <Section title="Геометрия">
        <Check label="Сглаживание" value={f.style.smooth} onChange={(v) => set((x) => ({ ...x, style: { ...(x as LineFeature).style, smooth: v } }) as Feature, 'sm')} />
        <Check label="Замкнутая" value={!!f.closed} onChange={(v) => set((x) => ({ ...x, closed: v }) as Feature, 'cl')} />
      </Section>
      <LayersEditor layers={f.style.layers} k={k} onChange={(layers) => set((x) => ({ ...x, style: { ...(x as LineFeature).style, layers } }) as Feature, 'layers')} />
    </>
  );
}

function AreaInspector({ f, set, k }: { f: AreaFeature; set: SetFn; k: number }) {
  const s = f.style;
  const up = (p: Partial<AreaFeature['style']>, field: string) => set((x) => ({ ...x, style: { ...(x as AreaFeature).style, ...p } }) as Feature, field);
  return (
    <>
      <Section title="Заливка">
        <Check label="Сглаживание" value={s.smooth} onChange={(v) => up({ smooth: v }, 'sm')} />
        <Check label="Заливка" value={!!s.fill} onChange={(v) => up({ fill: v ? '#f8c0a9' : null }, 'f')} />
        {s.fill && <ColorF label="  цвет" value={s.fill} opacity={s.fillOpacity} onChange={(c) => up({ fill: c }, 'fc')} onOpacity={(o) => up({ fillOpacity: o }, 'fo')} />}
        <Check label="Штриховка" value={!!s.hatch} onChange={(v) => up({ hatch: v ? { color: '#3d6b95', width: 1.5 * k, spacing: 5 * k, angle: -45, opacity: 1 } : null }, 'h')} />
        {s.hatch && <>
          <ColorF label="  цвет" value={s.hatch.color} opacity={s.hatch.opacity} onChange={(c) => up({ hatch: { ...s.hatch!, color: c } }, 'hc')} onOpacity={(o) => up({ hatch: { ...s.hatch!, opacity: o } }, 'ho')} />
          <Num label="  толщина" value={s.hatch.width} max={6 * k} step={0.05} onChange={(v) => up({ hatch: { ...s.hatch!, width: v } }, 'hw')} />
          <Num label="  шаг" value={s.hatch.spacing} max={20 * k} min={0.5 * k} onChange={(v) => up({ hatch: { ...s.hatch!, spacing: v } }, 'hs')} />
          <Num label="  угол°" value={s.hatch.angle} min={-90} max={90} step={1} onChange={(v) => up({ hatch: { ...s.hatch!, angle: v } }, 'ha')} />
        </>}
      </Section>
      <LayersEditor title="Контур" layers={s.edge} k={k} onChange={(edge) => up({ edge }, 'edge')} />
      <Section title="Крест «уничтожено»">
        <Check label="Показать" value={!!s.cross} onChange={(v) => up({ cross: v ? { color: '#c8463f', width: 10 * k, opacity: 0.95, angle: 0, spread: 100, extend: 1.18 } : null }, 'x')} />
        {s.cross && <>
          <ColorF label="Цвет" value={s.cross.color} opacity={s.cross.opacity} onChange={(c) => up({ cross: { ...s.cross!, color: c } }, 'xc')} onOpacity={(o) => up({ cross: { ...s.cross!, opacity: o } }, 'xo')} />
          <Num label="Толщина" value={s.cross.width} max={30 * k} onChange={(v) => up({ cross: { ...s.cross!, width: v } }, 'xw')} />
          <Num label="Поворот°" value={s.cross.angle} min={-90} max={90} step={1} onChange={(v) => up({ cross: { ...s.cross!, angle: v } }, 'xa')} />
          <Num label="Угол между°" value={s.cross.spread} min={20} max={160} step={1} onChange={(v) => up({ cross: { ...s.cross!, spread: v } }, 'xs')} />
          <Num label="Вынос за контур" value={s.cross.extend} min={0.5} max={2} step={0.01} onChange={(v) => up({ cross: { ...s.cross!, extend: v } }, 'xe')} />
        </>}
      </Section>
    </>
  );
}

const SYMBOL_TYPES: [SymbolType, string][] = [
  ['settlement', 'Населённый пункт (точка)'], ['town', 'Населённый пункт (кружок)'], ['tankArmy', 'Овал с ромбом (танковое объединение)'],
  ['cavalryCorps', 'Овал со штриховкой (кавкорпус)'], ['armyOval', 'Овал объединения'], ['reserve', 'Резерв (Р)'], ['fortifiedCity', 'Город-крепость'],
  ['aviation', 'Авиация (атлас)'], ['victoryFlag', 'Знамя'], ['pennant', 'Флажок'], ['dateBox', 'Дата в рамке'], ['meeting', 'Встреча войск'],
  ...Object.entries(GLYPH_NAMES).filter(([k]) => k !== 'pennant') as [SymbolType, string][],
];
// уставные и прочие глифы, которых нет в списке выше, — под именами их пресетов
for (const p of Object.values(SYMBOL_PRESETS)) {
  const t = p.style().type;
  if (!SYMBOL_TYPES.some(([k]) => k === t)) SYMBOL_TYPES.push([t, `${p.group}: ${p.name}`]);
}

function SymbolInspector({ f, set, k }: { f: SymbolFeature; set: SetFn; k: number }) {
  const s = f.style;
  const up = (p: Partial<SymbolFeature['style']>, field: string) => set((x) => ({ ...x, style: { ...(x as SymbolFeature).style, ...p } }) as Feature, field);
  return (
    <Section title="Знак">
      <Select label="Тип" value={s.type} options={SYMBOL_TYPES} onChange={(v) => up({ type: v }, 'type')} />
      <Num label="Размер" value={s.size} max={120 * k} onChange={(v) => up({ size: v }, 'size')} />
      <Num label="Поворот°" value={f.rotation} min={-180} max={180} step={1} onChange={(v) => set((x) => ({ ...x, rotation: v }) as Feature, 'rot')} />
      {['tankArmy', 'cavalryCorps', 'armyOval', 'reserve'].includes(s.type) && <Num label="Сжатие овала" value={s.aspect} min={0.2} max={2} step={0.01} onChange={(v) => up({ aspect: v }, 'asp')} />}
      <ColorF label="Цвет" value={s.color} onChange={(c) => up({ color: c }, 'c')} />
      <ColorF label="Заливка" value={s.fill} onChange={(c) => up({ fill: c }, 'fill')} />
      <Num label="Толщина линий" value={s.strokeWidth} max={6 * k} step={0.05} onChange={(v) => up({ strokeWidth: v }, 'sw')} />
      <Select label="Штриховка" value={s.hatch?.mode ?? 'none'} options={[['none', 'нет'], ['half', 'половина (выдвигается)'], ['full', 'целиком (формируется)']]}
        onChange={(v) => up({ hatch: v === 'none' ? null : { ...(s.hatch ?? {}), mode: v as 'half' | 'full' } }, 'hatch')} />
      <Select label="Перечёркнуто" value={s.cross?.mode ?? 'none'} options={[['none', 'нет'], ['slash', 'чертой (разгромлено)'], ['x', 'крестом (уничтожено)']]}
        onChange={(v) => up({ cross: v === 'none' ? null : { color: s.cross?.color ?? (f.side === 'enemy' ? '#d43834' : '#2f6fae'), ...(s.cross ?? {}), mode: v as 'slash' | 'x' } }, 'cross')} />
      {s.cross && <ColorF label="Цвет перечёркивания" value={s.cross.color} onChange={(c) => up({ cross: { ...s.cross!, color: c } }, 'crossC')} />}
      {['dateBox', 'meeting', 'reserve', 'cp', 'hq', 'reserveCp', 'cop', 'op', 'depot', 'supply', 'repair', 'kpp', 'railStation', 'fougasse', 'ford', 'height'].includes(s.type) && <Text label="Текст" value={s.text ?? ''} onChange={(v) => up({ text: v }, 'text')} />}
    </Section>
  );
}

const FONTS: [string, string][] = [['PT Sans Narrow', 'PT Sans Narrow (узкий рубленый)'], ['PT Serif', 'PT Serif (антиква)'], ['Roboto Condensed', 'Roboto Condensed']];

function LabelInspector({ f, set, k }: { f: LabelFeature; set: SetFn; k: number }) {
  const s = f.style;
  const up = (p: Partial<TextStyle>, field: string) => set((x) => ({ ...x, style: { ...(x as LabelFeature).style, ...p } }) as Feature, field);
  return (
    <Section title="Надпись">
      <Text label="Текст" multiline value={f.text} onChange={(v) => set((x) => ({ ...x, text: v }) as Feature, 'text')} />
      <Select label="Шрифт" value={s.font} options={FONTS} onChange={(v) => up({ font: v }, 'font')} />
      <Num label="Кегль" value={s.size} max={60 * k} step={0.1} onChange={(v) => up({ size: v }, 'size')} />
      <Select label="Начертание" value={s.weight} options={[[400, 'обычное'], [500, 'полужирное (500)'], [700, 'жирное']]} onChange={(v) => up({ weight: v }, 'w')} />
      <Check label="Курсив" value={s.italic} onChange={(v) => up({ italic: v }, 'it')} />
      <Check label="Прописные" value={s.uppercase} onChange={(v) => up({ uppercase: v }, 'uc')} />
      <ColorF label="Цвет" value={s.color} onChange={(c) => up({ color: c }, 'c')} />
      <Num label="Разрядка" value={s.letterSpacing} min={-2 * k} max={30 * k} step={0.1} onChange={(v) => up({ letterSpacing: v }, 'ls')} />
      <Num label="Интерлиньяж" value={s.lineHeight} min={0.7} max={2} step={0.01} onChange={(v) => up({ lineHeight: v }, 'lh')} />
      <Select label="Выключка" value={s.align} options={[['start', 'влево'], ['middle', 'по центру'], ['end', 'вправо']]} onChange={(v) => up({ align: v }, 'al')} />
      <Num label="Поворот°" value={f.rotation} min={-180} max={180} step={1} onChange={(v) => set((x) => ({ ...x, rotation: v }) as Feature, 'rot')} />
      <Check label="Белая подложка (ореол)" value={!!s.halo} onChange={(v) => up({ halo: v ? { color: '#ffffff', width: 1.5 * k } : null }, 'halo')} />
      {s.halo && <Num label="  ширина ореола" value={s.halo.width} max={6 * k} step={0.05} onChange={(v) => up({ halo: { ...s.halo!, width: v } }, 'hw')} />}
    </Section>
  );
}
