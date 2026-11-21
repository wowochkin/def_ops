export const EVENT_UNITS = ['count', 'kg', 'L', 'm', 's', 'm_per_s', 'deg', 'ratio'] as const;
export type EventUnit = (typeof EVENT_UNITS)[number];

export type EventAmount = number | { parameterId: string };

export type ResourceAdjustEffect = {
  type: 'resource.adjust';
  resourceId: string;
  ownerSideId: string;
  unit: EventUnit;
  operation: 'CONSUME' | 'RESTORE';
  amount: EventAmount;
};

export type ResourceTransferEffect = {
  type: 'resource.transfer';
  resourceId: string;
  fromSideId: string;
  toSideId: string;
  unit: EventUnit;
  amount: EventAmount;
};

export type ForceStateEffect = {
  type: 'force.state';
  forceId: string;
  status: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
};

export type EquipmentStateEffect = {
  type: 'equipment.state';
  equipmentId: string;
  status: 'OPERATIONAL' | 'DAMAGED' | 'UNDER_REPAIR' | 'LOST';
};

export type TerrainStateEffect = {
  type: 'terrain.state';
  areaId: string;
  status: 'OPEN' | 'RESTRICTED' | 'CLOSED';
};

export type CommunicationStateEffect = {
  type: 'communication.state';
  channelId: string;
  status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
};

export const CATALOG_EFFECT_OPERATIONS = [
  'advanceMedicalEvacuation', 'advanceSupply', 'applyCommunicationFailure', 'applyMoraleImpact',
  'changeFormationState', 'closeRoute', 'consumeResource', 'createApprovalRequest',
  'createCivilContextEvent', 'createDocumentRevision', 'createMedicalProcess', 'createObservation',
  'createScenarioZone', 'delayMovement', 'delaySupply', 'holdFormation', 'markObservationStale',
  'markReportOverdue', 'reconcileInformation', 'recordCommandNodeState', 'recordCoordination',
  'recordInformationState', 'recordInteractionConstraint', 'recordPersonnelChange', 'recordReadinessActivity',
  'recordResourceDeficit', 'recordSafetyConstraint', 'recordScenarioCondition', 'redirectSupply',
  'releaseCapacity', 'requestRepair', 'rerouteMessage', 'rerouteMovement', 'reserveCapacity',
  'restoreRoute', 'reviseObservation', 'scheduleEvacuation', 'scheduleRest', 'transferResource',
  'transitionEquipment', 'updateCrossingState', 'updateInfrastructureState', 'updateMedicalCapacity',
  'updateRepairCapacity', 'updateSupplyNode', 'updateTask', 'updateTerrainState', 'updateWeather',
] as const;
export type CatalogEffectOperation = typeof CATALOG_EFFECT_OPERATIONS[number];
export type CatalogEffect = {
  type: 'catalog.effect';
  operation: CatalogEffectOperation;
  target: { domain: string; ref: string };
  mechanism: string;
  reason: string;
  parameters?: Readonly<Record<string, string | number | boolean | null>>;
};

/** Закрытый набор декларативных операций; произвольный код не представим типом. */
export type EventEffect =
  | ResourceAdjustEffect
  | ResourceTransferEffect
  | ForceStateEffect
  | EquipmentStateEffect
  | TerrainStateEffect
  | CommunicationStateEffect
  | CatalogEffect;

export const EVENT_EFFECT_TYPES: readonly EventEffect['type'][] = [
  'resource.adjust',
  'resource.transfer',
  'force.state',
  'equipment.state',
  'terrain.state',
  'communication.state',
  'catalog.effect',
];
