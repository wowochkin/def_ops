export type SymbolStatus = 'IMPORTED' | 'MAPPED' | 'VERIFIED' | 'APPROVED' | 'DEPRECATED';
export type SymbolKind = 'POINT' | 'LINE' | 'AREA';
export type SymbolFrame = 'RECTANGLE' | 'DIAMOND' | 'CIRCLE' | 'ELLIPSE' | 'NONE';
export type SymbolAffiliation = 'FRIENDLY' | 'HOSTILE' | 'NEUTRAL' | 'UNKNOWN';
export type SymbolAnchor = readonly [number, number];
export type SymbolLabelValue = string | number | null;
export type SymbolLabels = Readonly<Record<string, SymbolLabelValue>>;

export type GeometryTemplate =
  | 'UNIT' | 'COMMAND_POST' | 'MOVEMENT' | 'EVACUATION' | 'BOUNDARY' | 'DIRECTION'
  | 'AREA' | 'OBSTACLE' | 'DESTROYED_BRIDGE' | 'FLOODING' | 'FORD' | 'FERRY'
  | 'PONTOON' | 'BRIDGE' | 'ICE_CROSSING' | 'WAREHOUSE' | 'BASE' | 'REFUEL'
  | 'SERVICE' | 'REPAIR' | 'SOURCE_VECTOR';

export type GeometryParameter = string | number | boolean;

export interface VectorGeometry {
  readonly version: number;
  readonly template: GeometryTemplate;
  readonly parameters: Readonly<Record<string, GeometryParameter>>;
}

export type VectorPrimitive =
  | Readonly<{ type: 'path'; d: string; strokeWidth?: number; dash?: readonly number[]; fill?: string; fillOpacity?: number }>
  | Readonly<{ type: 'rect'; x: number; y: number; width: number; height: number; strokeWidth?: number; fill?: string; fillOpacity?: number }>
  | Readonly<{ type: 'circle'; cx: number; cy: number; r: number; strokeWidth?: number; fill?: string; fillOpacity?: number }>
  | Readonly<{ type: 'polygon'; points: readonly (readonly [number, number])[]; strokeWidth?: number; fill?: string; fillOpacity?: number }>
  | Readonly<{ type: 'polyline'; points: readonly (readonly [number, number])[]; strokeWidth?: number; dash?: readonly number[]; fill?: string }>
  | Readonly<{ type: 'text'; x: number; y: number; text: string; fontSize?: number; textAnchor?: 'start' | 'middle' | 'end' }>;

export interface SymbolModifier {
  readonly id: string;
  readonly kind: 'ECHELON' | 'TASK' | 'CONDITION' | 'EQUIPMENT' | 'GRAPHIC_INDEX';
  readonly value: string;
  readonly position?: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'CENTER' | 'BASE';
  readonly incompatibleWith?: readonly string[];
}

export interface SymbolLabelLayout {
  readonly x: number;
  readonly y: number;
  readonly textAnchor?: 'start' | 'middle' | 'end';
  readonly fontSize?: number;
}

export interface SymbolSourceBinding {
  readonly sourceDocument: string;
  readonly page: number | null;
  readonly symbolNumber: string | null;
  readonly variant?: number | null;
  readonly fragmentId: string;
  readonly ruleText: string | null;
  readonly referenceFragment: Readonly<{
    format: 'JPEG';
    path: string;
    sha256: string;
  }>;
  readonly gaps: readonly string[];
}

