/**
 * Модель документа тактической карты. Документ — чистый JSON:
 * его можно сохранять, передавать по сети и рендерить где угодно.
 * Все размеры стилей — в пикселях на опорном масштабе документа (refZoom).
 */
import type { LngLat } from './geo';

export type Color = string;

/** Опорная точка градиента вдоль оси знака: t = 0 — хвост, 1 — основание наконечника. */
export interface ColorStop {
  t: number;
  color: Color;
  opacity: number;
}

export interface StrokeSpec {
  color: Color;
  width: number;
  opacity?: number;
  dash?: number[];
}

/** Украшения на оси стрелки: ромб (танковые соединения), полоса, засечка, «птичка». */
export interface Decoration {
  type: 'diamond' | 'bar' | 'tick' | 'chevron';
  /** Положение вдоль оси, доля длины 0..1 (для bar — начало). */
  at: number;
  /** Для bar — конец отрезка (доля длины). */
  to?: number;
  length: number;
  width: number;
  fill?: Color;
  stroke?: StrokeSpec | null;
  /** Повторять через заданный шаг (доля длины). */
  repeat?: number;
}

export interface ArrowStyle {
  smooth: boolean;
  /** Ширина у хвоста. */
  tailWidth: number;
  /** Ширина у основания наконечника (шейка). */
  neckWidth: number;
  /** Показатель изменения ширины: 1 — линейно, >1 — быстрее сужается у хвоста. */
  taper: number;
  /** Размах «усов» наконечника. */
  headWidth: number;
  /** Длина наконечника от шейки до острия. */
  headLength: number;
  /** На сколько концы «усов» отнесены назад от шейки (стреловидность). */
  barbSweep: number;
  /** Кривизна боковых граней наконечника: 1 — прямые, <1 — выпуклые, >1 — вогнутые. */
  headCurve: number;
  /** Форма хвоста свободной стрелки. */
  tailShape: 'flat' | 'notch' | 'round';
  /** Глубина выреза хвоста (для notch), доля ширины. */
  tailNotch: number;
  /** Заливка тела вдоль оси. */
  fill: ColorStop[];
  /** Цвет наконечника (null — как конец тела). */
  headFill: Color | null;
  headOpacity: number;
  /** Контур вокруг всей стрелки. */
  outline: StrokeSpec | null;
  /** Обводить ли торец хвоста (у атласных стрелок хвост открыт). */
  outlineTail: boolean;
  /** Осевая линия внутри тела. */
  centerLine: StrokeSpec | null;
  /** Объёмный блик по оси (эффект «трубки»). */
  highlight: { color: Color; opacity: number; widthRatio: number } | null;
  decorations: Decoration[];
  /** На сколько хвост заходит за линию фронта при привязке (прячется под линию). */
  anchorOverlap: number;
}

/** Слой штриха линии. Линия фронта/рубежа — набор параллельных слоёв. */
export interface StrokeLayer {
  /** Смещение от оси: > 0 — влево по ходу линии. */
  offset: number;
  width: number;
  color: Color;
  opacity: number;
  dash?: number[];
  cap?: 'butt' | 'round' | 'square';
  /** Зубцы (засечки) — обозначение укреплений, обороны. */
  ticks?: {
    spacing: number;
    length: number;
    width: number;
    /** 1 — влево по ходу линии, -1 — вправо, 0 — в обе стороны (ж/д). */
    side: 1 | -1 | 0;
    color?: Color;
    /** Наклон зубца от перпендикуляра, градусы. */
    angle?: number;
    /** Форма: штрих или треугольник. */
    shape?: 'line' | 'triangle';
  };
  /** Засечки на концах линии (положение подразделения на рубеже). */
  endTicks?: { length: number; width: number; side: 1 | -1 };
}

export interface LineStyle {
  smooth: boolean;
  layers: StrokeLayer[];
}

export interface AreaStyle {
  smooth: boolean;
  fill: Color | null;
  fillOpacity: number;
  hatch: { color: Color; width: number; spacing: number; angle: number; opacity: number } | null;
  /** Контур — те же слои, что у линий (зубцы, двойные линии и т.д.). */
  edge: StrokeLayer[];
  /** Крест «уничтожено». */
  cross: { color: Color; width: number; opacity: number; angle: number; spread: number; extend: number } | null;
}

export type SymbolType =
  | 'settlement'
  | 'town'
  | 'tankArmy'
  | 'cavalryCorps'
  | 'armyOval'
  | 'reserve'
  | 'fortifiedCity'
  | 'aviation'
  | 'victoryFlag'
  | 'pennant'
  | 'dateBox'
  | 'meeting';

export interface SymbolStyle {
  type: SymbolType;
  size: number;
  color: Color;
  fill: Color;
  /** Для овалов: соотношение высоты к ширине. */
  aspect: number;
  strokeWidth: number;
  text?: string;
  textStyle?: TextStyle;
}

export interface TextStyle {
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  color: Color;
  halo: { color: Color; width: number } | null;
  letterSpacing: number;
  uppercase: boolean;
  align: 'start' | 'middle' | 'end';
  lineHeight: number;
}

interface FeatureBase {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Имя пресета, из которого создан объект. */
  preset?: string;
  /** Коэффициент масштаба знака относительно пресета (зависит от зума при создании). */
  scale?: number;
}

/** Привязка хвоста стрелки к линии/контуру: t — доля длины линии. */
export interface Anchor {
  featureId: string;
  t: number;
}

export interface ArrowFeature extends FeatureBase {
  kind: 'arrow';
  points: LngLat[];
  anchor?: Anchor | null;
  style: ArrowStyle;
}

export interface LineFeature extends FeatureBase {
  kind: 'line';
  points: LngLat[];
  closed?: boolean;
  style: LineStyle;
}

export interface AreaFeature extends FeatureBase {
  kind: 'area';
  points: LngLat[];
  style: AreaStyle;
}

export interface SymbolFeature extends FeatureBase {
  kind: 'symbol';
  at: LngLat;
  rotation: number;
  style: SymbolStyle;
}

export interface LabelFeature extends FeatureBase {
  kind: 'label';
  at: LngLat;
  text: string;
  rotation: number;
  /** Надпись вдоль кривой (если задана — at игнорируется). */
  path?: LngLat[] | null;
  style: TextStyle;
}

export type Feature = ArrowFeature | LineFeature | AreaFeature | SymbolFeature | LabelFeature;
export type FeatureKind = Feature['kind'];

/** Растровая подложка с привязкой по углам (например, скан исторической карты). */
export interface ImageOverlay {
  id: string;
  name: string;
  url: string;
  /** Углы: верх-лево, верх-право, низ-право, низ-лево. */
  corners: [LngLat, LngLat, LngLat, LngLat];
  opacity: number;
  visible: boolean;
}

export interface MapDocument {
  version: 1;
  name: string;
  refZoom: number;
  origin: LngLat;
  /** Цвет «бумаги», если подложка выключена. */
  paper: Color;
  view?: { center: LngLat; zoom: number; bearing: number };
  features: Feature[];
  overlays: ImageOverlay[];
}

let counter = 0;
export function newId(prefix = 'f'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyDocument(center: LngLat = [14.0, 52.5], zoom = 7.5): MapDocument {
  return {
    version: 1,
    name: 'Новая карта',
    refZoom: zoom,
    origin: center,
    paper: '#f8f0d0',
    view: { center, zoom, bearing: 0 },
    features: [],
    overlays: [],
  };
}
