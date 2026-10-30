import { describe, expect, it } from 'vitest';
import { commandView, enemyLog, enemyPlayerText, enemyVisible, toAgentOrders, type AgentGameTrace } from '../src/sim/agents-game';

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
        { id: 'stavka-11074', at: 30, to: 'su_8gva', task: 'attack', form: 'order', note: 'на Берлин', issued: false },
        // одна директива нескольким получателям — одна строка
        { id: 'stavka-11074', at: 30, to: 'su_4gsk', task: 'attack', form: 'order', note: 'на Берлин', issued: false }],
    }), 'su')!;
    expect(v.mode).toBe('agents');
    expect(v.hqs.su_8gva).toEqual({ control: 'player', led: false, name: '8 гв. А', echelon: 'army', parent: 'su_1bf' });
    expect(v.led).toEqual(['su_d1']);
    expect(v.requests).toEqual([{ hq: 'su_4gsk', hqName: '4 гв. ск', division: 'su_d1', divisionName: '35 гв. сд', time: '17.04 07:00', answer: null }]);
    expect(v.historical.map((h) => [h.id, h.time, h.toName, h.issued, h.due])).toEqual([['stavka-11059', '16.04 05:00', '8 гв. А', true, true], ['stavka-11074', '17.04 11:00', '8 гв. А, 4 гв. ск', false, false]]);
    expect(v.documents.map((d) => [d.time, d.hqName, d.kind])).toEqual([['16.04 07:00', '8 гв. А', 'order'], ['17.04 08:00', '4 гв. ск', 'notice']]);
  });
  it('форма приказа уходит в ядро', () => {
    const o = toAgentOrders({ theatre: null } as never, { state: { formations: [] } } as never, [{ id: 'o1', formation: 'su_8gva', task: 'defend', issuedAt: '1945-04-16T05:00', source: 'human', form: 'order' }]);
    expect(o[0]).toMatchObject({ hq: 'su_8gva', kind: 'defend', form: 'order' });
  });
});

