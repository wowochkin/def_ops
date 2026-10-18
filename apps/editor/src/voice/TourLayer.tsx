/**
 * Слой тура: остальной экран притемнён (четыре полосы вокруг проёма), вокруг элемента — светящаяся рамка внутри
 * проёма; рамка и полосы плавно переезжают к следующему элементу. Подпись крупно, с примером фразы и кнопками
 * (действия реестра tour.*), ставится после измерения туда, где не закрывает ни подсвеченное, ни панель голоса
 * (placeCaption). Подключается в оболочке одной строкой: `<TourLayer section={section} />`.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActButton } from './registry';
import { registerTourActions } from './actions/tour';
import { findTarget, onVoiceReady, READY_FIRST, stepCaption, tourControl, tourEngine, tourSection } from './tour';

export type Rect = { top: number; left: number; width: number; height: number };

/** Отступ проёма от элемента; у кнопок колонки (стоят через 2 px) — 1 px, чтобы рамка не легла на соседей. */
export const padFor = (target: string) => (/^rail-/.test(target) ? 1 : 8);
const MARGIN = 16;
/** Подпись — правее колонки разделов (68–76 px), на узком экране — от края. */
const railRight = (vw: number) => (vw <= 760 ? MARGIN : 84);

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/**
 * Где поставить подпись размером cap: первое место без пересечения с avoid (проём, панель голоса) — снизу слева,
 * сверху слева, снизу у правого края свободной полосы (левее панели голоса), сверху там же; не нашлось — где
 * перекрытие меньше всего.
 */
export function placeCaption(cap: { width: number; height: number }, avoid: Rect[], vw: number, vh: number, panel: Rect | null): { left: number; top: number } {
  const l = railRight(vw);
  const panelLeft = panel && panel.left > vw / 2 ? panel.left - MARGIN : vw - MARGIN;
  const r = Math.max(l + cap.width, panelLeft);
  const low = Math.max(MARGIN, vh - MARGIN - cap.height);
  const cands = [
    { left: l, top: low }, { left: l, top: MARGIN },
    { left: Math.max(MARGIN, r - cap.width), top: low }, { left: Math.max(MARGIN, r - cap.width), top: MARGIN },
  ];
  const hit = (c: { left: number; top: number }) => avoid.reduce((s, a) => s + overlap({ ...c, ...cap }, a), 0);
  return cands.find((c) => hit(c) === 0) ?? cands.reduce((a, b) => (hit(b) < hit(a) ? b : a));
}

const snapshot = () => tourEngine.state;

export function TourLayer({ section }: { section: string }) {
  const st = useSyncExternalStore(tourEngine.subscribe, snapshot, snapshot);
  const [view, setView] = useState(() => (typeof window === 'undefined' ? { w: 1440, h: 900 } : { w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => registerTourActions(tourControl), []);
  // голос впервые готов: вступление, затем — предложение калибровки (панелью, voice:propose)
  useEffect(() => {
    const h = (e: Event) => onVoiceReady(e);
    const rs = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener(READY_FIRST, h);
    window.addEventListener('resize', rs);
    return () => { window.removeEventListener(READY_FIRST, h); window.removeEventListener('resize', rs); };
  }, []);
  useEffect(() => { tourSection(section); }, [section]);

  const step = st ? st.tour.steps[st.index] : null;
  const target = step ? (st!.missing && step.via ? step.via : step.target) : null;
  const box = useTargetBox(target, st?.index ?? -1);
  const pad = target ? padFor(target) : 0;
  // проём в притемнении (он же рамка); элемента нет — схлопнут в середину экрана (притемнено всё)
  const hole: Rect = box
    ? { top: box.top - pad, left: box.left - pad, width: box.width + 2 * pad, height: box.height + 2 * pad }
    : { top: view.h / 2, left: view.w / 2, width: 0, height: 0 };

  const cap = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = cap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panel = findTarget('voice')?.rect ?? null;
    const p = placeCaption({ width: r.width, height: r.height }, [...(box ? [hole] : []), ...(panel ? [panel] : [])], view.w, view.h, panel);
    setPos((o) => (o && Math.abs(o.left - p.left) < 1 && Math.abs(o.top - p.top) < 1 ? o : p));
  });

  if (!st || !step) return null;
  const n = st.tour.steps.length;
  const text = st.extra && step.more ? step.more : stepCaption(step, st.missing);
  const bottom = hole.top + hole.height;
  const right = hole.left + hole.width;
  const paused = st.phase === 'paused';
  return (
    <div className="tour" data-phase={st.phase}>
      <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className="tour-dim" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-dim" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
      <div className="tour-dim" style={{ top: hole.top, left: right, right: 0, height: hole.height }} />
      <div className={`tour-frame${box ? '' : ' none'}`} data-target={box ? target ?? '' : ''} aria-hidden="true" style={hole} />
      <section ref={cap} className="tour-cap" style={pos ?? { left: railRight(view.w), bottom: MARGIN }} role="dialog" aria-label={`Тур: ${st.tour.title}`} aria-live="polite">
        <div className="tour-count">{st.tour.title} · шаг {st.index + 1} из {n}{paused ? ' · пауза' : ''}</div>
        <h2>{step.title}</h2>
        <p className="tour-text">{text}</p>
        {step.example && <p className="tour-say">Скажите: «{step.example}»</p>}
        <div className="tour-btns">
          <ActButton action="tour.back" disabled={st.index === 0}>Назад</ActButton>
          {paused ? <ActButton action="tour.resume">Продолжить</ActButton> : <ActButton action="tour.pause">Пауза</ActButton>}
          <ActButton action="tour.next" className="primary">{st.index + 1 < n ? 'Дальше' : 'Готово'}</ActButton>
          <ActButton action="tour.stop">Хватит</ActButton>
          {st.tour.id === 'intro' && <ActButton action="tour.introOff" className="tour-off">Больше не показывать</ActButton>}
        </div>
        {paused && <p className="tour-hint">Пауза. Скажите: «продолжай» или «хватит».</p>}
      </section>
    </div>
  );
}

/** Прямоугольник элемента тура: пересчёт при прокрутке, смене размера окна и раз в 250 мс (раздел дорисовывается). */
function useTargetBox(target: string | null, index: number): Rect | null {
  const [box, setBox] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!target) { setBox(null); return; }
    findTarget(target)?.el.scrollIntoView?.({ block: 'nearest' });
    let last = '';
    const measure = () => {
      const r = findTarget(target)?.rect;
      const b = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const key = JSON.stringify(b);
      if (key !== last) { last = key; setBox(b); }
    };
    measure();
    const t = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [target, index]);
  return box;
}
