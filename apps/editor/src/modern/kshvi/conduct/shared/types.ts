export type ConductEvent = {
  id: string;
  title: string;
  operationalAt: string;
  geometry: string;
  document: string;
  calculation: string;
  state: string;
  nodeId?: string;
  cause?: string;
};
export type WorkspaceStatus = 'LOADING' | 'EMPTY' | 'FORBIDDEN' | 'NO_DATA' | 'STALE' | 'PARTIAL_FAILURE' | 'UNAVAILABLE';
export type ConductNotification = {
  id: string;
  groupId: string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  recipient: string;
  dueAt: string;
  text: string;
  acknowledged: boolean;
};
export const defaultConductEvents: readonly ConductEvent[] = [{
  id: 'event-1', title: 'Донесение об исполнении', operationalAt: '2030-01-01T01:40:00Z',
  geometry: '37.62000, 55.70000', document: 'Донесение node-1', calculation: 'calculation-1', state: 'Частичное исполнение', nodeId: 'node-1', cause: 'supply',
}];
export const defaultOperationalAt = '2030-01-01T02:00:00Z';
