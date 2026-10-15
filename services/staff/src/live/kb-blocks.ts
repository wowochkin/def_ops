/**
 * Справка и доктрина из базы знаний в промпте штаба: одна нумерация [R1]… — сначала справки, затем правила доктрины;
 * разбор ссылок basis из ответа модели.
 */
import type { DoctrineRule, RoleRef } from '@def-ops/knowledge';

/** Блоки справки и доктрины и общий список ссылок (номер Rn — позиция в refs). */
export function kbBlocks(refs: RoleRef[], rules: DoctrineRule[]): { reference: string; doctrine: string; refs: RoleRef[] } {
  const k = refs.length;
  return {
    reference: k ? refs.map((r, i) => `[R${i + 1}] ${r.title}\n${r.text}`).join('\n\n') : '(справок нет)',
    doctrine: rules.length ? rules.map((r, i) => `[R${k + i + 1}] ${r.line}`).join('\n') : '(правил нет)',
    refs: [...refs, ...rules.map((r) => ({ id: r.entry, title: r.title, text: r.line }))],
  };
}

/**
 * Ссылки из ответа модели: «[R1]», «R 2», «Р3» (кириллица), «(R4)» — из строки или массива строк; только номера
 * 1…refs.length, без повторов, в порядке первого упоминания.
 */
export function parseRefs(basis: unknown, refs: RoleRef[]): string[] {
  const text = typeof basis === 'string' ? basis : Array.isArray(basis) ? basis.filter((x) => typeof x === 'string').join(' ; ') : '';
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Za-zА-Яа-яЁё])[RР]\s*(\d+)/g)) {
    const n = Number(m[1]);
    const id = `R${n}`;
    if (n >= 1 && n <= refs.length && !out.includes(id)) out.push(id);
  }
  return out;
}
