/** Подстановки {name} в шаблон промпта; неизвестная или неиспользованная — ошибка. Без зависимостей от Node (работает и в браузере). */
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
