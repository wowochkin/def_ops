import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JumpJournal, JumpResult } from '../../../../packages/kshvi/src/runtime/jump';

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Файловая реализация порта: mkdir атомарен между процессами ОС, результат пишется через rename. */
export class FileJumpJournal implements JumpJournal {
  constructor(private readonly directory: string) {}

  async run<World>(key: string, operation: () => Promise<JumpResult<World>>): Promise<JumpResult<World>> {
    const id = createHash('sha256').update(key).digest('hex');
    await mkdir(this.directory, { recursive: true });
    const resultFile = join(this.directory, `${id}.json`);
    const lockDirectory = join(this.directory, `${id}.lock`);
    const completed = await this.read<World>(resultFile);
    if (completed) return completed;
    const deadline = Date.now() + 30_000;
    while (true) {
      try {
        await mkdir(lockDirectory);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await this.read<World>(resultFile);
        if (existing) return existing;
        if (Date.now() >= deadline) throw new Error(`Durable-журнал скачка ${key} требует восстановления блокировки`);
        await wait(5);
      }
    }
    try {
      // Владелец прежней блокировки мог сохранить результат между ожиданием и захватом.
      const confirmed = await this.read<World>(resultFile);
      if (confirmed) return confirmed;
      const result = await operation();
      const temporary = `${resultFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
      await rename(temporary, resultFile);
      return result;
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  }

  private async read<World>(file: string): Promise<JumpResult<World> | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as JumpResult<World>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
