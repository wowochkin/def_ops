import { executeJump, type JumpTransaction } from '@def-ops/kshvi';

export class TimeService {
  async jump<World>(transaction: JumpTransaction<World>) {
    return executeJump(transaction);
  }
}
