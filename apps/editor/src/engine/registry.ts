/** Реестр картографических движков. Новый движок — новая запись. */
import type { EngineFactory } from './types';
import { createMapLibreEngine } from './maplibre';

export const ENGINES: Record<string, { name: string; create: EngineFactory }> = {
  maplibre: { name: 'MapLibre GL', create: createMapLibreEngine },
};

export const DEFAULT_ENGINE = 'maplibre';
