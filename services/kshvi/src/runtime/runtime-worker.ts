import { orderActions, type ScheduledAction } from '@def-ops/kshvi';

export class RuntimeWorker {
  next<T extends ScheduledAction>(actions: readonly T[]): T[] {
    return orderActions(actions);
  }
}
