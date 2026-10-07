import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LlmClient, extractJson, splitThink } from '../src/llm/client';
import { configFromEnv } from '../src/llm/config';
import { checkDecision, DECISION_SCHEMA, type Decision } from '../src/decision';
import { fill, prompt } from '../src/prompts';
import { loadSituations, matches, promptVars, systemVars } from '../src/eval/situations';
import { runOne } from '../src/eval/run';
import { renderReport } from '../src/eval/report';

/** Подставной сервер модели: отвечает потоком SSE по сценарию из заголовка x-mode. */
let server: Server;
let url = '';
let mode = 'normal';
let lastBody: Record<string, unknown> = {};
let answer = '{}';

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const delta = (d: Record<string, string>, finish?: string) => sse({ choices: [{ delta: d, finish_reason: finish ?? null }] });

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'text-embedding-x' }, { id: 'qwen3.8-test' }] })); return; }
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      lastBody = JSON.parse(b);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const parts = answer.match(/.{1,17}/gs) ?? [];
      if (mode === 'normal') {
        res.write(delta({ reasoning_content: 'Оцениваю ' }));
        res.write(delta({ reasoning_content: 'обстановку.' }));
        for (const p of parts) res.write(delta({ content: p }));
        res.write(delta({}, 'stop'));
      } else if (mode === 'reasoning-only') {
        for (const p of parts) res.write(delta({ reasoning_content: p }));
        res.write(delta({}, 'stop'));
      } else if (mode === 'think-tags') {
        res.write(delta({ content: '<think>думаю\nдолго</think>\n```json\n' }));
        for (const p of parts) res.write(delta({ content: p }));
        res.write(delta({ content: '\n```' }, 'stop'));
      } else if (mode === 'prose-then-json') {
        // первый ответ — рассуждение прозой без JSON, повторный (с просьбой) — JSON
        const fixing = JSON.stringify(lastBody.messages).includes('Перепиши своё решение');
        if (fixing) for (const p of parts) res.write(delta({ content: p }));
        else res.write(delta({ content: 'Считаю необходимым отвести войска на вторую позицию.' }));
        res.write(delta({}, 'stop'));
      } else if (mode === 'all-in-reasoning') {
        res.write(delta({ reasoning_content: 'Черновик {"x": 1} и далее итог: ' }));
        for (const p of parts) res.write(delta({ reasoning_content: p }));
        res.write(delta({}, 'stop'));
      } else if (mode === 'length') {
        res.write(delta({ content: answer.slice(0, 20) }, 'length'));
      }
      res.write(sse({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 300 }, stats: { accepted_draft_tokens_count: 200, rejected_draft_tokens_count: 50 } }));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

const client = (thinking: 'off' | 'medium' = 'medium') => new LlmClient({ ...configFromEnv({}), url, thinking });

