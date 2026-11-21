export const EVENT_UNITS = ['count', 'kg', 'L', 'm', 's', 'm_per_s', 'ratio'] as const;
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

/** Закрытый набор декларативных операций; произвольный код не представим типом. */
export type EventEffect =
  | ResourceAdjustEffect
  | ResourceTransferEffect
  | ForceStateEffect
  | EquipmentStateEffect
  | TerrainStateEffect
  | CommunicationStateEffect;

export const EVENT_EFFECT_TYPES: readonly EventEffect['type'][] = [
  'resource.adjust',
  'resource.transfer',
  'force.state',
  'equipment.state',
  'terrain.state',
  'communication.state',
];
