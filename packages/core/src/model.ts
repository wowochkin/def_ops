/**
 * Модель документа тактической карты. Документ — чистый JSON:
 * его можно сохранять, передавать по сети и рендерить где угодно.
 * Все размеры стилей — в пикселях на опорном масштабе документа (refZoom).
 */
import type { LngLat } from './geo';

export type Color = string;

/** Принадлежность знака — по уставу: свои — красным, противник — синим, инженерное/нейтральное — чёрным. */
export type Side = 'own' | 'enemy' | 'neutral';

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
  type: 'diamond' | 'bar' | 'tick' | 'chevron' | 'glyph';
  /** Для type = 'glyph' — имя знака из реестра GLYPHS (самолёт, якорь и т.п.). */
  glyph?: string;
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
    /**
     * Форма зубца: штрих, треугольник (надолбы, клин), крестик (проволочное заграждение),
     * кружок (мины ПТ), точка (мины ПП), полукруг (укреплённый район), «косой крест».
     */
    shape?: 'line' | 'triangle' | 'cross' | 'x' | 'circle' | 'dot' | 'semicircle' | 'slash' | 'chevron';
    /** Для slash — число штрихов (число рядов проволоки). */
    count?: number;
    /** Подогнать шаг под длину линии (зубцы совпадают с изломами ломаной). */
    fit?: boolean;
    /** Рисовать каждый n-й зубец (1 — все). */
    every?: number;
    /** Сдвиг первого зубца, доля шага (0.5 — середины звеньев ломаной). */
    phase?: number;
  };
  /** Вид самой линии: прямая, ломаная «пила», волна, меандр, петли (спираль). */
  pattern?: { type: 'zigzag' | 'wave' | 'square' | 'loops'; amplitude: number; wavelength: number };
  /**
   * Окончания линии: «крюк» (разграничительные линии), загиб к своим (линия
   * соприкосновения), засечка «Т» поперёк (рубежи), точка, стрелка.
   */
  endCaps?: { type: 'hook' | 'bend' | 'bar' | 'dot' | 'arrow'; size: number; side?: 1 | -1; start?: boolean; end?: boolean };
  /** Засечки на концах линии (положение подразделения на рубеже). */
  endTicks?: { length: number; width: number; side: 1 | -1 };
}

/** Надпись вдоль линии (номер соединения у разграничительной линии, «ИР», «РА» на рубежах). */
export interface LineLabel {
  text: string;
  /** Положение вдоль линии 0..1; несколько значений — повтор надписи. */
  at: number[];
  /** Смещение от оси (> 0 — влево по ходу линии). */
  offset: number;
  style: TextStyle;
}

/** Знаки на линии: стрелка атаки посредине рубежа, ромбы огневого рубежа танков и т.п. */
export interface LineMark {
  glyph: string;
  /** Положения вдоль линии 0..1. */
  at: number[];
  size: number;
  color?: Color;
  /** Смещение от оси (> 0 — влево по ходу линии, т.е. к противнику при движении слева направо). */
  offset?: number;
  /** Поворот знака: «к противнику» (по левой нормали) или вдоль линии. */
  orient?: 'normal' | 'tangent';
}

export interface LineStyle {
  smooth: boolean;
  layers: StrokeLayer[];
  labels?: LineLabel[];
  marks?: LineMark[];
}

export interface AreaStyle {
  smooth: boolean;
  fill: Color | null;
  fillOpacity: number;
  /**
   * Узор заливки: штриховка (lines), сетка (cross), точки (dots — мины ПП),
   * кружки (circles — мины ПТ), «болото» (swamp), «лес» (trees).
   */
  hatch: { color: Color; width: number; spacing: number; angle: number; opacity: number; pattern?: 'lines' | 'cross' | 'dots' | 'circles' | 'swamp' | 'trees' } | null;
  /** Контур — те же слои, что у линий (зубцы, двойные линии и т.д.). */
  edge: StrokeLayer[];
  /** Крест «уничтожено». */
  cross: { color: Color; width: number; opacity: number; angle: number; spread: number; extend: number } | null;
}

/**
 * Тип точечного знака. Встроенные: settlement, town, tankArmy, cavalryCorps, armyOval,
 * reserve, fortifiedCity, aviation, victoryFlag, pennant, dateBox, meeting;
 * остальные — из реестра GLYPHS (render/glyphs.ts).
 */
export type SymbolType = string;

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
  /** Слой, в котором лежит объект. */
  layerId: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Имя пресета, из которого создан объект. */
  preset?: string;
  /** Коэффициент масштаба знака относительно пресета (зависит от зума при создании). */
  scale?: number;
  /**
   * Коэффициент зума, при котором знак нарисован (2^(refZoom − z)); от него
   * считается коридор размеров SymbolSizing. Ручное «Масштаб знака» его не меняет.
   * Нет — берётся scale.
   */
  sizeRef?: number;
  /** Принадлежность: свои (красный), противник (синий), нейтральное (чёрный). */
  side?: Side;
  /** Объект реестра, который обозначает знак (например, «150 сд»). Характеристики — в реестре. */
  entityId?: string | null;
  /** Период, когда знак присутствует на карте (без границ — всегда). */
  time?: TimeSpan | null;
  /**
   * Положение знака во времени: с момента t знак имеет указанную геометрию.
   * До первого ключевого кадра действует основная геометрия объекта.
   */
  keyframes?: Keyframe[];
  /** Переход между положениями: плавно (по умолчанию — как задано для карты) или скачком. */
  motion?: Motion;
  /** На каких масштабах знак виден (нет — как у слоя). */
  scales?: ScaleRange | null;
}

