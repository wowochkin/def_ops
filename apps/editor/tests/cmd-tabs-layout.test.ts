// Вкладки командования (Доклады … Итоги) не уходят за край панели: строка переносится, а не прокручивается вбок
// со скрытой полосой (иначе «Итоги» при 1440×900 недостижимы щелчком). Живая проверка — снимок через мост.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
/** Тела всех правил с точным селектором (вне и внутри @media). */
const rules = (sel: string) => [...css.matchAll(new RegExp(`(?:^|[}\\s])${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);

describe('вкладки командования', () => {
  it('cmd tabs wrap instead of hidden scroll', () => {
    const all = rules('.cmd-tabs');
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]).toMatch(/flex-wrap:\s*wrap/);
    for (const r of all) expect(r).not.toMatch(/overflow-x:\s*auto/);
  });
});
