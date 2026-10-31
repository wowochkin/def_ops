/**
 * Очередь голоса выставочного сеанса: ответ на действие посетителя > предупреждение таймера > комментарий события >
 * фоновый рассказ. Голос не говорит поверх себя; новая важная фраза мягко прерывает фоновую. Пауза заполняется
 * фоновой фразой (`fill`). Сбой речи очередь не останавливает: фраза считается сказанной, текст остаётся на экране.
 */
export type Priority = 'action' | 'timer' | 'event' | 'ambient';
/**
 * Фраза очереди. `parts` — куски склейки предзаписи (заготовка с подстановками); `fallback` — заготовка на замену
 * фразы, составленной ИИ сейчас, если живой голос недоступен или не успевает.
 */
export interface Line { text: string; priority: Priority; source: string; parts?: string[]; fallback?: { text: string; parts?: string[] } }
export interface Speaker { speak(text: string, line?: Line): { done: Promise<void>; stop(): void } }

const RANK: Record<Priority, number> = { action: 0, timer: 1, event: 2, ambient: 3 };

export function voiceQueue(speaker: Speaker, o: { ambient?: () => Line | null; onLine?: (l: Line | null) => void } = {}) {
  let queue: Line[] = [];
  let cur: { line: Line; stop(): void } | null = null;
  let gen = 0;

  const next = () => {
    const line = queue.shift() ?? null;
    cur = null;
    o.onLine?.(line);
    if (!line) return;
    const g = ++gen;
    const finish = () => { if (g === gen) next(); };
    try {
      const h = speaker.speak(line.text, line);
      cur = { line, stop: h.stop };
      h.done.then(finish, finish);
    } catch {
      queueMicrotask(finish);
    }
  };

  const api = {
    push(line: Line) {
      // такая же фраза уже в очереди — второй раз не нужна
      if (queue.some((l) => l.text === line.text)) return;
      const at = queue.findIndex((l) => RANK[l.priority] > RANK[line.priority]);
      if (at < 0) queue.push(line);
      else queue.splice(at, 0, line);
      if (!cur) return next();
      if (cur.line.priority === 'ambient' && line.priority !== 'ambient') {
        queue = queue.filter((l) => l.priority !== 'ambient' || l === line);
        const c = cur;
        gen++;
        c.stop();
        next();
      }
    },
    /** Пауза: голос молчит и очередь пуста — фоновая фраза. */
    fill() {
      if (cur || queue.length) return;
      const l = o.ambient?.();
      if (l) api.push({ ...l, priority: 'ambient' });
    },
    clear() {
      queue = [];
      gen++;
      const c = cur;
      cur = null;
      c?.stop();
      o.onLine?.(null);
    },
    current: () => cur?.line ?? null,
    busy: () => !!cur || queue.length > 0,
  };
  return api;
}
