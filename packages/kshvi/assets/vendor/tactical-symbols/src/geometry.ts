import type {
  CrossingParameters,
  LabelUnitPreferences,
  RenderSymbolInput,
  RoadParameters,
  VectorGeometry,
  VectorPrimitive,
} from './model';

export interface SymbolSize {
  readonly width: number;
  readonly height: number;
}

export function anchorPixels(symbol: Pick<RenderSymbolInput, 'anchor'>, size: SymbolSize): [number, number] {
  validateSizeAndAnchor(symbol, size);
  return [symbol.anchor[0] * size.width, symbol.anchor[1] * size.height];
}

export function anchorOffset(symbol: Pick<RenderSymbolInput, 'anchor'>, size: SymbolSize): [number, number] {
  validateSizeAndAnchor(symbol, size);
  return [(0.5 - symbol.anchor[0]) * size.width, (0.5 - symbol.anchor[1]) * size.height];
}

function validateSizeAndAnchor(symbol: Pick<RenderSymbolInput, 'anchor'>, size: SymbolSize): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error('Размеры знака должны быть положительными конечными числами');
  }
  if (!symbol.anchor.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Точка привязки знака должна быть в диапазоне [0; 1]');
  }
}

export function simplifySymbol<T extends RenderSymbolInput>(symbol: T): T {
  return { ...symbol, modifiers: [], labels: {} } as T;
}

export function validateModifiers(symbol: RenderSymbolInput): void {
  const active = new Set(symbol.modifiers.map(modifier => modifier.id));
  if (active.size !== symbol.modifiers.length) throw new Error('Идентификаторы модификаторов должны быть уникальны');
  for (const modifier of symbol.modifiers) {
    if (symbol.allowedModifierIds && symbol.allowedModifierIds.length > 0 && !symbol.allowedModifierIds.includes(modifier.id)) {
      throw new Error(`Недопустимый модификатор ${modifier.id} для знака ${symbol.id}`);
    }
    for (const incompatibleId of modifier.incompatibleWith ?? []) {
      if (active.has(incompatibleId)) throw new Error(`Модификаторы ${modifier.id} и ${incompatibleId} несовместимы`);
    }
  }
}

function formattedNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Числовой параметр подписи должен быть конечным');
  return String(Math.round((value + Number.EPSILON) * 100) / 100).replace('.', ',');
}

function measurement(value: number | null | undefined, scale: number, unit: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new Error('Параметры длины, массы и пропускной способности не могут быть отрицательными');
  return `${formattedNumber(value * scale)} ${unit}`;
}

function textValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function lengthPreference(preferences: LabelUnitPreferences): { scale: number; unit: string } {
  return preferences.length === 'km' ? { scale: 0.001, unit: 'км' } : { scale: 1, unit: 'м' };
}

export type CrossingLabelKey = 'length' | 'width' | 'capacity' | 'depth' | 'bottom' | 'current' | 'state' | 'throughput';

