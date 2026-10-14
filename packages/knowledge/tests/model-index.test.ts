import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { docFragments, normFragments, tsFragments, rsFragments } from '../src/model-index';
import { buildModelIndex, serialize } from '../tools/build_model_index';

const MD = [
  '# Часть I. Система', '', '## 1. Ввод', 'не берётся', '',
  '# Часть II. Модель переигровки', '', 'Вступление части.', '',
  '## 19. Ход: как считается', '', 'Общий текст хода, см. `step.ts` и `combatPower`.', '',
  '### 19.2. Бой', '', 'Сила стороны — сумма потенциалов (`resolve_combat`).', '',
  '![Бой](img/combat.jpg)', '', '*Подпись к снимку — не берётся.*', '', 'После снимка.', '',
].join('\n');

describe('выжимка: описание', () => {
  it('подраздел — с путём заголовков, номер раздела в месте, без снимков и подписей', () => {
    const f = docFragments(MD);
    expect(f.some((x) => x.text.includes('не берётся') && !x.text.includes('Подпись'))).toBe(false);
    const fight = f.find((x) => x.place === 'раздел 19.2')!;
    expect(fight.title).toBe('19. Ход: как считается → 19.2. Бой');
    expect(fight.text).toContain('После снимка.');
    expect(fight.text).not.toContain('Подпись к снимку');
    expect(fight.text).not.toContain('img/combat.jpg');
    expect(fight.refs).toContain('resolve_combat');
    expect(f.find((x) => x.place === 'раздел 19')!.refs).toEqual(expect.arrayContaining(['step.ts', 'combatPower']));
  });
  it('длинный раздел — по абзацам до 2500 знаков с заголовком в каждом, таблица целиком', () => {
    const para = (i: number) => `Абзац ${i}. ` + 'слово '.repeat(120);
    const table = ['| a | b |', '|---|---|', ...Array.from({ length: 80 }, (_, i) => `| строка ${i} | ${'x'.repeat(30)} |`)].join('\n');
    const md = ['# Часть II. Модель', '', '## 21. Калибровка', '', para(1), '', para(2), '', table, '', para(3), '', para(4), ''].join('\n');
    const f = docFragments(md).filter((x) => x.place === 'раздел 21');
    expect(f.length).toBeGreaterThan(1);
    for (const x of f) expect(x.title).toBe('21. Калибровка');
    const withTable = f.filter((x) => x.text.includes('| строка 0 |'));
    expect(withTable).toHaveLength(1);
    expect(withTable[0].text).toContain('| строка 79 |');
    expect(new Set(f.map((x) => x.id)).size).toBe(f.length);
    for (const x of f.filter((y) => !y.text.includes('| a | b |'))) expect(x.text.length).toBeLessThanOrEqual(2500);
  });
});

describe('выжимка: нормативы', () => {
  it('норматив с источником и допущение', () => {
    const f = normFragments({ norms: [
      { id: 'pace-x', title: 'Темп X', source: 'LT_CONQ', reliability: 'B', historical: 'до 4 км/сут', expect: [1, 5], unit: 'км/сут', rules: ['advance'] },
      { id: 'assume-y', title: 'Срок сдачи', source: '', reliability: '', historical: '—', measure: { kind: 'assumption', why: 'нужны журналы' }, unit: 'ч', rules: ['pocket.capitulateHours'] },
    ] });
    expect(f.map((x) => x.id)).toEqual(['norm:pace-x', 'norm:assume-y']);
    expect(f[0].text).toContain('LT_CONQ');
    expect(f[0].text).toContain('1–5 км/сут');
    expect(f[1].text).toContain('допущение');
    expect(f[1].text).toContain('нужны журналы');
    expect(f[1].refs).toContain('pocket.capitulateHours');
  });
});

describe('выжимка: код', () => {
  it('TS: функции и экспортируемые константы с комментарием, без внутренних констант', () => {
    const src = [
      "import { x } from './x';",
      '/** Сила стороны: сумма потенциалов. */',
      'export function combatPower(a: number, b: { k: number }): number {',
      "  const re = /\\{/; const s = '}' + `${a + '}'}`;",
      '  return a * b.k;',
      '}',
      'const local = 1;',
      '// Множитель обороны',
      'export const DEFENSE = { fort: 1.5, river: 1.3 };',
      'function helper() { return 2; }',
    ].join('\n');
    const f = tsFragments('packages/sim/src/combat.ts', src);
    expect(f.map((x) => x.title)).toEqual(['combatPower', 'DEFENSE', 'helper']);
    const cp = f[0];
    expect(cp.id).toBe('code:packages/sim/src/combat.ts#combatPower');
    expect(cp.place).toBe('packages/sim/src/combat.ts:3');
    expect(cp.text).toContain('Сила стороны');
    expect(cp.text).toContain('return a * b.k;');
    expect(cp.text.trim().endsWith('}')).toBe(true);
    expect(f[1].text).toContain('Множитель обороны');
    expect(f[1].text).toContain('river: 1.3');
  });
  it('Rust: fn в impl с замыканием и строкой «{» — тело целиком, тип в названии; тесты пропущены', () => {
    const src = [
      'pub struct Division {',
      '    /// численность',
      '    pub personnel: f64,',
      '}',
      'impl Division {',
      '    /// Выбрать цель.',
      '    pub fn pick_target(&self, xs: &[f64]) -> Option<usize> {',
      '        let label = "{"; let c = \'}\';',
      '        let best = xs.iter().enumerate().max_by(|a, b| { a.1.partial_cmp(b.1).unwrap() });',
      '        /* } */ best.map(|(i, _)| i)',
      '    }',
      '    fn tail<\'a>(&\'a self) -> &\'a f64 { &self.personnel }',
      '}',
      '#[cfg(test)]',
      'mod tests {',
      '    fn in_test() {}',
      '}',
    ].join('\n');
    const f = rsFragments('crates/agents-core/src/division.rs', src);
    expect(f.map((x) => x.title)).toEqual(['Division', 'Division::pick_target', 'Division::tail']);
    const pick = f[1];
    expect(pick.text).toContain('Выбрать цель.');
    expect(pick.text).toContain('best.map(|(i, _)| i)');
    expect(pick.text.trim().endsWith('}')).toBe(true);
    expect(pick.text).not.toContain('fn tail');
    expect(f[0].text).toContain('численность');
    expect(f.some((x) => x.title.includes('in_test'))).toBe(false);
  });
  it('длинное тело — обрезка с номерами строк', () => {
    const body = Array.from({ length: 120 }, (_, i) => `  x += ${i};`);
    const src = ['function long() {', ...body, '}'].join('\n');
    const [f] = tsFragments('a.ts', src);
    expect(f.text.split('\n').length).toBeLessThanOrEqual(82);
    expect(f.text).toMatch(/… строки \d+–122/);
  });
});

describe('выжимка: свежесть', () => {
  it('файл выжимки совпадает со сборкой по исходникам (npm run model:index)', () => {
    const root = new URL('../../../', import.meta.url).pathname;
    const built = serialize(buildModelIndex(root));
    const file = readFileSync(`${root}packages/knowledge/data/model-index.json`, 'utf8');
    expect(file === built, 'выжимка устарела: npm run model:index').toBe(true);
    const all = JSON.parse(file) as { kind: string }[];
    for (const k of ['doc', 'norm', 'code']) expect(all.some((x) => x.kind === k)).toBe(true);
  });
});
