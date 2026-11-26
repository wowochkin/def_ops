import type { SymbolDefinition } from '@def-ops/tactical-symbols';

export type ScenarioSide = Readonly<{
  id: string;
  name: string;
  country?: string | null;
  color: 'red' | 'blue';
}>;

export function defaultScenarioSides(): readonly ScenarioSide[] {
  return [
    { id: 'red', name: 'Красные', country: null, color: 'red' },
    { id: 'blue', name: 'Синие', country: null, color: 'blue' },
  ];
}

function redChannel(color: string): number | null {
  const value = color.trim();
  if (value === 'red') return 255;
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) return Number.parseInt(short[1]![0]!, 16) * 17;
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  if (full) return Number.parseInt(full[1]!.slice(0, 2), 16);
  return null;
}

function greenBlueChannels(color: string): readonly [number, number] | null {
  const value = color.trim();
  if (value === 'red') return [0, 0];
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) return [Number.parseInt(short[1]![1]!, 16) * 17, Number.parseInt(short[1]![2]!, 16) * 17];
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  if (full) return [Number.parseInt(full[1]!.slice(2, 4), 16), Number.parseInt(full[1]!.slice(4, 6), 16)];
  return null;
}

function isRed(color: string): boolean {
  const red = redChannel(color);
  const other = greenBlueChannels(color);
  return red !== null && red >= 150 && other !== null && other.every(value => value <= 100);
}

export function symbolForSide(definition: SymbolDefinition, side?: ScenarioSide): SymbolDefinition {
  return side?.color === 'blue' && isRed(definition.color) ? { ...definition, color: '#1d4ed8' } : definition;
}
