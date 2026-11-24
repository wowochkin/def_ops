import type { ReducerProfile, WorldEvent } from './reducer';
import type { WorldState } from '../model/world';

export type VersionedReducer = (world: WorldState, event: WorldEvent, profile: ReducerProfile) => WorldState;

export class ReducerRegistry {
  private readonly reducers = new Map<number, VersionedReducer>();

  register(version: number, reducer: VersionedReducer): void {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Некорректная версия reducer');
    if (this.reducers.has(version)) throw new Error(`Reducer версии ${version} уже зарегистрирован`);
    this.reducers.set(version, reducer);
  }

  get(version: number): VersionedReducer {
    const reducer = this.reducers.get(version);
    if (!reducer) throw new Error(`Неподдерживаемая версия reducer: ${version}; требуется несовместимое чтение или исходный reducer`);
    return reducer;
  }
}
