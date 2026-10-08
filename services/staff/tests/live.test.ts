import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadContext } from '@def-ops/sim/data';
import { playTurn, startGame } from '@def-ops/sim';
import { buildSituation, decideTurn, decisionToOrders, type LiveConfig } from '../src/live';
import { mockDecision, startMockServer } from '../src/live/mock';
import { LlmClient } from '../src/llm/client';
import { configFromEnv } from '../src/llm/config';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tpl = { system: read('prompts/staff.system.md'), user: read('prompts/staff.live.md'), profile: read('profiles/wehrmacht-1945.md') };
const cfg = JSON.parse(read('live/berlin-1945-tasks.json')) as LiveConfig;

let server: Server;
let url = '';
beforeAll(async () => { server = await startMockServer(0, '127.0.0.1', 0); url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`; });
afterAll(() => server.close());

describe('штаб модели в игре', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const g = startGame(ctx, 1, '1945-04-19T05:00');

  it('обстановка из расчёта: свои силы, противник в пределах разведки, пункты, сводка за сутки', () => {
    const sit = buildSituation(ctx, g, cfg, tpl);
    const u = sit.messages[1].content;
    expect(sit.messages[0].content).toContain('Германия (вермахт)');
    expect(u).toContain('утро 19 апреля 1945 года, 05:00');
    expect(u).toContain('9-я парашютная дивизия');
    expect(u).toMatch(/8-я гвардейская армия — .*; оценка: до/);
    expect(u).toMatch(/км к (С|СВ|В|ЮВ|Ю|ЮЗ|З|СЗ) от Берлина/);
    expect(u).not.toMatch(/\{[a-z_]+\}/);
    expect(sit.formations.every((f) => f.id.startsWith('de_'))).toBe(true);
    expect(sit.enemies.length).toBeGreaterThan(3);
  });

  it('решение → приказы: названия сопоставляются, неопознанное отбрасывается с замечанием', () => {
    const sit = buildSituation(ctx, g, cfg, tpl);
    const area = sit.areas[0].title;
    const r = decisionToOrders({
      orders: [
        { formation: '9-я парашютная дивизия (9. Fallschirmjäger-Division)', task: 'hold', area, toArea: null, deadline: '', details: 'держать' },
        { formation: 'Танковая дивизия Мюнхеберг', task: 'counterattack', area: sit.enemies[0].name, toArea: null, deadline: '', details: '' },
        { formation: '999-я дивизия', task: 'defend', area, toArea: null, deadline: '', details: '' },
        { formation: '18-я танко-гренадерская дивизия', task: 'withdraw', area, toArea: 'Нигде', deadline: '', details: '' },
      ],
    }, sit);
    expect(r.orders.map((o) => o.formation)).toEqual(['de_9fjd', 'de_muencheberg']);
    expect(r.orders[1].target).toEqual({ formation: sit.enemies[0].id });
    expect(r.issues.filter((i) => i.level === 'error').length).toBe(2);
  });

  it('ход модели через сервер (подставная модель): приказы исполняются арбитром после задержки', async () => {
    const sit = buildSituation(ctx, g, cfg, tpl);
    expect(mockDecision(sit.messages[1].content).orders.length).toBeGreaterThan(0);
    const client = new LlmClient({ ...configFromEnv({}), url, thinking: 'off' });
    const t = await decideTurn(client, sit);
    expect(t.ok).toBe(true);
    expect(t.orders.length).toBeGreaterThan(0);
    const next = playTurn(ctx, g, t.orders);
    const got = next.state.formations.filter((f) => f.order?.source === 'llm');
    expect(got.length).toBe(t.orders.length);
  }, 60000);
});

describe('советник штаба человека', () => {
  it('обстановка своей стороны, правила арбитра из чисел движка, предложения приказов сопоставляются', async () => {
    const { advise, buildAdvice, rulesBrief, ADVICE_TREE } = await import('../src/live');
    expect(ADVICE_TREE.length).toBe(8);
    expect(ADVICE_TREE.every((c) => (c.children ?? []).length >= 3)).toBe(true);
    const { loadHistory } = await import('@def-ops/sim/data');
    const ctx = loadContext('berlin-1945-tasks');
    const g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    const live = JSON.parse(read('live/berlin-1945-tasks.json'));
    const tplA = { system: read('prompts/advisor.system.md'), user: read('prompts/advisor.user.md'), profile: read('profiles/rkka-1945.md') };
    expect(rulesBrief(ctx, 'su')).toMatch(/армии — 6 ч/);
    const built = buildAdvice(ctx, g, loadHistory('berlin-1945-tasks'), live.advisor, tplA,
      { category: 'history', question: 'Как развивались события в эти дни в истории?', draft: 'Решение: удар на Берлин', goal: 'Знамя Победы над рейхстагом', thread: [{ q: 'Привет', a: 'Здравствуйте' }] }, live.description);
    const u = built.messages[built.messages.length - 1].content;
    expect(u).toContain('8-я гвардейская армия');
    expect(u).toContain('резерв Ставки');
    expect(u).toMatch(/в истории 19\.04; в игре/);
    expect(built.messages.length).toBe(4);
    expect(u).not.toContain('Справка из базы знаний');
    const withRef = buildAdvice(ctx, g, loadHistory('berlin-1945-tasks'), live.advisor, tplA,
      { category: 'actions', question: 'Как штурмовать город?', draft: '', goal: 'Знамя', thread: [], reference: '- [База знаний: Штурмовые группы] состав и действия' }, live.description);
    expect(withRef.messages[withRef.messages.length - 1].content).toMatch(/Справка из базы знаний[^\n]*\n- \[База знаний: Штурмовые группы\]/);
    const client = new LlmClient({ ...configFromEnv({}), url, thinking: 'off' });
    let streamed = '';
    const r = await advise(client, g, built, { onAnswer: (d) => { streamed += d; } });
    expect(r.ok).toBe(true);
    expect(streamed).toBe(r.answer);
    expect(r.followUps.length).toBeGreaterThan(0);
    expect(r.suggestions[0].order?.formation).toMatch(/^su_/);
  }, 60000);
});

describe('советник: без выдумок и без скрытых сведений', () => {
  it('в обстановке советника нет противника вне разведки; ответ с таким соединением переписывается, иначе — предупреждение', async () => {
    const { advise, buildAdvice, leakedNames } = await import('../src/live');
    const { loadHistory } = await import('@def-ops/sim/data');
    const ctx = loadContext('berlin-1945-tasks');
    const g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    const live = JSON.parse(read('live/berlin-1945-tasks.json'));
    const tplA = { system: read('prompts/advisor.system.md'), user: read('prompts/advisor.user.md'), profile: read('profiles/rkka-1945.md') };
    const built = buildAdvice(ctx, g, loadHistory('berlin-1945-tasks'), live.advisor, tplA,
      { category: 'enemy', question: 'Где сейчас LVI танковый корпус и что задумал противник?', draft: '', goal: 'Знамя Победы', thread: [] }, live.description);
    const prompt = built.messages.map((m) => m.content).join('\n');
    // скрытые соединения (вне разведки) в промпт не попадают
    expect(built.hidden.length).toBeGreaterThan(3);
    for (const h of built.hidden) expect(leakedNames(prompt.split('Свои силы')[1] ?? '', [h]).length, h.name).toBe(0);
    // ложных срабатываний на город нет: «Мюнхеберг» в кавычках — дивизия, без кавычек — город
    const mun = built.hidden.filter((h) => h.name.includes('Мюнхеберг'));
    if (mun.length) {
      expect(leakedNames('Наступать на Мюнхеберг', mun)).toEqual([]);
      expect(leakedNames('Дивизия "Мюнхеберг" отходит', mun).length).toBe(1);
    }
    // ответ, называющий скрытое соединение: модель просят переписать (подставная модель отвечает без него)
    const hiddenName = built.hidden[0].name;
    let calls = 0;
    const fake = { config: { model: 'fake' }, chat: async (req: { messages: { role: string; content: string }[] }) => {
      calls++;
      const fixing = req.messages.some((m) => m.content.includes('Перепиши ответ'));
      const answer = fixing ? 'Сведений о скрытых резервах противника нет; нужна разведка.' : `Противник: ${hiddenName} стоит у Берлина.`;
      return { model: 'fake', content: '', reasoning: '', json: { answer, basis: ['разведка'], unknowns: [], suggestions: [], followUps: [] }, timings: { firstTokenMs: 0, totalMs: 1 } };
    } } as unknown as LlmClient;
    const r = await advise(fake, g, built);
    expect(calls).toBe(2);
    expect(r.rewritten).toBe(true);
    expect(r.warning).toBeUndefined();
    expect(r.answer).toContain('Сведений');
  }, 60000);
});

describe('штаб модели ведёт тыл, переправы, резервы', () => {
  it('распоряжения модели сопоставляются с обстановкой и проверяются правилами арбитра', async () => {
    const { actionsToStaff } = await import('../src/live');
    const ctx = loadContext('berlin-1945-tasks');
    const g = startGame(ctx, 1, '1945-04-19T05:00', 'su', 'de');
    const sit = buildSituation(ctx, g, cfg, tpl, null, true);
    expect(sit.messages[1].content).toContain('поле actions (может быть пустым)');
    expect(sit.staff!.bases.length).toBeGreaterThan(3);
    const bridgeArea = sit.areas.find((a) => /Seelow|Muencheberg|Buckow|Wriezen|Bad Freienwalde/.test(a.title))?.title ?? sit.areas[0].title;
    const r = actionsToStaff(ctx, g, sit, [
      { kind: 'priority', subject: null, area: null, formations: [sit.formations[0].name, sit.formations[1].name] },
      { kind: 'base', subject: sit.staff!.bases[0].name, area: 'Нигде', formations: [] },
      { kind: 'demolish', subject: null, area: bridgeArea, formations: [] },
      { kind: 'commit', subject: 'Несуществующий корпус', area: sit.areas[0].title, formations: [] },
    ]);
    expect(r.applied[0].action?.kind).toBe('priority');
    expect(r.applied[1].action).toBeNull();
    expect(r.applied[1].text).toMatch(/не опознан/);
    expect(r.applied[3].text).toMatch(/нет среди резервов/);
    expect(r.applied.every((x) => x.text.length > 0)).toBe(true);
    // через подставную модель: решение с полем actions
    const client = new LlmClient({ ...configFromEnv({}), url, thinking: 'off' });
    const t = await decideTurn(client, sit);
    expect(t.ok).toBe(true);
    expect(Array.isArray(t.decision!.actions)).toBe(true);
  }, 60000);
});

describe('эмбеддинги для базы знаний', () => {
  it('векторы приходят по порядку входа; самопроверка отличает перефразировку от постороннего', async () => {
    const { docText, queryText, SELF_TEST, selfTestGap, toVec } = await import('@def-ops/knowledge');
    const client = new LlmClient({ ...configFromEnv({}), url });
    const o = { dims: 256, eos: true };
    const [q, a, b] = (await client.embed([queryText(SELF_TEST.query, o), docText(SELF_TEST.close, o), docText(SELF_TEST.far, o)], 'text-embedding-qwen3-embedding-0.6b')).map((v) => toVec(v, o.dims));
    expect(q.length).toBe(256);
    expect(selfTestGap(q, a, b)).toBeGreaterThan(0.05);
    expect(await client.resolveModel()).toBe('mock-staff'); // модель эмбеддингов не берётся для ответов
  });
});

describe('посредник на модели', () => {
  it('ожидаемые бои, проверка поправок (пределы, обоснование), поправки от модели в расчёте хода', async () => {
    const { predictEngagements, umpireMods, umpireQueries, umpireTurn } = await import('../src/live');
    const { runScenarioWith } = await import('@def-ops/sim');
    const ctx = loadContext('berlin-1945-tasks');
    const g = startGame(ctx, 1, '1945-04-17T05:00');
    const es = predictEngagements(ctx, g.state);
    expect(es.length).toBeGreaterThan(2);
    expect(es[0].attackers.length).toBeGreaterThan(0);
    expect(umpireQueries(es).some((q) => /укреплённой полосы/.test(q))).toBe(true);
    const refs = [{ id: 'org:su-other', title: 'Прочие нормативы', text: 'туман в пойме Одера 15–16.04' }];
    const v = umpireMods({ mods: [
      { engagement: 1, factor: 'pace', mult: 0.5, reason: 'туман', basis: ['R1'] },
      { engagement: 1, factor: 'defense', mult: 1.2, reason: 'без опоры', basis: [] },
      { engagement: 99, factor: 'pace', mult: 0.9, reason: 'нет такого боя', basis: ['обстановка'] },
      { engagement: 2, factor: 'defenderLoss', mult: 1.1, reason: 'фольксштурм', basis: ['обстановка'] },
    ] }, es, refs);
    expect(v.mods.map((m) => [m.factor, m.mult, m.basis[0]])).toEqual([['pace', 0.8, 'org:su-other'], ['defenderLoss', 1.1, 'обстановка']]);
    expect(v.mods[1].formations).toEqual(es[1].defenders.map((f) => f.id));
    expect(v.issues.length).toBe(3);
    const tpl = { system: read('prompts/umpire.system.md'), user: read('prompts/umpire.user.md') };
    const client = new LlmClient({ ...configFromEnv({}), url, thinking: 'off' });
    const r = await runScenarioWith(ctx, 1, async (s) => (await umpireTurn(client, ctx, s, async () => refs, tpl)).mods, 2);
    expect(r.umpire.length).toBeGreaterThan(0);
    const factors = r.final.journal.filter((j) => j.kind === 'combat').flatMap((j) => j.factors.map((f) => f.name));
    expect(factors.some((n) => n.startsWith('посредник:'))).toBe(true);
  }, 120000);
});
