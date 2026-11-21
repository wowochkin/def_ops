import { geometryPrimitives, simplifySymbol, validateModifiers, type SymbolSize } from './geometry';
import type {
  RenderSymbolInput,
  SymbolAffiliation,
  SymbolFrame,
  SymbolLabelLayout,
  VectorPrimitive,
} from './model';

export interface RenderSymbolOptions extends SymbolSize {
  readonly zoom?: number;
  readonly detail?: 'FULL' | 'SEMANTIC';
}

const affiliationColors: Readonly<Record<SymbolAffiliation, string>> = {
  FRIENDLY: '#1d4ed8',
  HOSTILE: '#b91c1c',
  NEUTRAL: '#15803d',
  UNKNOWN: '#7e22ce',
};

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Геометрия содержит неконечное число');
  return String(Math.round(value * 1000) / 1000);
}

function pointsAttribute(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${number(x)},${number(y)}`).join(' ');
}

function renderPrimitive(primitive: VectorPrimitive): string {
  const common = 'stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  switch (primitive.type) {
    case 'path':
      return `<path d="${escapeXml(primitive.d)}" fill="${primitive.fill ?? 'none'}"${primitive.fillOpacity === undefined ? '' : ` fill-opacity="${number(primitive.fillOpacity)}"`} ${common} stroke-width="${number(primitive.strokeWidth ?? 2)}"${primitive.dash ? ` stroke-dasharray="${primitive.dash.map(number).join(' ')}"` : ''}/>`;
    case 'rect':
      return `<rect x="${number(primitive.x)}" y="${number(primitive.y)}" width="${number(primitive.width)}" height="${number(primitive.height)}" fill="${primitive.fill ?? 'none'}"${primitive.fillOpacity === undefined ? '' : ` fill-opacity="${number(primitive.fillOpacity)}"`} ${common} stroke-width="${number(primitive.strokeWidth ?? 2)}"/>`;
    case 'circle':
      return `<circle cx="${number(primitive.cx)}" cy="${number(primitive.cy)}" r="${number(primitive.r)}" fill="${primitive.fill ?? 'none'}"${primitive.fillOpacity === undefined ? '' : ` fill-opacity="${number(primitive.fillOpacity)}"`} ${common} stroke-width="${number(primitive.strokeWidth ?? 2)}"/>`;
    case 'polygon':
      return `<polygon points="${pointsAttribute(primitive.points)}" fill="${primitive.fill ?? 'none'}"${primitive.fillOpacity === undefined ? '' : ` fill-opacity="${number(primitive.fillOpacity)}"`} ${common} stroke-width="${number(primitive.strokeWidth ?? 2)}"/>`;
    case 'polyline':
      return `<polyline points="${pointsAttribute(primitive.points)}" fill="${primitive.fill ?? 'none'}" ${common} stroke-width="${number(primitive.strokeWidth ?? 2)}"${primitive.dash ? ` stroke-dasharray="${primitive.dash.map(number).join(' ')}"` : ''}/>`;
    case 'text':
      return `<text x="${number(primitive.x)}" y="${number(primitive.y)}" fill="currentColor" font-family="sans-serif" font-size="${number(primitive.fontSize ?? 8)}" text-anchor="${primitive.textAnchor ?? 'middle'}">${escapeXml(primitive.text)}</text>`;
  }
}

function framePrimitive(frame: SymbolFrame): VectorPrimitive | null {
  switch (frame) {
    case 'RECTANGLE': return { type: 'rect', x: 10, y: 10, width: 80, height: 80, strokeWidth: 3, fill: 'currentColor', fillOpacity: 0.06 };
    case 'DIAMOND': return { type: 'polygon', points: [[50, 5], [95, 50], [50, 95], [5, 50]], strokeWidth: 3, fill: 'currentColor', fillOpacity: 0.06 };
    case 'CIRCLE': return { type: 'circle', cx: 50, cy: 50, r: 45, strokeWidth: 3, fill: 'currentColor', fillOpacity: 0.06 };
    case 'ELLIPSE': return { type: 'path', d: 'M95 50 C95 75 75 95 50 95 C25 95 5 75 5 50 C5 25 25 5 50 5 C75 5 95 25 95 50 Z', strokeWidth: 3, fill: 'currentColor', fillOpacity: 0.06 };
    case 'NONE': return null;
  }
}

const defaultLabelLayout: Readonly<Record<string, SymbolLabelLayout>> = {
  top: { x: 50, y: 7, textAnchor: 'middle', fontSize: 8 },
  bottom: { x: 50, y: 98, textAnchor: 'middle', fontSize: 8 },
  left: { x: 2, y: 55, textAnchor: 'start', fontSize: 8 },
  right: { x: 98, y: 55, textAnchor: 'end', fontSize: 8 },
  center: { x: 50, y: 55, textAnchor: 'middle', fontSize: 8 },
};

function modifierLayout(position: NonNullable<RenderSymbolInput['modifiers'][number]['position']> | undefined, index: number): SymbolLabelLayout {
  const offset = index * 7;
  switch (position ?? 'TOP') {
    case 'TOP': return { x: 50, y: 16 + offset, textAnchor: 'middle', fontSize: 7 };
    case 'BOTTOM': return { x: 50, y: 88 - offset, textAnchor: 'middle', fontSize: 7 };
    case 'LEFT': return { x: 4, y: 30 + offset, textAnchor: 'start', fontSize: 7 };
    case 'RIGHT': return { x: 96, y: 30 + offset, textAnchor: 'end', fontSize: 7 };
    case 'CENTER': return { x: 50, y: 48 + offset, textAnchor: 'middle', fontSize: 7 };
    case 'BASE': return { x: 50, y: 84 - offset, textAnchor: 'middle', fontSize: 7 };
  }
}

export function renderSymbol(symbol: RenderSymbolInput, options: RenderSymbolOptions): string {
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height) || options.width <= 0 || options.height <= 0) {
    throw new Error('Размеры SVG должны быть положительными конечными числами');
  }
  if (!symbol.anchor.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Точка привязки должна быть в диапазоне [0; 1]');
  }
  validateModifiers(symbol);
  const detail = options.detail ?? (
    options.zoom !== undefined && symbol.scaling && options.zoom < symbol.scaling.simplifyBelowZoom
      ? 'SEMANTIC'
      : 'FULL'
  );
  const effective = detail === 'SEMANTIC' ? simplifySymbol(symbol) : symbol;
  const geometry = effective.geometry ?? { version: 1, template: 'UNIT' as const, parameters: {} };
  const color = effective.color ?? affiliationColors[effective.affiliation ?? 'UNKNOWN'];
  const frame = framePrimitive(effective.frame);
  const primitives = [...(frame ? [frame] : []), ...geometryPrimitives(geometry)];
  const labels = Object.entries(effective.labels).flatMap(([key, value], index) => {
    if (value === null || value === '') return [];
    const layout = effective.labelLayout?.[key] ?? defaultLabelLayout[key] ?? {
      x: 50, y: 20 + index * 9, textAnchor: 'middle' as const, fontSize: 8,
    };
    return [`<text data-label="${escapeXml(key)}" x="${number(layout.x)}" y="${number(layout.y)}" fill="${color}" font-family="sans-serif" font-size="${number(layout.fontSize ?? 8)}" text-anchor="${layout.textAnchor ?? 'middle'}" stroke="white" stroke-width="0.35" paint-order="stroke">${escapeXml(String(value))}</text>`];
  });
  const modifiers = effective.modifiers.map((modifier, index) => {
    const layout = modifierLayout(modifier.position, index);
    return `<text data-modifier="${escapeXml(modifier.id)}" data-modifier-kind="${modifier.kind}" x="${number(layout.x)}" y="${number(layout.y)}" fill="${color}" font-family="sans-serif" font-size="${number(layout.fontSize ?? 7)}" text-anchor="${layout.textAnchor ?? 'middle'}">${escapeXml(modifier.value)}</text>`;
  });
  const anchorX = effective.anchor[0] * 100;
  const anchorY = effective.anchor[1] * 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(options.width)}" height="${number(options.height)}" viewBox="0 0 100 100" role="img" aria-label="${escapeXml(effective.name ?? effective.id)}" data-symbol-id="${escapeXml(effective.id)}" data-symbol-version="${escapeXml(effective.version ?? '0.0.0')}" data-geometry-version="${geometry.version}" data-status="${effective.status ?? 'IMPORTED'}" data-kind="${effective.kind ?? 'POINT'}" data-affiliation="${effective.affiliation ?? 'UNKNOWN'}" data-object-type="${escapeXml(effective.objectType ?? 'UNKNOWN')}" data-anchor-x="${number(effective.anchor[0])}" data-anchor-y="${number(effective.anchor[1])}" data-detail="${detail}"><g style="color:${color}">${primitives.map(renderPrimitive).join('')}</g>${modifiers.join('')}${labels.join('')}<circle data-anchor="" cx="${number(anchorX)}" cy="${number(anchorY)}" r="0" fill="none" stroke="none"/></svg>`;
}
