import {
  adoptBranchDecision,
  applyBranchDecision,
  createBranch,
  publishBranch,
  type Branch,
  type BranchDecisionInput,
} from '../../../../packages/kshvi/src/replay/branch';
import type { ReplayActor } from '../../../../packages/kshvi/src/replay/types';

export class BranchService {
  private officialLine: Branch;
  private readonly branches = new Map<string, Branch>();

  constructor(official: Branch) {
    this.officialLine = structuredClone(official);
  }

  official(): Branch {
    return structuredClone(this.officialLine);
  }

  createBranch(branchId: string): Branch {
    const branch = createBranch(this.officialLine, { branchId });
    this.branches.set(branchId, branch);
    return structuredClone(branch);
  }

  branch(branchId: string): Branch {
    const branch = this.branches.get(branchId);
    if (!branch) throw new Error('Альтернативная ветвь не найдена');
    return structuredClone(branch);
  }

  applyDecision(branchId: string, decision: BranchDecisionInput): Branch {
    const changed = applyBranchDecision(this.branch(branchId), decision);
    this.branches.set(branchId, changed);
    return structuredClone(changed);
  }

  publish(branchId: string, _actor: ReplayActor): never {
    return publishBranch(this.branch(branchId));
  }

  adopt(branchId: string, actor: ReplayActor, rationale: string): Branch {
    const changed = adoptBranchDecision(this.officialLine, this.branch(branchId), actor, rationale);
    this.officialLine = changed;
    return structuredClone(changed);
  }
}
