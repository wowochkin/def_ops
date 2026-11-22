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

  private assertOfficial(actor: ReplayActor): void {
    if (actor.organizationId !== this.officialLine.organizationId
      || !this.officialLine.rights.every(right => actor.authorities.includes(right))) {
      throw new Error('403: Официальная линия недоступна');
    }
  }

  private assertBranch(branch: Branch, actor: ReplayActor, write = false): void {
    if (branch.organizationId !== actor.organizationId) throw new Error('403: Другая организация ветви');
    const own = branch.ownerId === actor.userId;
    const any = actor.authorities.includes(write ? 'BRANCH_WRITE_ANY' : 'BRANCH_READ_ANY');
    if (!own && !any) throw new Error('403: Чужой исследовательский контур');
    if (!branch.rights.every(right => actor.authorities.includes(right))) throw new Error('403: Нет права чтения ветви');
    if (write && !actor.authorities.includes('BRANCH_WRITE') && !any) throw new Error('403: Нет права изменения ветви');
  }

  private internalBranch(branchId: string, actor: ReplayActor, write = false): Branch {
    const branch = this.branches.get(branchId);
    if (!branch) throw new Error('Альтернативная ветвь не найдена');
    this.assertBranch(branch, actor, write);
    return branch;
  }

  official(actor: ReplayActor): Branch {
    this.assertOfficial(actor);
    return structuredClone(this.officialLine);
  }

  createBranch(branchId: string, actor: ReplayActor): Branch {
    this.assertOfficial(actor);
    if (!actor.authorities.includes('BRANCH_CREATE')) throw new Error('403: Нет права создания ветви');
    if (this.branches.has(branchId)) throw new Error(`Ветвь ${branchId} уже существует`);
    const branch = createBranch(this.officialLine, { branchId });
    branch.ownerId = actor.userId;
    branch.rights = ['BRANCH_READ'];
    this.branches.set(branchId, branch);
    return structuredClone(branch);
  }

  branch(branchId: string, actor: ReplayActor): Branch {
    return structuredClone(this.internalBranch(branchId, actor));
  }

  applyDecision(branchId: string, decision: BranchDecisionInput, actor: ReplayActor): Branch {
    const changed = applyBranchDecision(this.internalBranch(branchId, actor, true), decision);
    this.branches.set(branchId, changed);
    return structuredClone(changed);
  }

  publish(branchId: string, actor: ReplayActor): never {
    return publishBranch(this.internalBranch(branchId, actor));
  }

  adopt(branchId: string, actor: ReplayActor, rationale: string): Branch {
    this.assertOfficial(actor);
    const changed = adoptBranchDecision(this.officialLine, this.internalBranch(branchId, actor), actor, rationale);
    this.officialLine = changed;
    return structuredClone(changed);
  }
}
