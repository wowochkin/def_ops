export type ScheduledAction = {
  operationalAt: string;
  priority: number;
  dependencyOrder: number;
  sequence: number;
};

export function orderActions<T extends ScheduledAction>(actions: readonly T[]): T[] {
  return actions.map((action, index) => {
    const operationalMs = Date.parse(action.operationalAt);
    if (!Number.isFinite(operationalMs)) throw new Error(`Некорректное оперативное время действия ${action.sequence}`);
    return { action, index, operationalMs };
  }).sort((left, right) => (
    left.operationalMs - right.operationalMs
    || left.action.priority - right.action.priority
    || left.action.dependencyOrder - right.action.dependencyOrder
    || left.action.sequence - right.action.sequence
    || left.index - right.index
  )).map(({ action }) => action);
}
