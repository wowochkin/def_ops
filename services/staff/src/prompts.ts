/**
 * Промпты — обычные текстовые файлы с подстановками {name}. Читаются при каждом
 * вызове: правка действует сразу. Неизвестная или пропущенная подстановка — ошибка.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fill } from './fill';

export { fill };

export const PROMPTS_DIR = process.env.DEFOPS_PROMPTS_DIR ?? fileURLToPath(new URL('../prompts', import.meta.url));

export function prompt(file: string, vars: Record<string, string>, dir = PROMPTS_DIR): string {
  return fill(readFileSync(join(dir, file), 'utf8'), vars, file);
}