export function formatCrossingLabels(
  parameters: CrossingParameters,
  preferences: LabelUnitPreferences = {},
): Partial<Record<CrossingLabelKey, string>> {
  const length = lengthPreference(preferences);
  const current = preferences.current === 'km/h'
    ? measurement(parameters.currentMps, 3.6, 'км/ч')
    : measurement(parameters.currentMps, 1, 'м/с');
  return Object.fromEntries(Object.entries({
    length: measurement(parameters.lengthM, length.scale, length.unit),
    width: measurement(parameters.widthM, 1, 'м'),
    capacity: measurement(parameters.capacityTonnes, 1, 'т'),
    depth: measurement(parameters.depthM, 1, 'м'),
    bottom: textValue(parameters.bottom),
    current,
    state: textValue(parameters.state),
    throughput: measurement(parameters.throughputPerHour, 1, 'ед./ч'),
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function formatRoadLabels(
  parameters: RoadParameters,
  preferences: LabelUnitPreferences = {},
): Partial<Record<'length' | 'width' | 'surface' | 'state' | 'throughput', string>> {
  const length = lengthPreference(preferences);
  return Object.fromEntries(Object.entries({
    length: measurement(parameters.lengthM, length.scale, length.unit),
    width: measurement(parameters.widthM, 1, 'м'),
    surface: textValue(parameters.surface),
    state: textValue(parameters.state),
    throughput: measurement(parameters.throughputPerHour, 1, 'ед./ч'),
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

const banks = 'M8 25 H28 M72 25 H92 M8 75 H28 M72 75 H92';
const water = 'M5 40 C15 32 25 48 35 40 C45 32 55 48 65 40 C75 32 85 48 95 40 M5 65 C15 57 25 73 35 65 C45 57 55 73 65 65 C75 57 85 73 95 65';

export function geometryPrimitives(geometry: VectorGeometry): readonly VectorPrimitive[] {
  const parameters = geometry.parameters;
  switch (geometry.template) {
    case 'COMMAND_POST':
      return [
        { type: 'polyline', points: [[30, 88], [30, 18], [72, 18], [72, 44], [30, 44]], strokeWidth: 4 },
        { type: 'circle', cx: 30, cy: 88, r: 4, fill: 'currentColor' },
      ];
    case 'MOVEMENT':
      return [{ type: 'path', d: 'M12 68 H78 M62 50 L82 68 L62 86 M18 78 H48', strokeWidth: 4 }];
    case 'EVACUATION':
      return [
        { type: 'path', d: 'M12 58 H78 M62 40 L82 58 L62 76', strokeWidth: 4 },
        { type: 'path', d: 'M18 76 H58', strokeWidth: 2, dash: [5, 4] },
      ];
    case 'BOUNDARY':
      return [{ type: 'path', d: 'M8 50 H92 M22 36 V64 M42 36 V64 M62 36 V64 M82 36 V64', strokeWidth: 3, dash: [10, 4, 2, 4] }];
    case 'DIRECTION':
      return [{ type: 'path', d: 'M10 75 C30 65 45 45 62 28 M45 28 H66 V49', strokeWidth: 5 }];
    case 'AREA':
      return [{ type: 'polygon', points: [[14, 28], [76, 14], [90, 68], [62, 88], [18, 76]], strokeWidth: 3, fill: 'currentColor', fillOpacity: 0.08 }];
    case 'OBSTACLE':
      return [{ type: 'path', d: 'M8 68 L22 32 L38 68 L54 32 L70 68 L86 32', strokeWidth: 4 }];
    case 'DESTROYED_BRIDGE':
      return [
        { type: 'path', d: banks, strokeWidth: 4 },
        { type: 'path', d: 'M25 43 H43 L52 58 L62 43 H77 M25 60 H40 M64 60 H77', strokeWidth: 4 },
        { type: 'path', d: 'M40 28 L62 74 M62 28 L40 74', strokeWidth: 3 },
      ];
    case 'FLOODING':
      return [
        { type: 'path', d: water, strokeWidth: 3 },
        { type: 'path', d: 'M50 18 V78 M38 32 L50 18 L62 32', strokeWidth: 3 },
      ];
    case 'FORD':
      return [
        { type: 'path', d: `${banks} ${water}`, strokeWidth: 3 },
        { type: 'path', d: 'M24 30 L76 72 M24 72 L76 30', strokeWidth: 3, dash: [6, 4] },
      ];
    case 'FERRY':
      return [
        { type: 'path', d: `${banks} ${water}`, strokeWidth: 3 },
        { type: 'polygon', points: [[28, 48], [72, 48], [64, 65], [36, 65]], strokeWidth: 3, fill: 'white' },
        { type: 'path', d: 'M20 57 H80', strokeWidth: 2, dash: [5, 4] },
      ];
    case 'PONTOON': {
      const requested = Number(parameters.spans ?? 3);
      const spans = Number.isFinite(requested) ? Math.max(1, Math.min(8, Math.round(requested))) : 3;
      const segmentWidth = 56 / spans;
      return [
        { type: 'path', d: `${banks} ${water}`, strokeWidth: 3 },
        ...Array.from({ length: spans }, (_, index): VectorPrimitive => ({
          type: 'rect', x: 22 + index * segmentWidth, y: 45, width: segmentWidth - 1, height: 15,
          strokeWidth: 2, fill: 'white',
        })),
        { type: 'path', d: 'M20 52 H80', strokeWidth: 3 },
      ];
    }
    case 'BRIDGE':
      return [
        { type: 'path', d: banks, strokeWidth: 4 },
        { type: 'rect', x: 22, y: 43, width: 56, height: 18, strokeWidth: 3, fill: 'white' },
        { type: 'path', d: 'M28 61 L40 43 L52 61 L64 43 L74 61', strokeWidth: 2 },
      ];
    case 'ICE_CROSSING':
      return [
        { type: 'path', d: banks, strokeWidth: 4 },
        { type: 'path', d: 'M22 52 H80', strokeWidth: 4, dash: [8, 4] },
        { type: 'path', d: 'M50 28 V76 M32 40 L68 64 M32 64 L68 40', strokeWidth: 2 },
      ];
    case 'WAREHOUSE':
      return [
        { type: 'polygon', points: [[18, 43], [50, 20], [82, 43]], strokeWidth: 3, fill: 'white' },
        { type: 'rect', x: 23, y: 43, width: 54, height: 37, strokeWidth: 3, fill: 'white' },
        { type: 'path', d: 'M34 80 V55 H66 V80 M34 64 H66', strokeWidth: 2 },
      ];
    case 'BASE':
      return [
        { type: 'rect', x: 18, y: 25, width: 64, height: 54, strokeWidth: 3, fill: 'white' },
        { type: 'path', d: 'M18 40 H82 M32 25 V79 M68 25 V79 M26 66 H74', strokeWidth: 2 },
      ];
    case 'REFUEL':
      return [
        { type: 'rect', x: 25, y: 20, width: 35, height: 60, strokeWidth: 3, fill: 'white' },
        { type: 'rect', x: 31, y: 27, width: 23, height: 17, strokeWidth: 2 },
        { type: 'path', d: 'M60 32 H70 L78 48 V72 C78 82 64 82 64 72 V56 M20 80 H66', strokeWidth: 3 },
      ];
    case 'SERVICE':
      return [
        { type: 'circle', cx: 50, cy: 52, r: 28, strokeWidth: 3, fill: 'white' },
        { type: 'circle', cx: 50, cy: 52, r: 9, strokeWidth: 3 },
        { type: 'path', d: 'M50 16 V30 M50 74 V88 M14 52 H28 M72 52 H86 M25 27 L35 37 M65 67 L75 77 M25 77 L35 67 M65 37 L75 27', strokeWidth: 3 },
      ];
    case 'REPAIR':
      return [
        { type: 'path', d: 'M25 22 C36 16 48 22 51 33 L76 58 C84 66 76 82 66 76 L41 51 C30 54 20 46 20 35 L34 42 L43 33 Z', strokeWidth: 3, fill: 'white' },
        { type: 'circle', cx: 69, cy: 68, r: 4, strokeWidth: 2 },
      ];
    case 'UNIT':
      return [
        { type: 'path', d: 'M25 25 L75 75 M75 25 L25 75', strokeWidth: 3 },
      ];
  }
}
