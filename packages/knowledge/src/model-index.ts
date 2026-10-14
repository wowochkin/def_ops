/**
 * Выжимка для ассистента модели: часть II описания по подразделам, нормативы, функции кода модели (TS — нынешняя
 * модель, Rust — ядро агентов) с комментариями. Чистые функции; сборка файла — packages/knowledge/tools/build_model_index.ts.
 */

export interface ModelFragment {
  /** doc:22.4#2, norm:<id>, code:<файл>#<имя> */
  id: string;
  kind: 'doc' | 'norm' | 'code';
  /** Путь заголовков / название норматива / имя функции (у Rust — Тип::имя). */
  title: string;
  /** «раздел 22.4» / id норматива / файл:строка */
  place: string;
  text: string;
  /** Упомянутые имена: у раздела — файлы и функции в `кавычках`, у норматива — правила. */
  refs?: string[];
}

const DOC_MAX = 2500;
const BODY_MAX = 80;

/** Имена из `обратных кавычек`: файлы .ts/.rs и идентификаторы с заглавной внутри, «_» или точкой. */
function refsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
    const s = m[1].trim();
    if (/^[\w./-]+\.(ts|rs)$/.test(s)) out.add(s.split('/').pop()!);
    else if (/^[A-Za-z_][\w.]*(\(\))?$/.test(s) && /[a-z][A-Z]|_|\./.test(s)) out.add(s.replace(/\(\)$/, ''));
  }
  return [...out];
}

/** Часть II описания: подразделы с путём заголовков; длинные — по абзацам; таблицы целиком; без снимков и подписей. */
export function docFragments(md: string): ModelFragment[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^# Часть II\b/.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^# /.test(l));
  if (end < 0) end = lines.length;
  const out: ModelFragment[] = [];
  const path: { level: number; text: string }[] = [];
  let body: string[] = [];
  const flush = () => {
    if (!path.length) { body = []; return; }
    const blocks = splitBlocks(body);
    body = [];
    if (!blocks.length) return;
    const title = path.map((p) => p.text).join(' → ');
    const num = /^(\d+(?:\.\d+)*)\.?\s/.exec(path[path.length - 1].text)?.[1] ?? path[path.length - 1].text;
    const chunks: string[] = [];
    let cur = '';
    for (const b of blocks) {
      if (cur && cur.length + b.length + 2 > DOC_MAX) { chunks.push(cur); cur = ''; }
      cur = cur ? `${cur}\n\n${b}` : b;
    }
    if (cur) chunks.push(cur);
    chunks.forEach((text, k) => {
      const refs = refsOf(text);
      out.push({ id: `doc:${num}#${k}`, kind: 'doc', title, place: `раздел ${num}`, text, ...(refs.length ? { refs } : {}) });
    });
  };
  for (let i = start + 1; i < end; i++) {
    const h = /^(#{2,4})\s+(.*)$/.exec(lines[i]);
    if (h) {
      flush();
      const level = h[1].length;
      while (path.length && path[path.length - 1].level >= level) path.pop();
      path.push({ level, text: h[2].trim() });
    } else body.push(lines[i]);
  }
  flush();
  return out;
}

/** Абзацы и таблицы; снимок (![…](…)) и подпись курсивом сразу под ним — пропуск. */
function splitBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  const push = () => { const t = cur.join('\n').trim(); if (t) blocks.push(t); cur = []; };
  let skipCaption = false;
  for (const l of lines) {
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l)) { push(); skipCaption = true; continue; }
    if (!l.trim()) { push(); continue; }
    if (skipCaption && !cur.length && /^\*[^*].*\*\s*$/.test(l.trim())) { skipCaption = false; continue; }
    // строка таблицы после текста и наоборот — отдельные блоки
    const isTable = l.trim().startsWith('|');
    if (cur.length && isTable !== cur[cur.length - 1].trim().startsWith('|')) push();
    skipCaption = false;
    cur.push(l);
  }
  push();
  return blocks;
}

