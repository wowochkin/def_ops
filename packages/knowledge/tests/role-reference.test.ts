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
  // туман войны: текстовые факты из документа операции — обстановка, не доктрина
  E('doc-text', 'organization', { group: 'de', origin: 'document', operations: ['berlin'], facts: [{ key: 'principles', value: 'дивизия отошла на вторую позицию' }] }),
  E('u:berlin:infrastructure', 'terrain', { origin: 'document', operations: ['berlin'], facts: [{ key: 'features', value: 'мост взорван 20 апреля', source: 'doc:d1' }] }),
  E('user-doc-fact', 'terrain', { origin: 'user', facts: [{ key: 'defense', value: 'гарнизон 2 батальона', source: 'doc:d2' }] }),
  E('user-evidence-fact', 'equipment', { origin: 'user', facts: [{ key: 'armament', value: 'x', evidence: { kind: 'quote', doc: 'd3', chunk: 0, quote: 'x' } }] }),
  E('user-doc-param', 'organization', { group: 'su', origin: 'user', facts: [{ key: 'numbers', value: '4 км', source: 'doc:d4', claim: { kind: 'param', param: 'frontage.km', value: 4 } }] }),
];

const pass = (scope: RoleScope) => set.filter(roleFilter(scope)).map((e) => e.id).sort();

describe('справка по роли: фильтр', () => {
  it('штаб, Ставка, посредник: организация, техника, местность, документ только с доктриной; без хода операции, будущего, чужой операции', () => {
    for (const role of ['staff', 'stavka', 'umpire'] as const) {
      expect(pass({ role, operation: 'berlin', moment: '1945-04-19T05:00' }), role).toEqual(['doc-doctrine', 'eq', 'org-de', 'org-su', 'terrain', 'user-doc-param'].sort());
    }
  });

  it('туман войны: любой текстовый факт из документа исключает запись для штаба; доктрина из документа проходит', () => {
    for (const role of ['staff', 'stavka', 'umpire'] as const) {
      const ids = pass({ role, operation: 'berlin', moment: '1945-04-19T05:00' });
      for (const id of ['doc-text', 'u:berlin:infrastructure', 'user-doc-fact', 'user-evidence-fact']) expect(ids, `${role} ${id}`).not.toContain(id);
      expect(ids).toContain('doc-doctrine');
    }
    expect(pass({ role: 'review', operation: 'berlin' })).toContain('user-doc-fact');
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

  it('советник с историей: пометка «, история» у записей истории, у доктрины — нет', () => {
    const { refs } = roleReference(index, byId, ['Зееловские высоты оборона'], { role: 'advisor', history: true, operation: 'berlin' }, { limit: 8, chars: 500 });
    const hist = refs.filter((r) => byId.get(r.id)!.category === 'battles' || byId.get(r.id)!.category === 'terrain');
    expect(hist.length).toBeGreaterThan(0);
    for (const r of hist) expect(r.title, r.id).toMatch(/, история$/);
    for (const r of refs.filter((x) => ['organization', 'equipment'].includes(byId.get(x.id)!.category))) expect(r.title).not.toMatch(/история/);
    const plain = roleReference(index, byId, ['Зееловские высоты оборона'], { role: 'review', operation: 'berlin' }, { limit: 8, chars: 500 });
    expect(plain.refs.some((r) => /история$/.test(r.title))).toBe(false);
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
