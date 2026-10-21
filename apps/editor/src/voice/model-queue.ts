/**
 * Голос и очередь к языковой модели. Модель на этом компьютере одна: штаб противника, советник, разбор операции,
 * посредник и Ставка встают к ней по очереди (поток игры, game-worker.ts, exclusive), а посредник разбора хода
 * спрашивает её из окна. Голос в очереди первый: пока он ждёт или спрашивает модель, новые запросы игры не начинаются
 * (llm-hold); начатый — доходит, его не прервать. Занята — штаб говорит чем и просит подождать, освободилась — сразу
 * отвечает. Чистый модуль: занятость сообщают CommandView (поток игры) и посредник; держать очередь — CommandView.
 */

/** Чем занята модель, по источникам (поток игры, посредник окна): источник → что делает. */
const sources = new Map<string, string>();
const freeCbs = new Set<() => void>();

/** Источник занял модель (who — что делает, как в очереди игры) или отпустил (null). */
export function setModelBusy(source: string, who: string | null): void {
  if (who) sources.set(source, who);
  else sources.delete(source);
  if (!sources.size) [...freeCbs].forEach((cb) => cb());
}

/** Чем занята модель сейчас (null — свободна). */
export function modelBusy(): string | null {
  return sources.values().next().value ?? null;
}

let holder: ((on: boolean) => void) | null = null;
let holds = 0;

/**
 * Очередь игры: держать её (on) — новые запросы к модели ждут голоса, отпустить — идут дальше. Подключение, пока голос
 * держит очередь, — сразу держать. Возвращает отключение (снимает только своё).
 */
export function bindModelHold(fn: (on: boolean) => void): () => void {
  holder = fn;
  if (holds) fn(true);
  return () => { if (holder === fn) holder = null; };
}

/** Модель занята дольше этого — голос перестаёт ждать и честно говорит, что можно без неё. */
export const MODEL_WAIT_MAX_MS = 5 * 60_000;

/** Ждали модель дольше MODEL_WAIT_MAX_MS: она всё ещё занята (who). */
export class ModelBusy extends Error {
  constructor(public who: string) { super(`модель занята: ${who}`); this.name = 'ModelBusy'; }
}

/**
 * Запрос голоса к модели — первым в очереди. Модель занята — onWait(чем), ждать, пока освободится (отмена — signal;
 * дольше MODEL_WAIT_MAX_MS — ModelBusy), затем onFree() и запрос. Очередь игры держится до конца запроса.
 */
export async function withModel<T>(f: () => Promise<T>, o: { signal?: AbortSignal; onWait?(who: string): void; onFree?(): void; maxWaitMs?: number } = {}): Promise<T> {
  if (holds++ === 0) holder?.(true);
  try {
    const who = modelBusy();
    if (who) {
      o.onWait?.(who);
      await whenFree(o.signal, o.maxWaitMs ?? MODEL_WAIT_MAX_MS);
      o.onFree?.();
    }
    return await f();
  } finally {
    if (--holds === 0) holder?.(false);
  }
}

function whenFree(signal: AbortSignal | undefined, ms: number): Promise<void> {
  return new Promise<void>((res, rej) => {
    if (signal?.aborted) { rej(signal.reason); return; }
    const done = () => { freeCbs.delete(onFree); clearTimeout(t); signal?.removeEventListener('abort', onAbort); };
    const onFree = () => { done(); res(); };
    const onAbort = () => { done(); rej(signal!.reason); };
    const t = setTimeout(() => { done(); rej(new ModelBusy(modelBusy() ?? '')); }, ms);
    freeCbs.add(onFree);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!modelBusy()) onFree();
  });
}

/** Чем занята модель — словами для штаба (метки очереди игры: «решение штаба противника», «вопрос советнику»…). */
export function busyWords(who: string): string {
  const known: Record<string, string> = {
    'решение штаба противника': 'штаб противника готовит решение',
    'вопрос советнику': 'советник отвечает на вопрос',
    'варианты решения': 'советник готовит варианты решения',
    'разбор операции': 'пишется разбор операции',
    'посредник': 'посредник оценивает бои',
    'разбор хода': 'посредник готовит разбор хода',
  };
  return known[who] ?? `идёт запрос «${who}»`;
}

export const MODEL_FREE_SAY = 'Модель освободилась.';
/** Модель занята: что делает и просьба подождать. */
export const modelWaitSay = (who: string) => `Языковая модель занята — ${busyWords(who)}. Подождите, отвечу, как только она освободится.`;

/** Сбросить состояние (тесты). */
export function resetModelQueue(): void { sources.clear(); freeCbs.clear(); holder = null; holds = 0; }