type Norm = { id: string; title?: string; source?: string; reliability?: string; historical?: string; expect?: [number, number]; unit?: string; rules?: string[]; kb?: string; note?: string; measure?: { kind?: string; why?: string; expr?: string } };

/** Одна строка norms.json — фрагмент: что задаёт, значение, источник или допущение, правила. */
export function normFragments(norms: unknown): ModelFragment[] {
  const list = ((norms as { norms?: Norm[] })?.norms ?? []) as Norm[];
  return list.map((n) => {
    const assume = !n.source || n.measure?.kind === 'assumption';
    const lines = [
      n.title ?? n.id,
      n.historical && n.historical !== '—' ? `По истории: ${n.historical}` : '',
      n.expect ? `Допуск в модели: ${n.expect[0]}–${n.expect[1]}${n.unit ? ` ${n.unit}` : ''}` : '',
      assume ? `Это допущение${n.measure?.why ? `: ${n.measure.why}` : ''}` : `Источник: ${n.source}${n.reliability ? ` (${n.reliability})` : ''}`,
      n.measure?.expr ? `Параметр: ${n.measure.expr}` : '',
      n.rules?.length ? `Правила модели: ${n.rules.join(', ')}` : '',
      n.note ?? '',
    ].filter(Boolean);
    return { id: `norm:${n.id}`, kind: 'norm' as const, title: n.title ?? n.id, place: n.id, text: lines.join('\n'), ...(n.rules?.length ? { refs: n.rules } : {}) };
  });
}

/**
 * Конец тела от позиции open (первый «{» объявления): баланс скобок без учёта строк, символов, шаблонов и
 * комментариев. Возвращает индекс закрывающей «}» или -1.
 */
function matchBrace(src: string, open: number, lang: 'ts' | 'rs'): number {
  let depth = 0;
  const tmpl: number[] = []; // глубина скобок, на которой открыт ${…} внутри шаблона
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (lang === 'rs' && c === 'r' && (n === '"' || (n === '#' && /^#+"/.test(src.slice(i + 1, i + 8)))) && !/\w/.test(src[i - 1] ?? '')) {
      const hashes = /^#*/.exec(src.slice(i + 1))![0];
      const close = src.indexOf(`"${hashes}`, i + 2 + hashes.length);
      if (close < 0) return -1;
      i = close + hashes.length; continue;
    }
    if (c === '"' || (c === "'" && lang === 'ts')) { i = skipString(src, i, c); if (i < 0) return -1; continue; }
    if (c === "'" && lang === 'rs') {
      // символ ('x', '\n', '\u{..}') или время жизни ('a)
      const m = /^'(\\(u\{[0-9a-fA-F]+\}|.)|[^\\'])'/.exec(src.slice(i, i + 12));
      if (m) { i += m[0].length - 1; }
      continue;
    }
    if (c === '`' && lang === 'ts') { i = skipTemplate(src, i); if (i < 0) return -1; continue; }
    if (lang === 'ts' && c === '/' && regexAllowed(src, i)) { const j = skipRegex(src, i); if (j > 0) { i = j; continue; } }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (tmpl.length && depth === tmpl[tmpl.length - 1]) tmpl.pop();
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(src: string, i: number, q: string): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
    if (src[j] === '\n' && q !== '"') return j;
  }
  return -1;
}

/** Шаблон `…${выражение}…`: выражения могут содержать строки, скобки и вложенные шаблоны. */
function skipTemplate(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '`') return j;
    if (src[j] === '$' && src[j + 1] === '{') {
      let depth = 1;
      for (j += 2; j < src.length && depth > 0; j++) {
        const c = src[j];
        if (c === '"' || c === "'") { j = skipString(src, j, c); if (j < 0) return -1; }
        else if (c === '`') { j = skipTemplate(src, j); if (j < 0) return -1; }
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      j--;
    }
  }
  return -1;
}

