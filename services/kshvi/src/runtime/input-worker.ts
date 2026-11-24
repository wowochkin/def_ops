import { evaluateTrigger, type TriggerCondition } from '@def-ops/kshvi';

export class InputWorker {
  evaluate(condition: TriggerCondition) {
    return evaluateTrigger(condition);
  }
}
