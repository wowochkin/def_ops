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
  // местность штабу — только если все её факты — значения правил или доктрина
  E('terrain-param', 'terrain', { facts: [{ key: 'kind', value: 'ширина реки 120 м', claim: { kind: 'param', param: 'river.width', value: 120 } }] }),
  E('terrain-mixed', 'terrain', { facts: [{ key: 'kind', value: 'гряда' }, { key: 'kind', value: 'x', claim: { kind: 'param', param: 'p', value: 1 } }] }),
  // факт с датой позже момента хода (переправа построена 21.04) — запись не проходит
  E('org-future-claim', 'organization', { group: 'su', facts: [{ key: 'numbers', value: 'x', claim: { kind: 'crossing', subject: 'br', from: '1945-04-21', state: 'built' } }] }),
  E('eq-past-claim', 'equipment', { facts: [{ key: 'numbers', value: 'x', claim: { kind: 'strength', subject: 'd', at: '1945-04-19' } }] }),
  E('user-doc-param', 'organization', { group: 'su', origin: 'user', facts: [{ key: 'numbers', value: '4 км', source: 'doc:d4', claim: { kind: 'param', param: 'frontage.km', value: 4 } }] }),
];

const pass = (scope: RoleScope) => set.filter(roleFilter(scope)).map((e) => e.id).sort();

describe('справка по роли: фильтр', () => {
  it('штабу, Ставке, посреднику местность — только из значений правил и доктрины; запись с датой факта позже хода — нет', () => {
    for (const role of ['staff', 'stavka', 'umpire'] as const) {
      const ids = pass({ role, operation: 'berlin', moment: '1945-04-19T05:00' });
      expect(ids, role).toContain('terrain-param');
      expect(ids, role).not.toContain('terrain');
      expect(ids, role).not.toContain('terrain-mixed');
      expect(ids, role).not.toContain('org-future-claim');
      expect(ids, role).toContain('eq-past-claim');
    }
    expect(pass({ role: 'staff', operation: 'berlin', moment: '1945-04-22T05:00' })).toContain('org-future-claim');
  });

  it('доктрина дана отдельным блоком — записи доктрины штабу и Ставке не нужны; посреднику — остаются', () => {
    for (const role of ['staff', 'stavka'] as const) {
      const ids = pass({ role, operation: 'berlin', moment: '1945-04-19T05:00', doctrine: true });
      expect(ids, role).not.toContain('doc-doctrine');
      expect(ids, role).toContain('org-de');
    }
    expect(pass({ role: 'umpire', operation: 'berlin', moment: '1945-04-19T05:00', doctrine: true })).toContain('doc-doctrine');
    expect(pass({ role: 'staff', operation: 'berlin', moment: '1945-04-19T05:00' })).toContain('doc-doctrine');
  });

  it('штаб, Ставка, посредник: организация, техника, местность из значений правил, документ только с доктриной; без хода операции, будущего, чужой операции', () => {
    for (const role of ['staff', 'stavka', 'umpire'] as const) {
      expect(pass({ role, operation: 'berlin', moment: '1945-04-19T05:00' }), role).toEqual(['doc-doctrine', 'eq', 'eq-past-claim', 'org-de', 'org-su', 'terrain-param', 'user-doc-param'].sort());
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

  it('на 16.04 06:00 штабу, Ставке, посреднику — ни одной записи с историей после хода (Штайн, переправы 49 А, Шлосс-брюкке)', () => {
    const moment = '1945-04-16T06:00';
    const queries = ['отсечная позиция Штайн прорыв', 'переправы 49 А Огница Шведт Вест-Одер', 'Шлосс-брюкке мост Шпрее', 'мост переправа через Одер', 'оборона полоса позиция'];
    for (const role of ['staff', 'stavka', 'umpire'] as const) {
      const { refs } = roleReference(index, byId, queries, { role, side: 'de', operation: 'berlin-1945-tasks', moment }, { limit: 40, chars: 900 });
      expect(refs.length, role).toBeGreaterThan(0);
      for (const r of refs) {
        const e = byId.get(r.id)!;
        expect(['line:belt_stein', 'obj:br_oder_ognica', 'obj:br_spree_schloss'], `${role} ${r.id}`).not.toContain(r.id);
        expect(['organization', 'equipment', 'terrain'], r.id).toContain(e.category);
        if (e.category === 'terrain') expect((e.facts ?? []).every((f) => f.claim && ['param', 'doctrine'].includes(f.claim.kind)), r.id).toBe(true);
        for (const f of e.facts ?? []) {
          const c = f.claim as { at?: string; from?: string; to?: string } | undefined;
          for (const d of [c?.at, c?.from, c?.to]) if (d) expect(d.slice(0, 10) <= moment.slice(0, 10), `${r.id} ${d}`).toBe(true);
        }
      }
    }
  });

  it('факты доктрины с датой позже хода не попадают в текст справки (приказ № 00566 от 18.04 — не на 16.04)', () => {
    const hits = index.search('остановка и переход к обороне пауза', { limit: 400 }).filter((h) => h.ref === 'org:su-doctrine-stop');
    expect(hits.length).toBe(1);
    const at = (moment: string) => roleReference(index, byId, ['x'], { role: 'umpire', operation: 'berlin-1945-tasks', moment }, { limit: 1, chars: 100000, hits: [hits] });
    const early = at('1945-04-16T06:00');
    expect(early.refs.map((r) => r.id)).toEqual(['org:su-doctrine-stop']);
    expect(early.text).not.toContain('00566');
    expect(at('1945-04-19T06:00').text).toContain('00566');
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
