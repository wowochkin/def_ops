/**
 * Запросы к модели — по очереди: локальный сервер (особенно MLX) параллельные запросы к одной модели часто не держит
 * (ошибка 500). Штаб противника, советник, посредник, Ставка и разбор операции ждут друг друга; onBusy — чем модель
 * занята (окну — llm-busy, голос по нему ждёт). Голос — первым: пока окно держит очередь (hold), очередной запрос не
 * начинается; начатый доходит.
 */
export function llmQueue(onBusy: (who: string | null) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  let busy: string | null = null;
  let held = false;
  let waiting: (() => void)[] = [];
  return {
    exclusive<T>(who: string, f: () => Promise<T>): Promise<T> {
      const run = async () => {
        while (held) await new Promise<void>((r) => waiting.push(r));
        busy = who;
        onBusy(who);
        try { return await f(); } finally { busy = null; onBusy(null); }
      };
      const r = tail.then(run, run);
      tail = r.catch(() => undefined);
      return r;
    },
    /** Голос ждёт модель или спрашивает её (on) / отпустил. */
    hold(on: boolean): void {
      held = on;
      if (on) return;
      const w = waiting;
      waiting = [];
      w.forEach((f) => f());
    },
    /** Кто держит модель для ожидающих: запрос очереди или голос (null — свободна). */
    busyWho: (): string | null => busy ?? (held ? 'голосовое управление' : null),
  };
}