describe('журнал противника в «истории как замысле»', () => {
  const t = { ...trace({ mode: 'intent', hqs: [], led: [], requests: [], historical: [],
      enemyRequests: [{ hq: 'de_101ak', division: 'de_d1', tick: 3, answer: true }] }),
    journal: [{ tick: 4, time: '1945-04-16T09:00', agent: 'de_d1', text: 'оборона → отступление' }],
    commanders: [{ hq: 'de_101ak', side: 'de', name: 'Буссе', decisions: [{ tick: 3, trigger: 'цикл', chosen: 0, why: 'держать рубеж', options: [{ kind: 'hold', label: 'Держать' }] }] }],
  } as never;
  it('документы, решения командующих, отходы, запросы и ответы противника — за ход, по времени', () => {
    const log = enemyLog(t, 'su', 0, 27);
    expect(log.map((e) => e.kind)).toEqual(['document', 'decision', 'request', 'answer', 'withdraw']);
    expect(log.every((e) => e.hq.startsWith('de_'))).toBe(true);
    expect(log.find((e) => e.kind === 'document')!.divisions).toEqual(['de_d1']);
  });
  it('приказы штабов без документов (по истории) — из журнала дивизий, один приказ — одной записью', () => {
    const j = { ...trace(), divisions: [...trace().divisions, { id: 'de_d2', name: '9. FJD', side: 'de', hq: 'de_101ak', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 }],
      journal: [
        { tick: 5, time: '1945-04-16T10:00', agent: 'de_d1', text: 'получен приказ «наступать» от штаба «CI. AK»: контратака у Зелова [de_d1@1945-04-16T10:00:counterattack]' },
        { tick: 5, time: '1945-04-16T10:00', agent: 'de_d2', text: 'получен приказ «наступать» от штаба «CI. AK»: контратака у Зелова [de_d2@1945-04-16T10:00:counterattack]' },
        { tick: 5, time: '1945-04-16T10:00', agent: 'su_d1', text: 'получен приказ «наступать» от штаба «4 гв. ск»: вперёд' },
      ], documents: [] } as never;
    const log = enemyLog(j, 'su', 0, 27);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'order', hq: 'de_101ak', divisions: ['de_d1', 'de_d2'], text: '16.04 10:00 CI. AK · приказ «наступать» — 303. ID, 9. FJD: контратака у Зелова' });
  });
  it('игроку — только наблюдаемое (отход видимой дивизии); документы, решения, запросы и ответы — только посреднику', () => {
    const log = enemyLog(t, 'su', 0, 27);
    expect(log.filter((e) => enemyVisible(e, new Set()))).toEqual([]);
    expect(log.filter((e) => enemyVisible(e, new Set(['de_d1']))).map((e) => e.kind)).toEqual(['withdraw']);
  });
  it('две дивизии одного штаба, видна одна: игроку — только её приказ и отход, без имён невидимой и без документов штаба', () => {
    const j = { ...trace({ mode: 'intent', hqs: [], led: [], requests: [], historical: [],
        enemyRequests: [{ hq: 'de_101ak', division: 'de_d2', tick: 6, answer: false, answeredAt: 7 }] }),
      divisions: [...trace().divisions, { id: 'de_d2', name: '9. FJD', side: 'de', hq: 'de_101ak', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 }],
      journal: [
        { tick: 5, time: '1945-04-16T10:00', agent: 'de_d1', text: 'получен приказ «наступать» от штаба «CI. AK»: контратака у Зелова' },
        { tick: 5, time: '1945-04-16T10:00', agent: 'de_d2', text: 'получен приказ «наступать» от штаба «CI. AK»: контратака у Зелова' },
        { tick: 8, time: '1945-04-16T13:00', agent: 'de_d1', text: 'оборона → отступление' },
        { tick: 8, time: '1945-04-16T13:00', agent: 'de_d2', text: 'оборона → отступление' },
      ],
      commanders: [{ hq: 'de_101ak', side: 'de', name: 'Буссе', decisions: [{ tick: 4, trigger: 'цикл', chosen: 0, why: 'держать рубеж', options: [{ kind: 'hold', label: 'Держать' }] }] }],
    } as never;
    const log = enemyLog(j, 'su', 0, 27);
    const seen = new Set(['de_d1']);
    const player = log.map((e) => enemyPlayerText(e, seen)).filter((x): x is string => x !== null);
    expect(player).toEqual(['16.04 10:00 303. ID: переходит к задаче «наступать»', '16.04 13:00 303. ID: оборона → отступление']);
    expect(player.join(' ')).not.toMatch(/9\. FJD|CI\. AK|Буссе|держать рубеж|запрос|отказано/);
    // посреднику — всё: донесение штаба, решение, приказ обоим получателям, запрос, ответ, оба отхода
    expect(log.map((e) => e.kind)).toEqual(['document', 'decision', 'order', 'request', 'answer', 'withdraw', 'withdraw']);
    expect(log.find((e) => e.kind === 'order')!.text).toContain('303. ID, 9. FJD');
  });
  it('директивы верховного командования противника — посреднику', () => {
    const j = { ...trace({ mode: 'intent', hqs: [], led: [], requests: [], historical: [],
        enemyHistorical: [{ id: 'hitler-1504', at: 2, to: 'de_101ak', task: 'defend', form: 'order', note: 'держать фронт на Одере' }] }),
      hqs: [...trace().hqs, { id: 'de_hc', name: 'Верховное командование', side: 'de', echelon: 'high_command', parent: null }] } as never;
    const log = enemyLog(j, 'su', 0, 27).filter((e) => e.hq === 'de_hc');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'decision', divisions: ['de_d1'] });
    expect(log[0].text).toBe('16.04 07:00 Верховное командование · директива hitler-1504 — CI. AK: оборонять — держать фронт на Одере');
    expect(enemyPlayerText(log[0], new Set(['de_d1']))).toBeNull();
  });
});

describe('режим «Командующие» в переигровке', () => {
  it('commanders — вариант «Советские штабы»; по умолчанию — «История как замысел»', async () => {
    const { AGENT_COMMANDS, DEFAULT_AGENT_COMMAND } = await import('../src/sim/agent-scenarios');
    expect(AGENT_COMMANDS.map((c) => c.id)).toContain('commanders');
    expect(AGENT_COMMANDS.find((c) => c.id === 'commanders')?.title).toBe('Командующие');
    expect(DEFAULT_AGENT_COMMAND).toBe('intent');
    expect(AGENT_COMMANDS[0]).toMatchObject({ id: 'intent', title: 'История как замысел' });
  });
});

describe('умолчания «История как замысел»', () => {
  it('режим игры и противник по умолчанию — intent', async () => {
    const { savedGameMode, defaultEnemy } = await import('../src/command-forms');
    expect(savedGameMode()).toBe('intent');
    expect(defaultEnemy(true, false)).toBe('intent');
    expect(defaultEnemy(false, false)).toBe('llm');
    expect(defaultEnemy(false, true)).toBe('passive');
  });
});
