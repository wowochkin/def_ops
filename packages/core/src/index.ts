/** Публичный API движка тактических знаков. */
export * from './vec';
export * from './geo';
export * from './curve';
export * from './model';
export * from './presets';
export * from './factory';
export * from './layers';
export * from './geojson';
export { renderDocument, renderFeature, createContext, exportSVG } from './render/index';
export type { RenderResult, RenderedFeature, RenderedLayer, RenderOptions } from './render/index';
export { arrowGeometry, arrowAxisPoints } from './render/arrow';
export { linePath } from './render/line';
