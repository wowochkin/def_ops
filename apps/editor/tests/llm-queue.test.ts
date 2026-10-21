// Очередь к модели в потоке игры: запросы по одному, окну — чем занята; голос держит очередь — следующий не начинается.
import { describe, expect, it } from 'vitest';
import { llmQueue } from '../src/sim/llm-queue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('llmQueue', () => {
  it('запросы по одному; окну — чем занята и что свободна', async () => {
    const busy: (string | null)[] = [];
    const q = llmQueue((w) => busy.push(w));
    let release!: () => void;
    const a = q.exclusive('решение штаба противника', () => new Promise<void>((r) => { release = r; }));
    const b = q.exclusive('вопрос советнику', async () => 2);
    await tick();
    expect(busy).toEqual(['решение штаба противника']);
    expect(q.busyWho()).toBe('решение штаба противника');
    release();
    await a;
    expect(await b).toBe(2);
    expect(busy).toEqual(['решение штаба противника', null, 'вопрос советнику', null]);
    expect(q.busyWho()).toBeNull();
  });

  it('голос держит очередь: начатый запрос доходит, следующий ждёт, пока голос не отпустит', async () => {
    const busy: (string | null)[] = [];
    const q = llmQueue((w) => busy.push(w));
    let release!: () => void;
    const a = q.exclusive('решение штаба противника', () => new Promise<void>((r) => { release = r; }));
    await tick();
    q.hold(true);
    let ran = false;
    const b = q.exclusive('разбор операции', async () => { ran = true; });
    release();
    await a;
    await tick();
    expect(ran).toBe(false);
    expect(q.busyWho()).toBe('голосовое управление');
    q.hold(false);
    await b;
    expect(ran).toBe(true);
    expect(busy).toEqual(['решение штаба противника', null, 'разбор операции', null]);
  });
});
