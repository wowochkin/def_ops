/**
 * Схема-мини-карта стенда (SVG): большие реки, укреплённые полосы, пункты из подложки театра, армии по истории
 * и стрелки решения — для карточек фронтов и приказов. Главная карта сцен — карта полного режима (`StageMap`).
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { historyAt, MAP, projection, type Arrow, type ArmyPos, type LL } from './map';
import type { FrontId } from './settings';

const P = projection(MAP.bbox);
type Box = [number, number, number, number];
const FULL: Box = [0, 0, P.width, P.height];

/** Системная настройка «уменьшить движение»: анимация сразу показывает конечный кадр. */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Рамка вокруг армий фронта и точек `extra` (концы стрелок и путей) с запасом, с пропорцией `aspect` (ширина / высота). */
export function frontBox(front: FrontId, aspect: number, armies: ArmyPos[] = historyAt(MAP.days[0]), extra: LL[] = []): Box {
  const pts = [...armies.filter((a) => a.front === front).map((a) => a.at), ...extra].map((p) => P.xy(p));
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


export interface ExpoMapProps {
  armies: ArmyPos[];
  arrows?: Arrow[];
  /** Кадр — полоса фронта. */
  focus?: FrontId | null;
  /** Точки, которые кадр держит вместе с армиями фронта (концы стрелок). */
  include?: LL[];
  /** Подписи: все, только населённые пункты (`places`) или никаких. */
  labels?: boolean | 'places';
  className?: string;
  label?: string;
}

/** Кегль подписей карты в пикселях холста 1920×1080 (минимум текста стенда). */
const LABEL_PX = 32;
type Rect = [number, number, number, number];
type Anchor = 'start' | 'middle' | 'end';
interface Spot { x: number; y: number; anchor: Anchor }
const hit = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const textRect = ({ x, y, anchor }: Spot, text: string, size: number): Rect => {
  const w = text.length * size * 0.5;
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return [x0, y - size * 0.82, x0 + w, y + size * 0.24];
};

/**
 * Подписи без наложений: по порядку важности каждая берёт первое свободное место из своих вариантов
 * (не на чужом знаке, не на другой подписи, целиком в кадре); места нет — подпись второстепенная и не рисуется.
 */
export function placeLabels(items: { key: string; text: string; size: number; spots: Spot[]; self?: Rect; force?: boolean }[], obstacles: Rect[], view: Rect): Map<string, Spot> {
  const placed: Rect[] = [], out = new Map<string, Spot>();
  const inside = (r: Rect) => r[0] >= view[0] && r[1] >= view[1] && r[2] <= view[2] && r[3] <= view[3];
  for (const it of items) {
    const free = it.spots.find((s) => {
      const r = textRect(s, it.text, it.size);
      return inside(r) && !placed.some((p) => hit(p, r)) && !obstacles.some((o) => o !== it.self && hit(o, r));
    });
    const spot = free ?? (it.force ? it.spots.find((s) => inside(textRect(s, it.text, it.size))) : undefined);
    if (!spot) continue;
    placed.push(textRect(spot, it.text, it.size));
    out.set(it.key, spot);
  }
  return out;
}

/** Знаки армий не налезают друг на друга: пересекающиеся пары раздвигаются по оси наименьшего перекрытия. */
export function spread(pts: LL[], w: number, h: number, rounds = 24): LL[] {
  const p = pts.map(([x, y]): LL => [x, y]);
  for (let r = 0; r < rounds; r++) {
    let moved = false;
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1];
        const ox = w - Math.abs(dx), oy = h - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const d = ((dx >= 0 ? 1 : -1) * ox) / 2;
          p[i][0] -= d;
          p[j][0] += d;
        } else {
          const d = ((dy >= 0 ? 1 : -1) * oy) / 2;
          p[i][1] -= d;
          p[j][1] += d;
        }
      }
    if (!moved) break;
  }
  return p;
}

/** Рамка с пропорцией `aspect`, накрывающая `b` целиком (расширение по недостающей стороне). */
const cover = (b: Box, aspect: number): Box => {
  const [x, y, w, h] = b;
  return w / h < aspect ? [x - (h * aspect - w) / 2, y, h * aspect, h] : [x, y - (w / aspect - h) / 2, w, w / aspect];
};

