export {
  approveSymbol,
  deprecateSymbol,
  transitionSymbol,
} from './model';
export type {
  CrossingParameters,
  GeometryParameter,
  GeometryTemplate,
  LabelUnitPreferences,
  RenderSymbolInput,
  RoadParameters,
  SymbolAffiliation,
  SymbolAnchor,
  SymbolDefinition,
  SymbolDefinitionInput,
  SymbolFrame,
  SymbolKind,
  SymbolLabelLayout,
  SymbolLabels,
  SymbolLabelValue,
  SymbolModifier,
  SymbolSet,
  SymbolSetInput,
  SymbolSourceBinding,
  SymbolStatus,
  SymbolUsage,
  VectorGeometry,
  VectorPrimitive,
  VerificationEvidence,
} from './model';
export {
  anchorOffset,
  anchorPixels,
  formatCrossingLabels,
  formatRoadLabels,
  geometryPrimitives,
  simplifySymbol,
  validateModifiers,
} from './geometry';
export type { CrossingLabelKey, SymbolSize } from './geometry';
export { renderSymbol } from './render-svg';
export type { RenderSymbolOptions } from './render-svg';
export {
  expandSymbolCluster,
  symbolFeatures,
  symbolImages,
  symbolLayers,
  symbolSource,
} from './render-maplibre';
export type {
  SymbolFeature,
  SymbolFeatureCollection,
  SymbolGeoJsonGeometry,
  SymbolInstance,
  SymbolSizeForMap,
} from './render-maplibre';
export {
  assertSymbolsApproved,
  getSymbol,
  pinSymbolUsage,
  symbolLegend,
  symbolSet,
} from './registry';
export type { SymbolLegendEntry } from './registry';
export { coverageReport, sourceRegistry } from './source/registry';
