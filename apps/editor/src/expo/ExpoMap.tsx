/**
 * Карта стенда (SVG): реки, укреплённые полосы, пункты из подложки театра; армии — по истории или по ходу ядра сеанса;
 * стрелки распоряжений, вспышки событий, путь посетителя поверх исторического. Камера и движение — плавно
 * (`requestAnimationFrame`), при `prefers-reduced-motion` — сразу конечный кадр.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { between, historyAt, MAP, projection, type Arrow, type ArmyPos, type LL } from './map';
import type { FrontId } from './settings';

const P = projection(MAP.bbox);
type Box = [number, number, number, number];
const FULL: Box = [0, 0, P.width, P.height];

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Число от 0 до 1 за `ms` после смены ключа (сразу 1 при ограничении движения). */
export function useProgress(key: unknown, ms: number): number {
  const [t, setT] = useState(() => (reducedMotion() || ms <= 0 ? 1 : 0));
  useEffect(() => {
    if (reducedMotion() || ms <= 0 || typeof requestAnimationFrame !== 'function') return setT(1);
    setT(0);
    const t0 = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const v = Math.min(1, (now - t0) / ms);
      setT(v);
      if (v < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [key, ms]);
  return t;
}

/** Повторяющееся время 0…1 (заставка): круг `ms`, пауза в конце; при ограничении движения — стоит на конце. */
export function useLoop(ms: number, hold = 4000): number {
  const [t, setT] = useState(() => (reducedMotion() ? 1 : 0));
  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') return setT(1);
    const t0 = performance.now();
    let id = 0, last = -1;
    const tick = (now: number) => {
      const v = Math.min(1, ((now - t0) % (ms + hold)) / ms);
      if (Math.abs(v - last) > 0.002) setT((last = v));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [ms, hold]);
  return t;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const mix = (a: Box, b: Box, t: number): Box => a.map((v, i) => v + (b[i] - v) * ease(t)) as Box;

/** Рамка вокруг армий фронта (с запасом), с пропорцией `aspect` (ширина / высота). */
export function frontBox(front: FrontId, aspect: number, armies: ArmyPos[] = historyAt(MAP.days[0])): Box {
  const pts = armies.filter((a) => a.front === front).map((a) => P.xy(a.at));
  const berlin = MAP.cities.find((c) => c.capital);
  if (berlin) pts.push(P.xy(berlin.at));
  if (!pts.length) return FULL;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs) - 80, Math.max(...xs) + 80, Math.min(...ys) - 70, Math.max(...ys) + 70];
  let w = x1 - x0, h = y1 - y0;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  [x0, y0] = [cx - w / 2, cy - h / 2];
  return [x0, y0, w, h];
}

/** Часть общей рамки по ширине (панорама на несколько экранов). */
const slice = (b: Box, part?: { from: number; to: number }): Box => (part ? [b[0] + b[2] * part.from, b[1], b[2] * (part.to - part.from), b[3]] : b);

export interface ExpoMapProps {
  armies: ArmyPos[];
  /** Положения до прокрутки: армии идут от них к `armies` по `progress`. */
  from?: ArmyPos[] | null;
  progress?: number;
  arrows?: Arrow[];
  flashes?: { id: string; title: string; at: LL }[];
  /** Пути армий: посетителя (сплошной) и исторический (пунктир). */
  paths?: { own: Record<string, LL[]>; history?: Record<string, LL[]> };
  /** Камера: от общего плана к полосе фронта за `cameraMs`. */
  focus?: FrontId | null;
  cameraMs?: number;
  /** Порядок появления на вводе в обстановку: армии фронта, противник, рубежи. */
  stagger?: boolean;
  labels?: boolean;
  part?: { from: number; to: number };
  aspect?: number;
  /** Сдвиг камеры влево на долю ширины: место под текст слева, предмет карты — правее. */
  shift?: number;
  /** Во сколько раз крупнее подписи (карта занимает часть экрана — подписи не мельче 32 px). */
  fontScale?: number;
  className?: string;
  label?: string;
}

export function ExpoMap({ armies, from, progress = 1, arrows = [], flashes = [], paths, focus = null, cameraMs = 0, stagger = false, labels = true, part, aspect = 16 / 9, shift = 0, fontScale = 1, className = '', label = 'Карта операции' }: ExpoMapProps) {
  const target = useMemo((): Box => {
    const b = focus ? frontBox(focus, aspect) : FULL;
    return [b[0] - b[2] * shift, b[1], b[2], b[3]];
  }, [focus, aspect, shift]);
  const cam = useProgress(`${focus}-${aspect}-${shift}`, cameraMs);
  const startBox = useRef<Box>(FULL);
  const box = slice(cameraMs > 0 ? mix(startBox.current, target, cam) : target, part);
  const font = box[2] * 0.026 * fontScale;
  const shown = from ? between(from, armies, ease(progress)) : armies;
  const line = (l: LL[]) => l.map((p) => P.xy(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const ownFront = (a: ArmyPos) => (focus ? a.front === focus : a.side === 'su');
  const order = (a: ArmyPos) => (a.side === 'su' ? shown.filter((x) => x.side === 'su').indexOf(a) : 12 + shown.filter((x) => x.side === 'de').indexOf(a));
  return (
    <svg
      className={`expo-mapsvg ${stagger ? 'expo-stagger' : ''} ${className}`}
      viewBox={box.map((v) => v.toFixed(1)).join(' ')}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
    >
      <defs>
        <marker id="expo-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--expo-gold)" />
        </marker>
        <radialGradient id="expo-vignette" cx="50%" cy="50%" r="75%">
          <stop offset="60%" stopColor="#0f1a18" stopOpacity="0" />
          <stop offset="100%" stopColor="#0f1a18" stopOpacity="0.85" />
        </radialGradient>
      </defs>
      <rect x={-P.width} y={-P.height} width={P.width * 3} height={P.height * 3} fill="#14231f" />
      <g className="expo-rivers">
        {MAP.rivers.map((r, i) => (
          <polyline key={i} points={line(r)} />
        ))}
      </g>
      <g className="expo-lines" style={{ ['--i' as string]: 24 }}>
        {MAP.lines.map((l, i) => (
          <polyline key={i} points={line(l.line)} data-side={l.side} />
        ))}
      </g>
      {labels && (
        <g className="expo-cities">
          {MAP.cities.map((c) => {
            const [x, y] = P.xy(c.at);
            return (
              <g key={c.name} data-capital={c.capital || undefined}>
                <circle cx={x} cy={y} r={c.capital ? font * 0.45 : font * 0.2} />
                <text x={x + font * 0.5} y={y - font * 0.35} fontSize={c.capital ? font * 1.25 : font}>
                  {c.name}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {paths && (
        <g className="expo-paths">
          {Object.entries(paths.history ?? {}).map(([id, l]) => (
            <polyline key={`h-${id}`} className="expo-path-history" points={line(l)} />
          ))}
          {Object.entries(paths.own).map(([id, l]) => (
            <polyline key={`o-${id}`} className="expo-path-own" points={line(l)} markerEnd="url(#expo-head)" />
          ))}
        </g>
      )}
      <g className="expo-arrows">
        {arrows.map((a, i) => {
          const [x0, y0] = P.xy(a.from), [x1, y1] = P.xy(a.to);
          const mx = (x0 + x1) / 2 + (y1 - y0) * 0.15, my = (y0 + y1) / 2 - (x1 - x0) * 0.15;
          return <path key={i} d={`M${x0},${y0} Q${mx},${my} ${x1},${y1}`} markerEnd="url(#expo-head)" style={{ ['--i' as string]: i }} />;
        })}
      </g>
      <g className="expo-armies">
        {shown.map((a) => {
          const [x, y] = P.xy(a.at);
          const s = font * 0.9;
          return (
            <g key={a.id} data-side={a.side} data-own={ownFront(a) || undefined} style={{ ['--i' as string]: order(a) }} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
              <rect x={-s * 0.7} y={-s * 0.45} width={s * 1.4} height={s * 0.9} rx={s * 0.08} />
              {a.side === 'su' ? <path d={`M${-s * 0.7},${s * 0.45} L${s * 0.7},${-s * 0.45} M${-s * 0.7},${-s * 0.45} L${s * 0.7},${s * 0.45}`} /> : <path d={`M${-s * 0.7},0 L${s * 0.7},0`} />}
              {labels && (ownFront(a) || a.side === 'de') && (
                <text x={0} y={s * 1.25} fontSize={font * 0.8}>
                  {a.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <g className="expo-flashes">
        {flashes.map((f) => {
          const [x, y] = P.xy(f.at);
          return (
            <g key={f.id} transform={`translate(${x},${y})`}>
              <circle r={font * 1.2} />
              <circle r={font * 0.35} className="expo-flash-core" />
            </g>
          );
        })}
      </g>
      <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill="url(#expo-vignette)" pointerEvents="none" />
    </svg>
  );
}

/** Исторические пути армий фронта (по суткам подложки) — пунктир на итоге. */
export function historyPaths(front: FrontId, until?: string): Record<string, LL[]> {
  const out: Record<string, LL[]> = {};
  for (const a of MAP.armies.filter((x) => x.front === front)) {
    const l = a.track.filter((p, i): p is LL => !!p && (!until || MAP.days[i] <= until));
    if (l.length > 1) out[a.id] = l;
  }
  return out;
}

/** Заставка: ускоренная переигровка операции по истории с бегущей датой. */
export function Replay({ part, children }: { part?: { from: number; to: number }; children?: (date: string) => React.ReactNode }) {
  const t = useLoop(36000);
  const t0 = Date.parse(`${MAP.days[0]}:00Z`), t1 = Date.parse(`${MAP.days[MAP.days.length - 1]}:00Z`);
  const iso = new Date(t0 + (t1 - t0) * t).toISOString().slice(0, 16);
  const armies = historyAt(iso);
  const flashes = MAP.events.filter((e) => e.date <= iso.slice(0, 10) && e.date >= new Date(Date.parse(`${iso}:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10));
  return (
    <>
      <ExpoMap armies={armies} flashes={flashes} part={part} className="expo-backdrop" label="Переигровка Берлинской операции" />
      {children?.(iso)}
    </>
  );
}
