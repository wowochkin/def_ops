export function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Канонический JSON требует конечным числом каждое числовое значение');
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input === 'bigint') return `${input}n`;
    if (input === undefined || typeof input === 'function' || typeof input === 'symbol') throw new Error(`Канонический JSON не поддерживает ${input === undefined ? 'undefined' : typeof input}`);
    if (Array.isArray(input)) return input.map(normalize);
    if (input instanceof Date) return input.toISOString();
    if (typeof input === 'object') {
      if (ancestors.has(input)) throw new Error('Канонический JSON не поддерживает циклические ссылки');
      ancestors.add(input);
      const result = Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize((input as Record<string, unknown>)[key])]));
      ancestors.delete(input);
      return result;
    }
    throw new Error('Неподдерживаемое значение канонического JSON');
  };
  return JSON.stringify(normalize(value));
}