function regexAllowed(src: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return true;
  if ('(,=:[!&|?{};+-*%<>~^'.includes(src[k])) return true;
  return /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, k - 6), k + 1));
}

function skipRegex(src: string, i: number): number {
  let cls = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\n') return -1;
    if (c === '\\') { j++; continue; }
    if (cls) { if (c === ']') cls = false; continue; }
    if (c === '[') { cls = true; continue; }
    if (c === '/') return j;
  }
  return -1;
}

const lineOf = (src: string, idx: number) => src.slice(0, idx).split('\n').length;

/** Комментарий над строкой start (JSDoc, //, ///), без атрибутов #[…]. */
function commentAbove(lines: string[], start: number, lang: 'ts' | 'rs'): string[] {
  const out: string[] = [];
  let k = start - 1;
  while (k >= 0) {
    const t = lines[k].trim();
    if (lang === 'rs' && t.startsWith('#[')) { k--; continue; }
    if (t.startsWith('//') || t.startsWith('/**') || t.startsWith('*') || t.endsWith('*/')) { out.unshift(lines[k]); k--; continue; }
    break;
  }
  return out;
}

/** Текст фрагмента: комментарий + объявление; тело длиннее BODY_MAX строк — обрезка с номерами строк. */
function fragmentText(lines: string[], first: number, last: number, comment: string[]): string {
  const body = lines.slice(first, last + 1);
  let text: string[];
  if (body.length > BODY_MAX + 2) {
    const keep = body.slice(0, BODY_MAX);
    text = [...keep, `  // … строки ${first + BODY_MAX + 1}–${last + 1}`];
  } else text = body;
  return [...comment, ...text].join('\n');
}

/** Нынешняя модель (TS): функции верхнего уровня, экспортируемые константы, типы и классы — с комментарием. */
export function tsFragments(path: string, src: string): ModelFragment[] {
  const lines = src.split('\n');
  const offs: number[] = [];
  let acc = 0;
  for (const l of lines) { offs.push(acc); acc += l.length + 1; }
  const out: ModelFragment[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const m = /^(export\s+)?(default\s+)?(async\s+)?(function\*?\s+(\w+)|class\s+(\w+)|interface\s+(\w+)|type\s+(\w+)|(const|let)\s+(\w+))/.exec(l);
    const isConst = !!m?.[9];
    if (!m || (isConst && !m[1])) { i++; continue; }
    const name = m[5] ?? m[6] ?? m[7] ?? m[8] ?? m[10];
    const start = offs[i];
    let endIdx: number;
    if (m[4]?.startsWith('function') || m[6] || m[7]) {
      // тело — первая «{» после закрытия списка параметров
      const open = firstBodyBrace(src, start + l.indexOf(m[4]));
      endIdx = open < 0 ? -1 : matchBrace(src, open, 'ts');
    } else endIdx = statementEnd(src, start);
    if (endIdx < 0) { i++; continue; }
    const last = lineOf(src, endIdx) - 1;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    out.push({
      id: `code:${path}#${name}${n > 1 ? `@${i + 1}` : ''}`, kind: 'code', title: name, place: `${path}:${i + 1}`,
      text: fragmentText(lines, i, last, commentAbove(lines, i, 'ts')),
    });
    i = last + 1;
  }
  return out;
}

/** Первая «{» тела функции: после сбалансированных (...) параметров и возможного типа результата. */
function firstBodyBrace(src: string, from: number): number {
  let paren = 0, angle = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '<') angle++;
    else if (c === '>' && src[i - 1] !== '=') angle = Math.max(0, angle - 1);
    else if (c === '{' && paren === 0 && angle === 0) {
      // «{» в типе результата (: { a: number }) — тоже тело-кандидат: тело — последний «{» перед переводом строки
      // объявления; проще: если после «{» до парной «}» идёт «{», это был тип
      const close = matchBrace(src, i, 'ts');
      if (close < 0) return -1;
      const rest = src.slice(close + 1, close + 40);
      if (/^\s*(\[\]|\|[^{]*)?\s*\{/.test(rest) || /^\s*=>/.test(rest)) { i = close; continue; }
      return i;
    } else if (c === ';' && paren === 0) return -1;
  }
  return -1;
}

