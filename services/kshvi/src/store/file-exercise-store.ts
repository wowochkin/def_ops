import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  InMemoryExerciseStore,
  type ExerciseStoreOptions,
  type ExerciseStoreSnapshot,
} from './exercise-store';

type Options = Omit<ExerciseStoreOptions, 'snapshot' | 'onSnapshot'> & Readonly<{ file: string }>;

function load(file: string): ExerciseStoreSnapshot | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const value = JSON.parse(text) as Partial<ExerciseStoreSnapshot>;
  const entries = (items: unknown): boolean => Array.isArray(items)
    && items.every(item => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string');
  if (value.version !== 1 || !entries(value.records) || !entries(value.sessionCommands)) {
    throw new Error(`Повреждён файл библиотеки КШВИ: ${file}`);
  }
  return value as ExerciseStoreSnapshot;
}

function save(file: string, snapshot: ExerciseStoreSnapshot): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Локальная библиотека без СУБД: загрузка при старте и атомарная запись после каждого изменения. */
export function openFileExerciseStore(options: Options): InMemoryExerciseStore {
  const { file, ...storeOptions } = options;
  return new InMemoryExerciseStore({
    ...storeOptions,
    snapshot: load(file),
    onSnapshot: snapshot => save(file, snapshot),
  });
}