/** smooth — положение меняется постепенно между датами; step — скачком в момент кадра. */
export type Motion = 'smooth' | 'step';

/**
 * Момент времени — строка ISO 8601: «1945-04-25» или «1945-04-25T06:00».
 * Без часового пояса трактуется как UTC (исторические даты — без перевода поясов).
 */
export type TimeInstant = string;

/** Период [from, to): from включительно, to — не включительно; null/нет — без границы. */
export interface TimeSpan {
  from?: TimeInstant | null;
  to?: TimeInstant | null;
}

/** Геометрия знака с момента t (заполнены поля, соответствующие виду знака). */
export interface Keyframe {
  t: TimeInstant;
  points?: LngLat[];
  at?: LngLat;
  rotation?: number;
  path?: LngLat[] | null;
  /** Пояснение к положению (например, «к исходу дня»). */
  note?: string;
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

/** Назначение слоя — подсказка редактору и внешним системам (фильтрация, права). */
export type LayerRole = 'base' | 'front' | 'friendly' | 'enemy' | 'labels' | 'custom';

/**
 * Слой карты. Порядок в массиве document.layers — порядок отрисовки (первый — снизу).
 * Слой может прийти из внешней системы (source) — тогда он, как правило, только для чтения.
 */
export interface Layer {
  id: string;
  name: string;
  role: LayerRole;
  visible: boolean;
  locked: boolean;
  /** Прозрачность всего слоя 0..1. */
  opacity: number;
  source?: { system: string; ref?: string; readOnly?: boolean } | null;
  /** Произвольные атрибуты для интеграций (классификация, гриф, владелец и т.п.). */
  meta?: Record<string, unknown>;
  /** На каких масштабах слой виден (нет — на любых). */
  scales?: ScaleRange | null;
}

/**
 * Диапазон масштабов, на которых виден слой или знак, — знаменатели «1 : N».
 * from — самый крупный (подробный) масштаб, to — самый мелкий; любая граница
 * может отсутствовать. Пример: { from: 200_000, to: 2_000_000 } — стрелки
 * фронтов от 1:200 000 до 1:2 000 000, при приближении их сменяют армии.
 */
export interface ScaleRange {
  from?: number | null;
  to?: number | null;
}

/**
 * Размер оформления знаков при изменении масштаба. Геометрия (оси, линии,
 * контуры) всегда привязана к местности; толщины, условные знаки, подписи,
 * ширина стрелок растут и уменьшаются вместе с картой только в пределах
 * [min, max] от размера, с которым знак нарисован, дальше размер на экране
 * постоянный. { min: 0, max: null } — всё по местности; { min: 1, max: 1 } —
 * постоянный экранный размер.
 */
export interface SymbolSizing {
  min: number;
  /** null — без верхнего предела. */
  max: number | null;
}

export const DOCUMENT_VERSION = 2;

export interface MapDocument {
  version: 2;
  /** Идентификатор документа в хранилище (назначается сервисом документов). */
  id?: string;
  /** Ревизия в хранилище — для оптимистичной блокировки при совместной работе. */
  revision?: number;
  name: string;
  refZoom: number;
  origin: LngLat;
  /** Цвет «бумаги», если подложка выключена. */
  paper: Color;
  view?: { center: LngLat; zoom: number; bearing: number };
  layers: Layer[];
  features: Feature[];
  overlays: ImageOverlay[];
  /** Размер знаков при зуме (нет — DEFAULT_SIZING). Экспорт и печать — всегда в размере, с которым нарисовано. */
  sizing?: SymbolSizing | null;
  /** Временная шкала карты: период операции и момент, на который показана обстановка. */
  timeline?: {
    start: TimeInstant;
    end: TimeInstant;
    current?: TimeInstant | null;
    /** Переход между положениями знаков по умолчанию (по умолчанию — плавно). */
    motion?: Motion;
    /** Часовой пояс «местного» времени карты (IANA, например Europe/Berlin); нет — по месту на карте. */
    localZone?: string | null;
  } | null;
}

let counter = 0;
export function newId(prefix = 'f'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Стандартный набор слоёв новой карты (снизу вверх). */
export function defaultLayers(): Layer[] {
  const mk = (id: string, name: string, role: LayerRole): Layer => ({ id, name, role, visible: true, locked: false, opacity: 1 });
  return [
    mk('base', 'Основа: география', 'base'),
    mk('enemy', 'Противник', 'enemy'),
    mk('friendly', 'Свои войска', 'friendly'),
    mk('front', 'Линии фронта и рубежи', 'front'),
    mk('labels', 'Населённые пункты и подписи', 'labels'),
  ];
}

export function emptyDocument(center: LngLat = [14.0, 52.5], zoom = 7.5): MapDocument {
  return {
    version: 2,
    layers: defaultLayers(),
    name: 'Новая карта',
    refZoom: zoom,
    origin: center,
    paper: '#f8f0d0',
    view: { center, zoom, bearing: 0 },
    features: [],
    overlays: [],
  };
}
