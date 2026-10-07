/**
 * Промпты — обычные текстовые файлы с подстановками {name}. Читаются при каждом
 * вызове: правка действует сразу. Неизвестная или пропущенная подстановка — ошибка.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const PROMPTS_DIR = process.env.DEFOPS_PROMPTS_DIR ?? fileURLToPath(new URL('../prompts', import.meta.url));

export function fill(template: string, vars: Record<string, string>, name = 'промпт'): string {
  const used = new Set<string>();
  const out = template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, k: string) => {
    if (!(k in vars)) throw new Error(`${name}: нет значения для подстановки {${k}}`);
    used.add(k);
    return vars[k];
  });
  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`${name}: подстановки не используются в шаблоне: ${unused.join(', ')}`);
  return out;
}

export function prompt(file: string, vars: Record<string, string>, dir = PROMPTS_DIR): string {
  return fill(readFileSync(join(dir, file), 'utf8'), vars, file);
}
