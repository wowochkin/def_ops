import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ModelFragment } from '@def-ops/knowledge';
import { askModel, type AssistDeps } from '../src/modeling/assistant';
import type { LlmSettings } from '../src/sim/game-protocol';

const all = JSON.parse(readFileSync(new URL('../../../packages/knowledge/data/model-index.json', import.meta.url), 'utf8')) as ModelFragment[];
const llm = { url: 'http://x', model: 'm', thinking: 'off' } as LlmSettings;

/** Подменённая модель: ответы по очереди, запросы запоминаются. */
function deps(answers: (string | Error)[]) {
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const d: AssistDeps = {
    load: async () => all,
    chat: () => async (req) => {
      calls.push(req as never);
      const a = answers.shift() ?? 'пусто';
      if (a instanceof Error) throw a;
      req.onDelta?.('content', a);
      return { content: a, reasoning: '' };
    },
  };
  return { d, calls };
}

describe('ассистент модели: поток', () => {
  it('ответ сразу — один запрос, источники найдены', async () => {
    const { d, calls } = deps(['Сила стороны — сумма потенциалов [1].']);
    const stages: string[] = [];
    const r = await askModel('Как считается исход боя?', llm, [], (v) => stages.push(v.stage), undefined, d);
    expect(calls).toHaveLength(1);
    expect(r.text).toContain('[1]');
    expect(r.sources.length).toBeGreaterThan(0);
    expect(stages[0]).toBe('search');
    expect(r.extra).toEqual([]);
  });
  it('дозапрос: второй запрос с добавленным фрагментом, без правила дозапроса', async () => {
    const fn = all.find((x) => x.kind === 'code' && x.title === 'Combat') ?? all.find((x) => x.kind === 'code')!;
    const { d, calls } = deps([`НУЖНО: ${fn.title}`, 'Окончательно [2].']);
    const stages: string[] = [];
    const r = await askModel('Что такое формула Дюпюи?', llm, [], (v) => stages.push(v.stage), undefined, d);
    expect(calls).toHaveLength(2);
    expect(stages).toContain('need');
    expect(r.need).toEqual([fn.title]);
    expect(r.extra.map((x) => x.id).concat(r.sources.map((x) => x.id))).toContain(fn.id);
    expect(calls[1].messages[0].content).not.toContain('НУЖНО');
    expect(calls[1].messages.at(-1)!.content).toContain(fn.title);
    expect(r.text).toBe('Окончательно [2].');
  });
  it('неизвестное имя и повторная просьба — окончательный ответ без зацикливания', async () => {
    const { d, calls } = deps(['НУЖНО: нет_такой_функции', 'НУЖНО: ещё_одна\nНо вот ответ.']);
    const r = await askModel('Как считается бой?', llm, [], () => {}, undefined, d);
    expect(calls).toHaveLength(2);
    expect(r.extra).toEqual([]);
    expect(r.text).toBe('Но вот ответ.');
  });
  it('сервер недоступен — ошибка понятная, найденные фрагменты есть', async () => {
    const { d } = deps([new TypeError('Failed to fetch')]);
    const r = await askModel('Как считается исход боя?', llm, [], () => {}, undefined, d);
    expect(r.error).toMatch(/сервер моделей недоступен/);
    expect(r.sources.length).toBeGreaterThan(0);
  });
});