/** Размер элемента в пикселях холста (без учёта масштаба окна). */
function useSize<T extends Element>(): [React.RefObject<T | null>, [number, number] | null] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setSize((s) => (s && s[0] === w && s[1] === h ? s : [w, h]));
    };
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function ExpoMap({ armies, arrows = [], focus = null, include = [], labels = true, className = '', label = 'Карта операции' }: ExpoMapProps) {
  const [ref, size] = useSize<SVGSVGElement>();
  const [w, h] = size ?? [1600, 900];
  const aspect = w / h;
  const extra = include.map((p) => p.join()).join(';');
  const box = useMemo((): Box => cover(focus ? frontBox(focus, aspect, undefined, include) : FULL, aspect), [focus, aspect, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const font = (box[2] / w) * LABEL_PX;
  const shown = armies;
  const line = (l: LL[]) => l.map((p) => P.xy(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const ownFront = (a: ArmyPos) => (focus ? a.front === focus : a.side === 'su');
  const order = (a: ArmyPos) => (a.side === 'su' ? shown.filter((x) => x.side === 'su').indexOf(a) : 12 + shown.filter((x) => x.side === 'de').indexOf(a));
  const s = font * 0.9;
  const at = new Map(spread(shown.map((a) => P.xy(a.at)), s * 1.55, s * 1.05).map((p, i) => [shown[i].id, p]));
  const xy = (a: ArmyPos) => at.get(a.id) ?? P.xy(a.at);
  const spots = useMemo(() => {
    if (!labels) return new Map<string, Spot>();
    const sym = new Map(shown.map((a) => {
      const [x, y] = xy(a);
      return [a.id, [x - s * 0.7, y - s * 0.45, x + s * 0.7, y + s * 0.45] as Rect];
    }));
    const dots = new Map(MAP.cities.map((c) => {
      const [x, y] = P.xy(c.at), r = c.capital ? font * 0.45 : font * 0.2;
      return [c.name, [x - r, y - r, x + r, y + r] as Rect];
    }));
    const city = (c: (typeof MAP.cities)[number]) => {
      const [x, y] = P.xy(c.at), size = c.capital ? font * 1.2 : font, d = font * 0.5;
      const near = [
        { x: x + d, y: y - d * 0.6, anchor: 'start' as const }, { x: x + d, y: y + size * 0.9, anchor: 'start' as const },
        { x: x - d, y: y - d * 0.6, anchor: 'end' as const }, { x: x - d, y: y + size * 0.9, anchor: 'end' as const },
      ];
      const far = c.capital ? [{ x, y: y - size * 1.4, anchor: 'middle' as const }, { x, y: y + size * 2, anchor: 'middle' as const }, { x: x + d * 3, y: y + size * 0.3, anchor: 'start' as const }, { x: x - d * 3, y: y + size * 0.3, anchor: 'end' as const }] : [];
      return { key: `c-${c.name}`, text: c.name, size, self: dots.get(c.name), force: c.capital, spots: [...near, ...far] };
    };
    const army = (a: ArmyPos) => {
      const [x, y] = xy(a), d = s * 0.6;
      return { key: `a-${a.id}`, text: a.label, size: font, self: sym.get(a.id), spots: [
        { x, y: y + s * 0.45 + font * 0.9, anchor: 'middle' as const }, { x, y: y - s * 0.45 - font * 0.3, anchor: 'middle' as const },
        { x: x + s * 0.7 + d * 0.3, y: y + font * 0.3, anchor: 'start' as const }, { x: x - s * 0.7 - d * 0.3, y: y + font * 0.3, anchor: 'end' as const },
      ] };
    };
    const capital = MAP.cities.filter((c) => c.capital), towns = MAP.cities.filter((c) => !c.capital);
    const own = shown.filter((a) => ownFront(a)).sort((a, b) => Number(/ТА/.test(b.label)) - Number(/ТА/.test(a.label)));
    const armyItems = labels === 'places' ? [] : [...own.map(army), ...shown.filter((a) => a.side === 'de').map(army)];
    const items = [...capital.map(city), ...armyItems, ...towns.map(city)];
    const m = font * 0.2;
    return placeLabels(items, [...sym.values(), ...dots.values()], [box[0] + m, box[1] + m, box[0] + box[2] - m, box[1] + box[3] - m]);
  }, [labels, shown, font, s, box[0], box[1], box[2], box[3], focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg
      ref={ref}
      className={`expo-mapsvg ${className}`}
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
          <stop offset="70%" stopColor="#0f1a18" stopOpacity="0" />
          <stop offset="100%" stopColor="#0f1a18" stopOpacity="0.6" />
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
              </g>
            );
          })}
        </g>
      )}
      <g className="expo-arrows">
        {arrows.map((a, i) => {
          const [x0, y0] = at.get(a.army) ?? P.xy(a.from), [x1, y1] = P.xy(a.to);
          const mx = (x0 + x1) / 2 + (y1 - y0) * 0.15, my = (y0 + y1) / 2 - (x1 - x0) * 0.15;
          return <path key={i} d={`M${x0},${y0} Q${mx},${my} ${x1},${y1}`} markerEnd="url(#expo-head)" style={{ ['--i' as string]: i }} />;
        })}
      </g>
      <g className="expo-armies">
        {shown.map((a) => {
          const [x, y] = xy(a);
          return (
            <g key={a.id} data-side={a.side} data-own={ownFront(a) || undefined} style={{ ['--i' as string]: order(a) }} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
              <rect x={-s * 0.7} y={-s * 0.45} width={s * 1.4} height={s * 0.9} rx={s * 0.08} />
              {a.side === 'su' ? <path d={`M${-s * 0.7},${s * 0.45} L${s * 0.7},${-s * 0.45} M${-s * 0.7},${-s * 0.45} L${s * 0.7},${s * 0.45}`} /> : <path d={`M${-s * 0.7},0 L${s * 0.7},0`} />}
            </g>
          );
        })}
      </g>
      <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill="url(#expo-vignette)" pointerEvents="none" />
      {labels && (
        <g className="expo-labels">
          {MAP.cities.map((c) => {
            const at = spots.get(`c-${c.name}`);
            return (
              at && (
                <text key={c.name} x={at.x} y={at.y} textAnchor={at.anchor} fontSize={c.capital ? font * 1.2 : font} data-capital={c.capital || undefined}>
                  {c.name}
                </text>
              )
            );
          })}
          {shown.map((a) => {
            const at = spots.get(`a-${a.id}`);
            return (
              at && (
                <text key={a.id} x={at.x} y={at.y} textAnchor={at.anchor} fontSize={font} data-army={a.side} data-own={ownFront(a) || undefined} style={{ ['--i' as string]: order(a) }}>
                  {a.label}
                </text>
              )
            );
          })}
        </g>
      )}
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
