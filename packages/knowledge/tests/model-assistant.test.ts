import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { modelIndex, findFragments, byName, parseNeed, assistantMessages, ASSIST_LIMITS, type ModelFragment } from '../src';

const all = JSON.parse(readFileSync(new URL('../data/model-index.json', import.meta.url), 'utf8')) as ModelFragment[];
const ix = modelIndex(all);

describe('ассистент модели: поиск', () => {
  it('«как считается бой»: раздел 19.2 и код, в пределах объёма', () => {
    const f = findFragments(ix, 'Как считается исход боя?');
    expect(f.some((x) => x.kind === 'doc' && x.place === 'раздел 19.2')).toBe(true);
    expect(f.some((x) => x.kind === 'code')).toBe(true);
    expect(f.filter((x) => x.kind !== 'code').length).toBeLessThanOrEqual(ASSIST_LIMITS.docs);
    expect(f.filter((x) => x.kind === 'code').length).toBeLessThanOrEqual(ASSIST_LIMITS.code);
    expect(f.reduce((a, x) => a + x.text.length, 0)).toBeLessThanOrEqual(ASSIST_LIMITS.chars);
  });
  it('код по ссылкам найденных разделов: функция из `refs` попадает в выдачу', () => {
    const docWithRef = all.find((x) => x.kind === 'doc' && (x.refs ?? []).some((r) => all.some((c) => c.kind === 'code' && c.title.split('::').pop() === r)))!;
    const ref = docWithRef.refs!.find((r) => all.some((c) => c.kind === 'code' && c.title.split('::').pop() === r))!;
    const mini = modelIndex([docWithRef, ...all.filter((c) => c.kind === 'code' && c.title.split('::').pop() === ref)]);
    const f = findFragments(mini, docWithRef.title);
    expect(f.some((x) => x.kind === 'code' && x.title.split('::').pop() === ref)).toBe(true);
  });
  it('агентная модель — из разделов части I', () => {
    const f = findFragments(ix, 'Как устроен агент дивизии?');
    expect(f.some((x) => x.kind === 'doc' && /^раздел [67]$/.test(x.place))).toBe(true);
  });
});

describe('ассистент модели: дозапрос', () => {
  it('parseNeed: имена через запятую, иначе null', () => {
    expect(parseNeed('НУЖНО: resolveCombat, 22.3')).toEqual(['resolveCombat', '22.3']);
    expect(parseNeed('**НУЖНО:** `step`')).toEqual(['step']);
    expect(parseNeed('Сила считается так…')).toBeNull();
  });
  it('byName: функция, раздел, норматив; не больше четырёх; неизвестное имя — пусто', () => {
    const fn = all.find((x) => x.kind === 'code')!;
    const norm = all.find((x) => x.kind === 'norm')!;
    expect(byName(ix, [fn.title]).map((x) => x.id)).toContain(fn.id);
    expect(byName(ix, ['19.2']).every((x) => x.place === 'раздел 19.2')).toBe(true);
    expect(byName(ix, ['19.2']).length).toBeGreaterThan(0);
    expect(byName(ix, [norm.place]).map((x) => x.id)).toEqual([norm.id]);
    expect(byName(ix, ['нет_такой_функции'])).toEqual([]);
    expect(byName(ix, ['6', '7', '19.2', '21']).length).toBeLessThanOrEqual(ASSIST_LIMITS.need);
  });
  it('запрос: фрагменты под номерами, 3 последние пары, правило дозапроса только в первом запросе', () => {
    const f = findFragments(ix, 'Как считается исход боя?');
    const hist = Array.from({ length: 5 }, (_, i) => ({ q: `в${i}`, a: `о${i}` }));
    const m = assistantMessages('Как считается бой?', f, hist);
    expect(m.filter((x) => x.role === 'user').length).toBe(4);
    expect(m[m.length - 1].content).toContain('[1] ');
    expect(m[0].content).toContain('НУЖНО');
    expect(assistantMessages('x', f, [], { final: true })[0].content).not.toContain('НУЖНО');
  });
});
