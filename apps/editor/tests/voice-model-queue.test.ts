// Голос — первым в очереди к языковой модели: занята (штаб противника, советник, разбор) — штаб говорит чем и просит
// подождать, освободилась — сразу отвечает; очередь игры держится, пока голос ждёт и спрашивает.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register, type Action } from '../src/voice/registry';
import { Dispatcher } from '../src/voice/dispatch';
import { bindModelHold, MODEL_FREE_SAY, MODEL_WAIT_MAX_MS, ModelBusy, modelBusy, modelWaitSay, resetModelQueue, setModelBusy, withModel } from '../src/voice/model-queue';
import type { ModelReply } from '../src/voice/llm';

let holds: boolean[] = [];
beforeEach(() => { resetModelQueue(); holds = []; bindModelHold((on) => holds.push(on)); });
afterEach(() => { resetModelQueue(); vi.useRealTimers(); });

describe('model-queue', () => {
  it('свободна — запрос сразу; очередь игры держится только на время запроса', async () => {
    const onWait = vi.fn();
    expect(await withModel(async () => { expect(holds).toEqual([true]); return 7; }, { onWait })).toBe(7);
    expect(holds).toEqual([true, false]);
    expect(onWait).not.toHaveBeenCalled();
  });

  it('занята — onWait(чем), очередь держится сразу (следующий запрос игры — после голоса), освободилась — onFree и запрос', async () => {
    setModelBusy('game', 'решение штаба противника');
    const seen: string[] = [];
    const p = withModel(async () => { seen.push('запрос'); return 1; }, { onWait: (w) => seen.push(`ждёт: ${w}`), onFree: () => seen.push('свободна') });
    await Promise.resolve();
    expect(holds).toEqual([true]);
    expect(seen).toEqual(['ждёт: решение штаба противника']);
    setModelBusy('game', null);
    expect(await p).toBe(1);
    expect(seen).toEqual(['ждёт: решение штаба противника', 'свободна', 'запрос']);
    expect(holds).toEqual([true, false]);
  });

  it('занята двумя источниками — ждёт, пока освободятся оба', async () => {
    setModelBusy('game', 'вопрос советнику');
    setModelBusy('umpire', 'разбор хода');
    let ran = false;
    const p = withModel(async () => { ran = true; });
    setModelBusy('game', null);
    await Promise.resolve();
    expect(ran).toBe(false);
    expect(modelBusy()).toBe('разбор хода');
    setModelBusy('umpire', null);
    await p;
    expect(ran).toBe(true);
  });

  it('отмена (новая реплика) — ожидание кончается, очередь отпускается', async () => {
    setModelBusy('game', 'разбор операции');
    const ac = new AbortController();
    const p = withModel(async () => 1, { signal: ac.signal });
    ac.abort(new Error('новая реплика'));
    await expect(p).rejects.toThrow('новая реплика');
    expect(holds).toEqual([true, false]);
  });

  it('занята дольше MODEL_WAIT_MAX_MS — ModelBusy', async () => {
    vi.useFakeTimers();
    setModelBusy('game', 'варианты решения');
    const p = withModel(async () => 1);
    const r = expect(p).rejects.toBeInstanceOf(ModelBusy);
    await vi.advanceTimersByTimeAsync(MODEL_WAIT_MAX_MS);
    await r;
    expect(holds).toEqual([true, false]);
  });

  it('очередь игры подключилась, пока голос её держит, — сразу держится', async () => {
    setModelBusy('game', 'посредник');
    const p = withModel(async () => 1);
    const later: boolean[] = [];
    bindModelHold((on) => later.push(on));
    expect(later).toEqual([true]);
    setModelBusy('game', null);
    await p;
    expect(later).toEqual([true, false]);
  });
});

describe('разборщик ждёт занятую модель', () => {
  let said: string[] = [];
  let offs: (() => void)[] = [];
  beforeEach(() => {
    said = [];
    offs = [register({ id: 'x.noop', section: 'global', title: 'x', describe: '', available: () => true, run: async () => undefined } as Action)];
  });
  afterEach(() => offs.forEach((o) => o()));
  type Hook = NonNullable<ConstructorParameters<typeof Dispatcher>[0]['model']>;
  const mk = (model: Hook) => new Dispatcher({ now: () => 0, say: (s) => said.push(s), section: () => 'editor', model });

  it('штаб противника занял модель — «занята, подождите», освободилась — «Модель освободилась» и ответ', async () => {
    setModelBusy('game', 'решение штаба противника');
    const m = vi.fn(async (): Promise<ModelReply> => ({ say: 'Обстановка спокойная.' }));
    const p = mk(m).utterance('штаб, как там дела вообще', 1);
    await vi.waitFor(() => expect(said).toEqual([modelWaitSay('решение штаба противника')]));
    expect(said[0]).toBe('Языковая модель занята — штаб противника готовит решение. Подождите, отвечу, как только она освободится.');
    expect(m).not.toHaveBeenCalled();
    setModelBusy('game', null);
    expect(await p).toBe('done');
    expect(said).toEqual([said[0], MODEL_FREE_SAY, 'Обстановка спокойная.']);
  });

  it('ждали слишком долго — честно, что модель занята, без «связи нет»; следующая реплика снова ждёт модель', async () => {
    vi.useFakeTimers();
    setModelBusy('game', 'разбор операции');
    const m = vi.fn(async (): Promise<ModelReply> => ({ say: 'Есть.' }));
    const d = mk(m);
    const p = d.utterance('штаб, что там у нас', 1);
    await vi.advanceTimersByTimeAsync(MODEL_WAIT_MAX_MS);
    expect(await p).toBe('unknown');
    expect(said[1]).toMatch(/^Модель всё ещё занята — пишется разбор операции\. Пока можно сказать, например: «/);
    setModelBusy('game', null);
    expect(await d.utterance('штаб, а теперь что', 2)).toBe('done');
    expect(said.at(-1)).toBe('Есть.');
  });
});
