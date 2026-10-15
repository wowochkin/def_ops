import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { Index, roleFilter, roleReference, type Entry, type RoleScope } from '../src';

const E = (id: string, category: Entry['category'], extra: Partial<Entry> = {}): Entry => ({ id, category, title: id, summary: id, status: 'checked', ...extra });
const doctrineClaim = { kind: 'doctrine' as const, side: 'de' as const, level: 'corps' as const, group: 'counterattack', rule: 'doc-rule', condition: 'вклинение', action: 'контратака' };

const set: Entry[] = [
  E('org-de', 'organization', { group: 'de' }),
  E('org-su', 'organization', { group: 'su' }),
  E('eq', 'equipment', { group: 'su' }),
  E('terrain', 'terrain'),
  E('battle', 'battles', { period: { from: '1945-04-16' } }),
  E('chrono', 'chronology', { period: { from: '1945-04-16' } }),
  E('formation', 'formations'),
  E('model', 'organization', { group: 'model' }),
  E('source', 'sources'),
  E('doc-doctrine', 'organization', { group: 'de', origin: 'document', operations: ['berlin'], facts: [{ key: 'principles', value: 'контратака', claim: doctrineClaim }] }),
  E('doc-position', 'terrain', { origin: 'document', operations: ['berlin'], facts: [{ key: 'defense', value: 'позиция', claim: { kind: 'position', subject: 'de_9a', at: '1945-04-20' } }] }),
  E('future', 'organization', { group: 'de', period: { from: '1945-04-25' } }),
  E('foreign', 'organization', { group: 'su', origin: 'document', operations: ['vistula'] }),
];

const pass = (scope: RoleScope) => set.filter(roleFilter(scope)).map((e) => e.id).sort();

describe('справка по роли: фильтр', () => {
  it('штаб, Ставка, посредник: организация, техника, местность, документ только с доктриной; без хода операции, будущего, чужой операции', () => {
    for (const role of ['staff', 'stavka', 'umpire'] as const) {
      expect(pass({ role, operation: 'berlin', moment: '1945-04-19T05:00' }), role).toEqual(['doc-doctrine', 'eq', 'org-de', 'org-su', 'terrain'].sort());
    }
  });

  it('советник: без истории — только безопасные категории, с историей — и сражения', () => {
    const plain = pass({ role: 'advisor', operation: 'berlin' });
    expect(plain).not.toContain('terrain');
    expect(plain).not.toContain('battle');
    expect(plain).toContain('org-de');
    expect(plain).not.toContain('model');
    expect(plain).not.toContain('source');
    expect(plain).not.toContain('foreign');
    expect(pass({ role: 'advisor', operation: 'berlin', history: true })).toContain('battle');
  });

  it('разбор: всё, кроме модели и источников', () => {
    const all = pass({ role: 'review', operation: 'berlin' });
    expect(all).toContain('battle');
    expect(all).toContain('doc-position');
    expect(all).toContain('future');
    expect(all).not.toContain('model');
    expect(all).not.toContain('source');
  });
});

describe('справка по роли: по сиду', () => {
  const entries = (seed as { entries: Entry[] }).entries;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const index = new Index(entries);

  it('штаб противника: ≤ 5 записей по ≤ 700 знаков, без хода операции, своя доктрина помечена', () => {
    const { refs, text } = roleReference(index, byId, ['контратака резервом во фланг', 'оборона у Зееловских высот'],
      { role: 'staff', side: 'de', operation: 'berlin', moment: '1945-04-19T05:00' }, { limit: 5, chars: 700 });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.length).toBeLessThanOrEqual(5);
    expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
    for (const r of refs) {
      expect(['battles', 'chronology', 'operations'], r.id).not.toContain(byId.get(r.id)!.category);
      expect(r.text.length, r.id).toBeLessThanOrEqual(700);
    }
    expect(text.startsWith('[R1] ')).toBe(true);
    const own = refs.find((r) => /^org:de-doctrine-/.test(r.id));
    expect(own?.title).toMatch(/ — своя сторона$/);
    const enemy = refs.find((r) => byId.get(r.id)!.category === 'organization' && byId.get(r.id)!.group === 'su');
    if (enemy) expect(enemy.title).toMatch(/ — противник$/);
  });

  it('готовая выдача и пустой результат', () => {
    const none = roleReference(index, byId, ['qqqzzz'], { role: 'staff', side: 'de' }, { limit: 5, chars: 700 });
    expect(none).toEqual({ refs: [], text: '' });
    const hits = index.search('Зееловские высоты оборона', { limit: 50 });
    const r = roleReference(index, byId, ['что угодно'], { role: 'review' }, { limit: 2, chars: 300, hits: [hits] });
    expect(r.refs.map((x) => x.id)).toEqual(hits.filter((h) => h.kind === 'entry' && byId.get(h.ref)!.group !== 'model' && byId.get(h.ref)!.category !== 'sources').slice(0, 2).map((h) => h.ref));
    expect(r.text).toMatch(/^\[R1\] .+\n[\s\S]+\n\n\[R2\] /);
  });
});
