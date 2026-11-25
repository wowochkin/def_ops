import type { JsonValue, Unknown } from '../model/types';

export type ForceSource = { sourceId: string; reportedAt: string; accuracy?: number; completeness?: number; sourceRevision?: number; sourceSha256?: string };
export type ForceDetails = {
  identity: { sideId: string; nodeId: string; type: string; organizationalLevel: string; service: string; parentId: string | null };
  composition: { personnel: readonly JsonValue[]; units: readonly string[]; equipment: readonly JsonValue[] };
  state: { deployed: boolean; readiness: JsonValue; serviceability: JsonValue; initialCapability: JsonValue; fatigue: JsonValue; training: JsonValue; moralePsych: JsonValue };
  position: { geometry: Unknown<JsonValue>; area: Unknown<JsonValue>; formation: Unknown<JsonValue>; route: Unknown<JsonValue>; movement: Unknown<JsonValue>; task: Unknown<JsonValue> };
  supply: { stocks: readonly JsonValue[]; capacities: readonly JsonValue[]; consumptionNorms: readonly JsonValue[]; nodeIds: readonly string[]; routeIds: readonly string[] };
  capabilities: { actions: readonly string[]; environmentLimits: readonly string[]; reconnaissance: JsonValue; communications: JsonValue; interaction: JsonValue };
  uncertainty: { knownByNodeId: string; reportedAt: string; accuracy: number | null; completeness: number | null };
  source: ForceSource;
};
