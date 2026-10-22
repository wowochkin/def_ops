import { describe, expect, it } from 'vitest';
import { commandView, toAgentOrders, type AgentGameTrace } from '../src/sim/agents-game';

const trace = (command?: unknown): AgentGameTrace => ({
  scenario: 's', name: 'S', start: '1945-04-16T05:00', hours: 0, seed: 1, fields: [], frames: [], journal: [],
  divisions: [{ id: 'su_d1', name: '35 гв. сд', side: 'su', hq: 'su_4gsk', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 },
    { id: 'de_d1', name: '303. ID', side: 'de', hq: 'de_101ak', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 }],
  hqs: [{ id: 'su_stavka', name: 'Ставка ВГК', side: 'su', echelon: 'high_command', parent: null },
    { id: 'su_8gva', name: '8 гв. А', side: 'su', echelon: 'army', parent: 'su_1bf' },
    { id: 'su_4gsk', name: '4 гв. ск', side: 'su', echelon: 'corps', parent: 'su_8gva' },
    { id: 'de_101ak', name: 'CI. AK', side: 'de', echelon: 'corps', parent: 'de_9a' }],
  documents: [
    { tick: 2, time: '1945-04-16T07:00', hq: 'su_8gva', kind: 'order', to: ['su_4gsk'], text: 'наступать', rule: 'ПУ-39 ст. 89' },
    { tick: 3, time: '1945-04-16T08:00', hq: 'de_101ak', kind: 'report', to: [], text: 'держим', rule: null },
    { tick: 27, time: '1945-04-17T08:00', hq: 'su_4gsk', kind: 'notice', to: ['su_d1'], text: 'через голову', rule: null },
  ],
  ...(command ? { command } : {}),
  game: { takeover: 0, hour: 27, over: false },
} as AgentGameTrace);

describe('состояние управления в игре на агентной модели', () => {
  it('нет раздела command — нет и вида', () => {
    expect(commandView(trace(), 'su')).toBeNull();
  });
  it('имена, время, документы только своей стороны', () => {
    const v = commandView(trace({
      mode: 'agents',
      hqs: [{ id: 'su_8gva', control: 'player', led: false }, { id: 'su_4gsk', control: 'agent', led: true }],
      led: ['su_d1'],
      requests: [{ hq: 'su_4gsk', division: 'su_d1', tick: 26, answer: null }],
      historical: [{ id: 'stavka-11059', at: 0, to: 'su_8gva', task: 'attack', form: 'order', note: 'прорвать оборону', issued: true },
        { id: 'stavka-11074', at: 30, to: 'su_8gva', task: 'attack', form: 'order', note: 'на Берлин', issued: false }],
    }), 'su')!;
    expect(v.mode).toBe('agents');
    expect(v.hqs.su_8gva).toEqual({ control: 'player', led: false, name: '8 гв. А', echelon: 'army' });
    expect(v.led).toEqual(['su_d1']);
    expect(v.requests).toEqual([{ hq: 'su_4gsk', hqName: '4 гв. ск', division: 'su_d1', divisionName: '35 гв. сд', time: '17.04 07:00', answer: null }]);
    expect(v.historical.map((h) => [h.id, h.time, h.toName, h.issued, h.due])).toEqual([['stavka-11059', '16.04 05:00', '8 гв. А', true, true], ['stavka-11074', '17.04 11:00', '8 гв. А', false, false]]);
    expect(v.documents.map((d) => [d.time, d.hqName, d.kind])).toEqual([['16.04 07:00', '8 гв. А', 'order'], ['17.04 08:00', '4 гв. ск', 'notice']]);
  });
  it('форма приказа уходит в ядро', () => {
    const o = toAgentOrders({ theatre: null } as never, { state: { formations: [] } } as never, [{ id: 'o1', formation: 'su_8gva', task: 'defend', issuedAt: '1945-04-16T05:00', source: 'human', form: 'order' }]);
    expect(o[0]).toMatchObject({ hq: 'su_8gva', kind: 'defend', form: 'order' });
  });
});
