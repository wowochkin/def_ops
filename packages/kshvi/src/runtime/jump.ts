export type JumpTransaction<World> = {
  jumpId: string;
  /** Отделяет идемпотентность разных Instance при одинаковом внешнем jumpId. */
  instanceId?: string;
  targetOperationalAt: string;
  currentOperationalAt?: string;
  world: World;
  /** Общий журнал позволяет восстановить результат после пересоздания исполнителя. */
  journal?: JumpJournal;
  calculate?: (world: World) => Promise<World>;
  approve?: (world: World) => Promise<void>;
  snapshot?: (world: World) => Promise<{ state: World; hash: string }>;
  report?: (step: 'boundary' | 'stop' | 'uncertainty' | 'resume') => Promise<void>;
};

export type JumpResult<World> = Readonly<{ world: World; hash: string }>;

/** Порт durable-журнала: реализация обязана сериализовать один ключ между процессами. */
export interface JumpJournal {
  run<World>(key: string, operation: () => Promise<JumpResult<World>>): Promise<JumpResult<World>>;
}

export class InMemoryJumpJournal implements JumpJournal {
  private readonly completed = new Map<string, JumpResult<unknown>>();
  private readonly running = new Map<string, Promise<JumpResult<unknown>>>();

  async run<World>(key: string, operation: () => Promise<JumpResult<World>>): Promise<JumpResult<World>> {
    const completed = this.completed.get(key);
    if (completed) return completed as JumpResult<World>;
    const running = this.running.get(key);
    if (running) return running as Promise<JumpResult<World>>;
    const promise = operation().then(result => {
      this.completed.set(key, result as JumpResult<unknown>);
      return result;
    }).finally(() => {
      this.running.delete(key);
    });
    this.running.set(key, promise as Promise<JumpResult<unknown>>);
    return promise;
  }

  has(key: string): boolean {
    return this.completed.has(key);
  }
}

const defaultJournal = new InMemoryJumpJournal();

function journalKey(transaction: Pick<JumpTransaction<unknown>, 'jumpId' | 'instanceId'>): string {
  return `${transaction.instanceId ?? 'default'}/${transaction.jumpId}`;
}

export async function executeJump<World>(transaction: JumpTransaction<World>): Promise<JumpResult<World>> {
  const key = journalKey(transaction);
  const journal = transaction.journal ?? defaultJournal;
  return journal.run(key, async () => {
    if (transaction.currentOperationalAt && Date.parse(transaction.targetOperationalAt) < Date.parse(transaction.currentOperationalAt)) throw new Error('Официальное время нельзя перенести назад');
    if (!transaction.calculate || !transaction.approve || !transaction.snapshot || !transaction.report) throw new Error('Скачок требует все обязательные шаги');
    await transaction.report('boundary');
    await transaction.report('stop');
    const calculated = await transaction.calculate(transaction.world);
    await transaction.report('uncertainty');
    await transaction.approve(calculated);
    const snapshot = await transaction.snapshot(calculated);
    await transaction.report('resume');
    return { world: snapshot.state, hash: snapshot.hash };
  });
}

export function jumpApplied(jumpId: string, instanceId?: string): boolean {
  return defaultJournal.has(`${instanceId ?? 'default'}/${jumpId}`);
}
