export type ScheduledAction = {
  operationalAt: string;
  priority: number;
  dependencyOrder: number;
  sequence: number;
};

export function orderActions<T extends ScheduledAction>(actions: readonly T[]): T[] {
  return actions.map((action, index) => ({ action, index })).sort((left, right) => (
    left.action.operationalAt.localeCompare(right.action.operationalAt)
    || left.action.priority - right.action.priority
    || left.action.dependencyOrder - right.action.dependencyOrder
    || left.action.sequence - right.action.sequence
    || left.index - right.index
  )).map(({ action }) => action);
}
