import { createHash } from 'node:crypto';

export interface ForkOptions {
  id: string;
  purpose: 'optionEvaluation';
  officialWrite?: unknown;
}

export class WorldFork<S extends object> {
  private state: S | null;
  private readonly id: string;
  private destroyed = false;

  private constructor(state: S, id: string) {
    this.state = state;
    this.id = id;
  }

  static create<S extends object>(official: { state: S; rngCursor: number }, options: ForkOptions): WorldFork<S> {
    if (options.purpose !== 'optionEvaluation') throw new Error('Форк допускается только для оценки варианта');
    if (options.officialWrite !== undefined) throw new Error('Оценочный форк не должен содержать канал записи в официальный мир');
    return new WorldFork(structuredClone(official.state), options.id);
  }

  evaluate<R>(_choiceId: string, simulation: (state: S) => R): R {
    if (this.destroyed || !this.state) throw new Error('Оценочный форк уничтожен');
    const isolated = structuredClone(this.state);
    const result = simulation(isolated);
    this.state = isolated;
    return result;
  }

  hash(): string {
    if (this.destroyed || !this.state) throw new Error('Оценочный форк уничтожен');
    return createHash('sha256').update(JSON.stringify({ id: this.id, purpose: 'optionEvaluation', state: this.state })).digest('hex');
  }

  publishOfficial(_payload: unknown): never {
    throw new Error('Оценочный форк предназначен только для оценки; официальная запись запрещена');
  }

  destroy(): void {
    this.destroyed = true;
    this.state = null;
  }
}
