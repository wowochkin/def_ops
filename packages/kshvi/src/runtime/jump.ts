export type JumpTransaction<World> = {
  jumpId: string;
  targetOperationalAt: string;
  currentOperationalAt?: string;
  world: World;
  calculate?: (world: World) => Promise<World>;
  approve?: (world: World) => Promise<void>;
  snapshot?: (world: World) => Promise<{ state: World; hash: string }>;
  report?: (step: 'boundary' | 'stop' | 'uncertainty' | 'resume') => Promise<void>;
};
const completed = new Set<string>();

export async function executeJump<World>(transaction: JumpTransaction<World>): Promise<{ world: World; hash: string }> {
  if (completed.has(transaction.jumpId)) throw new Error(`Скачок ${transaction.jumpId} уже применён`);
  if (transaction.currentOperationalAt && Date.parse(transaction.targetOperationalAt) < Date.parse(transaction.currentOperationalAt)) throw new Error('Официальное время нельзя перенести назад');
  if (!transaction.calculate || !transaction.approve || !transaction.snapshot || !transaction.report) throw new Error('Скачок требует все обязательные шаги');
  await transaction.report('boundary');
  await transaction.report('stop');
  const calculated = await transaction.calculate(transaction.world);
  await transaction.report('uncertainty');
  await transaction.approve(calculated);
  const snapshot = await transaction.snapshot(calculated);
  await transaction.report('resume');
  completed.add(transaction.jumpId);
  return { world: snapshot.state, hash: snapshot.hash };
}

export function jumpApplied(jumpId: string): boolean { return completed.has(jumpId); }
