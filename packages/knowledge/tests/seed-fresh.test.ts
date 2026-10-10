import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

describe('база знаний собрана из свежих данных', () => {
  it('устройство модели в базе совпадает с частью II docs/system.md (иначе — npm run kb:seed)', () => {
    const seed = JSON.parse(read('packages/knowledge/data/seed.json')) as { entries: { id: string; sections?: { text: string }[] }[] };
    const md = read('docs/system.md').split(/\n# Часть II[^\n]*\n/)[1] ?? '';
    const parts = md.split(/\n## /).slice(1).map((p) => p.split('\n').slice(1).join('\n').trim());
    const model = seed.entries.filter((e) => e.id.startsWith('model:')).map((e) => e.sections?.[0]?.text ?? '');
    expect(model.length).toBe(parts.length);
    for (const p of parts) expect(model.includes(p), p.slice(0, 80)).toBe(true);
  });
});
