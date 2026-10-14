/**
 * Выжимка для ассистента модели: npm run model:index → packages/knowledge/data/model-index.json.
 * Источники: часть II docs/system.md, packages/sim/data/rules/norms.json, код packages/sim/src (TS) и
 * crates/agents-core/src (Rust). Пересобирать после правок кода модели или части II (тест сверяет).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { docFragments, normFragments, rsFragments, tsFragments, type ModelFragment } from '../src/model-index';

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'tests' && name !== '__tests__' && name !== 'bin') out.push(...files(p, ext)); }
    else if (name.endsWith(ext) && !name.endsWith('.d.ts') && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

export function buildModelIndex(root: string): ModelFragment[] {
  const rel = (p: string) => relative(root, p).split('\\').join('/');
  const out: ModelFragment[] = [
    ...docFragments(readFileSync(join(root, 'docs/system.md'), 'utf8')),
    ...normFragments(JSON.parse(readFileSync(join(root, 'packages/sim/data/rules/norms.json'), 'utf8'))),
  ];
  for (const p of files(join(root, 'packages/sim/src'), '.ts')) out.push(...tsFragments(rel(p), readFileSync(p, 'utf8')));
  for (const p of files(join(root, 'crates/agents-core/src'), '.rs')) out.push(...rsFragments(rel(p), readFileSync(p, 'utf8')));
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Один фрагмент в строке — читаемый дифф. */
export const serialize = (list: ModelFragment[]): string => `[\n${list.map((f) => JSON.stringify(f)).join(',\n')}\n]\n`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = new URL('../../../', import.meta.url).pathname;
  const list = buildModelIndex(root);
  const text = serialize(list);
  writeFileSync(join(root, 'packages/knowledge/data/model-index.json'), text);
  const by = (k: string) => list.filter((f) => f.kind === k).length;
  console.log(`фрагментов: ${list.length}; описание ${by('doc')}, нормативы ${by('norm')}, код ${by('code')}; ${(text.length / 1024 / 1024).toFixed(1)} МБ`);
}