export interface SourceInscription {
  readonly id: string;
  readonly text: string;
  readonly elements: readonly number[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly fill: string;
  readonly fontFamily?: string;
  readonly fontWeight?: string;
  readonly fontStyle?: string;
}

export interface SymbolDefinition {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly code: string;
  readonly purpose: string;
  readonly kind: SymbolKind;
  readonly frame: SymbolFrame;
  readonly affiliation: SymbolAffiliation;
  readonly forceType: string;
  readonly objectType: string;
  readonly organizationalLevel: string | null;
  readonly modifiers: readonly SymbolModifier[];
  readonly allowedModifierIds: readonly string[];
  readonly labels: SymbolLabels;
  readonly inscriptions?: readonly SourceInscription[];
  readonly labelLayout: Readonly<Record<string, SymbolLabelLayout>>;
  readonly color: string;
  readonly anchor: SymbolAnchor;
  readonly scaling: Readonly<{
    minPx: number;
    maxPx: number;
    simplifyBelowZoom: number;
  }>;
  readonly geometry: VectorGeometry;
  readonly status: SymbolStatus;
  readonly source: SymbolSourceBinding;
  readonly deprecationReason?: string;
  readonly replacementId?: string;
}

export interface RenderSymbolInput {
  readonly id: string;
  readonly frame: SymbolFrame;
  readonly anchor: SymbolAnchor;
  readonly modifiers: readonly SymbolModifier[];
  readonly labels: SymbolLabels;
  readonly inscriptions?: readonly SourceInscription[];
  readonly version?: string;
  readonly name?: string;
  readonly kind?: SymbolKind;
  readonly affiliation?: SymbolAffiliation;
  readonly objectType?: string;
  readonly color?: string;
  readonly status?: SymbolStatus;
  readonly geometry?: VectorGeometry;
  readonly scaling?: SymbolDefinition['scaling'];
  readonly labelLayout?: Readonly<Record<string, SymbolLabelLayout>>;
  readonly allowedModifierIds?: readonly string[];
}

export interface SymbolSet {
  readonly id: string;
  readonly version: string;
  readonly status: 'DRAFT' | 'APPROVED';
  readonly symbols: readonly SymbolDefinition[];
  readonly gaps: readonly string[];
}

export type SymbolDefinitionInput = Omit<SymbolDefinition, 'source'> & Readonly<{
  source: Omit<SymbolSourceBinding, 'referenceFragment'>;
}>;
export type SymbolSetInput = Omit<SymbolSet, 'symbols'> & Readonly<{
  symbols: readonly SymbolDefinitionInput[];
}>;

export interface SymbolUsage {
  readonly symbolId: string;
  readonly symbolVersion: string;
  readonly setVersion: string;
  readonly geometryVersion: number;
}

export interface CrossingParameters {
  readonly kind: 'FORD' | 'FERRY' | 'PONTOON' | 'BRIDGE' | 'ICE';
  readonly lengthM?: number | null;
  readonly widthM?: number | null;
  readonly capacityTonnes?: number | null;
  readonly depthM?: number | null;
  readonly bottom?: string | null;
  readonly currentMps?: number | null;
  readonly state?: string | null;
  readonly throughputPerHour?: number | null;
}

export interface RoadParameters {
  readonly lengthM?: number | null;
  readonly widthM?: number | null;
  readonly surface?: string | null;
  readonly state?: string | null;
  readonly throughputPerHour?: number | null;
}

export interface LabelUnitPreferences {
  readonly length?: 'm' | 'km';
  readonly current?: 'm/s' | 'km/h';
}

export function approveSymbol<T extends { readonly status: SymbolStatus }>(symbol: T): Omit<T, 'status'> & { readonly status: 'APPROVED' } {
  if (symbol.status !== 'VERIFIED') throw new Error('Перед APPROVED требуется VERIFIED');
  return { ...symbol, status: 'APPROVED' };
}

export interface VerificationEvidence {
  readonly visualCheck: boolean;
  readonly semanticCheck: boolean;
}

export function transitionSymbol<T extends { readonly status: SymbolStatus }>(
  symbol: T,
  target: Exclude<SymbolStatus, 'DEPRECATED'>,
  evidence?: VerificationEvidence,
): Omit<T, 'status'> & { readonly status: typeof target } {
  if (target === 'VERIFIED' && symbol.status === 'IMPORTED') throw new Error('Перед VERIFIED требуется MAPPED');
  if (target === 'APPROVED') return approveSymbol(symbol) as Omit<T, 'status'> & { readonly status: typeof target };
  const expected: Partial<Record<SymbolStatus, SymbolStatus>> = {
    IMPORTED: 'MAPPED',
    MAPPED: 'VERIFIED',
    VERIFIED: 'APPROVED',
  };
  if (expected[symbol.status] !== target) {
    throw new Error(`Недопустимый переход статуса ${symbol.status} → ${target}`);
  }
  if (target === 'VERIFIED' && (!evidence?.visualCheck || !evidence.semanticCheck)) {
    throw new Error('Для VERIFIED нужны визуальная и смысловая сверка');
  }
  return { ...symbol, status: target };
}

export function deprecateSymbol<T extends { readonly status: SymbolStatus }>(
  symbol: T,
  change: { readonly reason: string; readonly replacementId: string },
): Omit<T, 'status'> & { readonly status: 'DEPRECATED'; readonly deprecationReason: string; readonly replacementId: string } {
  if (!change.reason.trim()) throw new Error('Для DEPRECATED требуется основание');
  if (!change.replacementId.trim()) throw new Error('Для DEPRECATED требуется замена');
  return {
    ...symbol,
    status: 'DEPRECATED',
    deprecationReason: change.reason.trim(),
    replacementId: change.replacementId.trim(),
  };
}
