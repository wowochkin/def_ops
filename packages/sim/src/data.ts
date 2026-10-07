/** Пакеты данных движка из каталога data/ (только для Node: сервис, проверки, тесты). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Rules, SideProfile } from './types';

export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

const read = <T>(...p: string[]) => JSON.parse(readFileSync(join(DATA_DIR, ...p), 'utf8')) as T;
export const loadProfile = (id: string) => read<SideProfile>('profiles', `${id}.json`);
export const loadRules = (id: string) => read<Rules>('rules', `${id}.json`);