/** Конец объявления const/type: «;» на нулевой глубине (строки, шаблоны, комментарии пропускаются). */
function statementEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length - 1; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'") { i = skipString(src, i, c); if (i < 0) return -1; continue; }
    if (c === '`') { i = skipTemplate(src, i); if (i < 0) return -1; continue; }
    if (c === '/' && regexAllowed(src, i)) { const j = skipRegex(src, i); if (j > 0) { i = j; continue; } }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return i;
    else if (c === '\n' && depth === 0 && i > start) {
      // без «;»: конец, если следующая строка — новое объявление верхнего уровня
      const next = src.slice(i + 1, i + 60);
      if (/^(export|function|const|let|type|interface|class|import|\/\/|\/\*)\b/.test(next) || /^\s*$/.test(next.split('\n')[0])) return i - 1;
    }
  }
  return src.length - 1;
}

/** Ядро агентов (Rust): fn (в том числе в impl — «Тип::имя»), struct и enum с полями; модули #[cfg(test)] — пропуск. */
export function rsFragments(path: string, src: string): ModelFragment[] {
  const lines = src.split('\n');
  const offs: number[] = [];
  let acc = 0;
  for (const l of lines) { offs.push(acc); acc += l.length + 1; }
  // диапазоны: тестовые модули и impl-блоки
  const skip: [number, number][] = [];
  const impls: { from: number; to: number; ty: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#\[cfg\(test\)\]/.test(lines[i])) {
      const j = lines.findIndex((l, k) => k > i && /^\s*(pub\s+)?mod\s+\w+/.test(l));
      if (j >= 0) {
        const open = src.indexOf('{', offs[j]);
        const close = open < 0 ? -1 : matchBrace(src, open, 'rs');
        if (close > 0) skip.push([i, lineOf(src, close) - 1]);
      }
    }
    const im = /^\s*impl\b(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_]\w*)/.exec(lines[i]);
    if (im) {
      const open = src.indexOf('{', offs[i]);
      const close = open < 0 ? -1 : matchBrace(src, open, 'rs');
      if (close > 0) impls.push({ from: i, to: lineOf(src, close) - 1, ty: im[1] });
    }
  }
  const inSkip = (i: number) => skip.some(([a, b]) => i >= a && i <= b);
  const out: ModelFragment[] = [];
  const seen = new Map<string, number>();
  let fnUntil = -1;
  for (let i = 0; i < lines.length; i++) {
    if (inSkip(i) || i <= fnUntil) continue;
    const m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"\w+"\s+)?(fn|struct|enum)\s+([A-Za-z_]\w*)/.exec(lines[i]);
    if (!m) continue;
    const start = offs[i];
    // тело: первая «{» или «;» (объявление без тела, кортежная структура)
    let k = start, depth = 0, open = -1;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ';' && depth === 0) break;
      else if (c === '{' && depth === 0) { open = k; break; }
    }
    const endIdx = open < 0 ? k : matchBrace(src, open, 'rs');
    if (endIdx < 0) continue;
    const last = lineOf(src, endIdx) - 1;
    const impl = impls.find((x) => i > x.from && i <= x.to);
    const name = m[1] === 'fn' && impl ? `${impl.ty}::${m[2]}` : m[2];
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    out.push({
      id: `code:${path}#${name}${n > 1 ? `@${i + 1}` : ''}`, kind: 'code', title: name, place: `${path}:${i + 1}`,
      text: fragmentText(lines, i, last, commentAbove(lines, i, 'rs')),
    });
    if (m[1] === 'fn') fnUntil = last;
  }
  return out;
}