describe('клиент модели', () => {
  it('выбирает модель, не являющуюся эмбеддингом, и шлёт настройки Qwen', async () => {
    mode = 'normal'; answer = '{"a":1}';
    const r = await client().chat({ messages: [{ role: 'user', content: 'x' }], schema: { name: 's', schema: { type: 'object' } } });
    expect(r.model).toBe('qwen3.8-test');
    expect(r.reasoning).toBe('Оцениваю обстановку.');
    expect(r.json).toEqual({ a: 1 });
    expect(r.timings.promptTokens).toBe(1200);
    expect(r.timings.completionTokens).toBe(300);
    expect(lastBody.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(lastBody.reasoning_effort).toBe('medium');
    expect(lastBody.draft_model).toBeUndefined();
    expect(r.timings.draftAccepted).toBe(200);
    expect((lastBody.response_format as { type: string }).type).toBe('json_schema');
  });

  it('черновая модель передаётся серверу', async () => {
    mode = 'normal'; answer = '{}';
    await new LlmClient({ ...configFromEnv({ DEFOPS_LLM_DRAFT_MODEL: 'qwen3.8-27b-mtp' }), url }).chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(lastBody.draft_model).toBe('qwen3.8-27b-mtp');
  });

  it('без размышления ответ в reasoning_content считается ответом', async () => {
    mode = 'reasoning-only'; answer = '{"b":2}';
    const r = await client('off').chat({ messages: [{ role: 'user', content: 'x' }], schema: { name: 's', schema: {} } });
    expect(r.json).toEqual({ b: 2 });
    expect(lastBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(lastBody.reasoning_effort).toBeUndefined();
  });

  it('вынимает <think> и обёртку ```json', async () => {
    mode = 'think-tags'; answer = '{"c":3}';
    const r = await client().chat({ messages: [{ role: 'user', content: 'x' }], schema: { name: 's', schema: {} } });
    expect(r.json).toEqual({ c: 3 });
    expect(r.reasoning).toContain('думаю');
  });

  it('оборванный по длине ответ — ошибка разбора', async () => {
    mode = 'length'; answer = '{"d": "очень длинный ответ"}';
    const r = await client().chat({ messages: [{ role: 'user', content: 'x' }], schema: { name: 's', schema: {} } });
    expect(r.jsonError).toMatch(/предел/);
  });

  it('недоступный сервер — понятная ошибка', async () => {
    const c = new LlmClient({ ...configFromEnv({}), url: 'http://127.0.0.1:9/v1' });
    await expect(c.models()).rejects.toThrow(/не отвечает/);
  });

  it('разбор вспомогательных форматов', () => {
    expect(splitThink('<think>a</think>b')).toEqual({ content: 'b', reasoning: 'a' });
    expect(extractJson('Вот ответ: {"x": [1]} конец')).toEqual({ x: [1] });
    expect(extractJson('черновик {"a": "}"} итог {"b": 2}')).toEqual({ b: 2 });
  });
});

describe('промпты и обстановки', () => {
  it('подстановки: пропущенная и лишняя — ошибки', () => {
    expect(fill('a {x}', { x: '1' })).toBe('a 1');
    expect(() => fill('a {x}', {})).toThrow(/нет значения/);
    expect(() => fill('a', { y: '1' })).toThrow(/не используются/);
  });

  it('все контрольные обстановки разбираются и подставляются в промпт', () => {
    const list = loadSituations();
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const s of list) {
      const text = prompt('staff.user.md', promptVars(s));
      expect(prompt('staff.system.md', systemVars(s))).toContain(s.scenario.side);
      expect(text).toContain(s.question);
      for (const e of [...s.expect, ...s.avoid]) for (const p of [...(e.any ?? []), ...(e.all ?? []).flat()]) expect(() => new RegExp(p)).not.toThrow();
    }
    expect(list.every((s) => s.scenario.id === 'berlin-1945')).toBe(true);
  });

  it('схема решения — строгая (все поля обязательны)', () => {
    expect(DECISION_SCHEMA.required).toHaveLength(6);
    expect(DECISION_SCHEMA.properties.orders.items.required).toHaveLength(6);
  });
});

const s1 = () => loadSituations().find((s) => s.id.startsWith('01'))!;
const goodDecision = (): Decision => ({
  assessment: 'Противник завершил сосредоточение на кюстринском плацдарме. '.repeat(12),
  enemyIntent: 'Прорыв на Зееловские высоты и выход по шоссе № 1 к Берлину.',
  intent: 'Отвести основные силы с первой позиции на позицию «Харденберг» до артподготовки; держать подвижный резерв для контратак.',
  orders: [
    { formation: '56-й танковый корпус (LVI. Panzerkorps)', task: 'withdraw', area: 'первая позиция (главная полоса обороны) по Одербруху (Oderbruch)', toArea: 'вторая позиция «Харденберг» (Hardenberg-Stellung)', deadline: 'к 02:00 16.04', details: 'на первой позиции оставить прикрытие' },
    { formation: '11-й танковый корпус СС', task: 'defend', area: 'Лебус', toArea: null, deadline: '16.04', details: 'резерв за второй позицией для контратак' },
  ],
  requests: ['Просить передачи армии дивизий резерва ОКВ «Нордланд» и «Недерланд».'],
  risks: ['Противник может ударить ночью до отвода.'],
});

describe('проверка решения', () => {
  it('хорошее решение проходит и даёт признаки', () => {
    const s = s1();
    const { decision, issues } = checkDecision(goodDecision(), { formations: s.own_forces.map((f) => f.name), areas: s.areas });
    expect(decision).not.toBeNull();
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    const hits = Object.fromEntries(s.expect.map((e) => [e.id, matches(e, decision!)]));
    expect(hits).toEqual({ depth: true, pullback: true, reserves: true, ask: true });
    expect(s.avoid.every((e) => !matches(e, decision!))).toBe(true);
  });

  it('выдуманное формирование — ошибка, наступление на плацдарм — нежелательно', () => {
    const s = s1();
    const d = goodDecision();
    d.orders.push({ formation: '7-я танковая армия', task: 'attack', area: 'кюстринский плацдарм', toArea: null, deadline: '16.04', details: '' });
    expect(checkDecision(d, { formations: s.own_forces.map((f) => f.name), areas: s.areas }).issues.some((i) => /нет среди своих/.test(i.text))).toBe(true);
    expect(matches(s.avoid[0], d)).toBe(true);
  });

  it('«держать первую позицию любой ценой» не засчитывается как отвод', () => {
    const s = s1();
    const d = goodDecision();
    d.intent = 'Удержать первую позицию. Подготовить отвод на «Вотан» при прорыве.';
    d.orders = [{ formation: '101-й армейский корпус (CI. Armeekorps)', task: 'hold', area: 'первая позиция по Одербруху', toArea: null, deadline: '16.04', details: 'при прорыве первой позиции — отвод' }];
    const hit = (id: string) => matches(s.expect.find((e) => e.id === id)!, d);
    expect(hit('pullback')).toBe(false);
    expect(matches(s.avoid.find((e) => e.id === 'hold-first')!, d)).toBe(true);
  });

  it('JSON в конце размышления (сервер не разделил ответ) находится', async () => {
    mode = 'all-in-reasoning'; answer = JSON.stringify(goodDecision());
    const rec = await runOne(client(), s1(), 'qwen3.8-test', 'medium', 1);
    expect(rec.ok).toBe(true);
    expect(rec.jsonFromReasoning).toBe(true);
  });

  it('ответ прозой — одна попытка переписать в JSON', async () => {
    mode = 'prose-then-json'; answer = JSON.stringify(goodDecision());
    const rec = await runOne(client(), s1(), 'qwen3.8-test', 'medium', 1);
    expect(rec.ok).toBe(true);
    expect(rec.repaired).toBe(true);
    expect(lastBody.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('полный прогон обстановки через подставную модель и отчёт', async () => {
    mode = 'normal'; answer = JSON.stringify(goodDecision());
    const s = s1();
    const rec = await runOne(client(), s, 'qwen3.8-test', 'medium', 1);
    expect(rec.ok).toBe(true);
    expect(rec.expect.every((e) => e.hit)).toBe(true);
    const md = renderReport([rec], [s], { models: ['qwen3.8-test'], thinkings: ['medium'], repeat: 1, url, date: new Date() });
    expect(md).toContain('Что было в истории');
    expect(md).toContain('Оценка эксперта');
    expect(md).toContain('| qwen3.8-test | medium | 1/1 |');
  });
});

describe('ответ по частям', () => {
  it('приказы выдаются по одному, пока ответ ещё идёт', async () => {
    const { ArrayItemStream } = await import('../src/stream-json');
    const text = '<think>черновик "orders": это не JSON</think>{"intent":"Отвести {силы}","orders":[{"formation":"A","details":"с \\"кавычками\\" и } скобкой"},{"formation":"B"}],"risks":[]}';
    let fed = 0, firstAt = -1;
    const s = new ArrayItemStream<{ formation: string }>('orders', () => { if (firstAt < 0) firstAt = fed; });
    for (const ch of text.match(/.{1,5}/gs)!) { fed += ch.length; s.push(ch); }
    expect(s.items.map((x) => x.formation)).toEqual(['A', 'B']);
    // первый приказ получен до конца ответа
    expect(firstAt).toBeGreaterThan(0);
    expect(firstAt).toBeLessThan(text.length - 20);
  });

  it('строковое поле — по мере генерации, с экранированием', async () => {
    const { StringFieldStream } = await import('../src/stream-json');
    const parts: string[] = [];
    let done = '';
    const s = new StringFieldStream('intent', (d) => parts.push(d), (t) => (done = t));
    const text = '{"intent":"Отвести \\"силы\\"\\nна вторую \\u00abпозицию\\u00bb","orders":[]}';
    for (const ch of text.match(/.{1,3}/gs)!) s.push(ch);
    expect(parts.length).toBeGreaterThan(3);
    expect(done).toBe('Отвести "силы"\nна вторую «позицию»');
    expect(parts.join('')).toBe(done);
  });

  it('quickDecision: приказы — в onOrder по ходу, без размышления', async () => {
    const { quickDecision } = await import('../src/staff');
    mode = 'normal';
    answer = JSON.stringify({ intent: 'Отвести силы на «Харденберг».', orders: goodDecision().orders });
    const seen: string[] = [];
    let intent = '', streamed = '';
    const r = await quickDecision(client(), {
      messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
      onOrder: (o) => seen.push(o.formation), onIntent: (t) => (intent = t), onIntentDelta: (d) => (streamed += d),
    });
    expect(streamed).toBe(intent);
    expect(seen).toHaveLength(2);
    expect(intent).toContain('Харденберг');
    expect(r.decision?.orders).toHaveLength(2);
    expect(lastBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(JSON.stringify(lastBody.messages)).toContain('только замысел и приказы');
  });
});

describe('сравнение названий формирований', () => {
  it('разные падежи и оригинал в скобках', async () => {
    const { known } = await import('../src/decision');
    const list = ['остатки 21-й танковой дивизии (21. Panzer-Division)', '11-й танковый корпус СС (XI. SS-Panzerkorps)'];
    expect(known('21-я танковая дивизия (21. Panzer-Division)', list)).toBe(true);
    expect(known('21-я танковая дивизия', list)).toBe(true);
    expect(known('XI. SS-Panzerkorps', ['11-й танковый корпус СС (XI. SS-Panzerkorps)'])).toBe(false); // только оригинал без скобок — не угадываем
    expect(known('(XI. SS-Panzerkorps)', list)).toBe(true);
    expect(known('7-я танковая армия', list)).toBe(false);
    expect(known('20-я танковая дивизия', list)).toBe(false);
  });
});
