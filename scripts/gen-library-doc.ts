// Генерация docs/library.md из описания библиотеки (npm run docs:library).
import { writeFileSync } from 'node:fs';
import { CATEGORIES, LIBRARY, STYLES } from '@def-ops/core';

const kindName = { arrow: 'стрелка', line: 'линия', area: 'район', symbol: 'знак', label: 'надпись' } as const;
let md = `# Библиотека условных знаков\n\n`;
md += `Сгенерировано из \`packages/core/src/library.ts\` — не править вручную (\`npm run docs:library\`).\n\n`;
md += `Всего элементов: **${LIBRARY.length}**, категорий: **${CATEGORIES.length}**. `;
md += `Цвета по уставу: свои — красным, противник — синим, сооружения, заграждения и топография — чёрным.\n\n`;
md += `Стили оформления:\n\n${STYLES.map((s) => `- **${s.name}** — ${s.description}`).join('\n')}\n\n`;
md += `Пометка **⚠ сверить** — у знака в разные годы были варианты начертания; его нужно сверить с таблицей условных знаков, принятой для проекта (например, «Тактические условные знаки», 1942, или послевоенные «Условные обозначения, применяемые в боевых документах»).\n\n`;
md += `## Содержание\n\n${CATEGORIES.map((c) => `- [${c.name}](#${c.id}) — ${LIBRARY.filter((e) => e.category === c.id).length}`).join('\n')}\n\n`;
for (const c of CATEGORIES) {
  md += `<a id="${c.id}"></a>\n## ${c.name}\n\n${c.description}\n\n| Элемент | Тип | Описание | Стили | Свои/противник |\n|---|---|---|---|---|\n`;
  for (const e of LIBRARY.filter((x) => x.category === c.id)) {
    const st = STYLES.filter((s) => e.variants[s.id]).map((s) => s.name).join(', ');
    md += `| **${e.name}**${e.verify ? ' ⚠ сверить' : ''} | ${kindName[e.kind]} | ${e.description.replace(/\|/g, '/')} | ${st} | ${e.sideAware ? 'да' : '—'} |\n`;
  }
  md += '\n';
}
writeFileSync('docs/library.md', md);
console.log(`docs/library.md: ${LIBRARY.length} элементов`);
