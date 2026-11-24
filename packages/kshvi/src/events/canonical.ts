const TYPE_KEY = '$kshvi_canonical_type';

type Tagged = Record<string, unknown>;

function tag(type: string, fields: Record<string, unknown>): Tagged {
  return { [TYPE_KEY]: type, ...fields };
}

/**
 * Детерминированное представление с однозначной типизацией специальных значений.
 * Обычный JSON сохраняет прежнее представление; объекты со служебным ключом экранируются,
 * поэтому они не могут подделать bigint, Date или sparse array.
 */
export function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Канонический JSON требует конечным числом каждое числовое значение');
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input === 'bigint') return tag('bigint', { value: input.toString(10) });
    if (input === undefined || typeof input === 'function' || typeof input === 'symbol') {
      throw new Error(`Канонический JSON не поддерживает ${input === undefined ? 'undefined' : typeof input}`);
    }
    if (input instanceof Date) {
      if (!Number.isFinite(input.getTime())) throw new Error('Канонический JSON не поддерживает некорректную Date');
      return tag('date', { value: input.toISOString() });
    }
    if (typeof input !== 'object') throw new Error('Неподдерживаемое значение канонического JSON');
    if (ancestors.has(input)) throw new Error('Канонический JSON не поддерживает циклические ссылки');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        let sparse = false;
        for (let index = 0; index < input.length; index += 1) {
          if (!(index in input)) { sparse = true; break; }
        }
        if (!sparse) return input.map(normalize);
        const entries: [number, unknown][] = [];
        for (let index = 0; index < input.length; index += 1) {
          if (index in input) entries.push([index, normalize(input[index])]);
        }
        return tag('sparse-array', { length: input.length, entries });
      }
      const keys = Object.keys(input).sort();
      if (keys.includes(TYPE_KEY)) {
        return tag('object', {
          entries: keys.map(key => [key, normalize((input as Record<string, unknown>)[key])]),
        });
      }
      return Object.fromEntries(keys.map(key => [key, normalize((input as Record<string, unknown>)[key])]));
    } finally {
      ancestors.delete(input);
    }
  };
  return JSON.stringify(normalize(value));
}
