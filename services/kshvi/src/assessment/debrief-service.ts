import { buildDebrief, type DebriefInput, type DebriefPackage } from '../../../../packages/kshvi/src/assessment/debrief';

export class DebriefService {
  build(input: DebriefInput): DebriefPackage {
    return buildDebrief(input);
  }
}
