/**
 * Очередь голоса выставочного сеанса. Голос звучит только: на входе в сцену (или пункт брифинга) — о том, что на
 * экране (`scene`); в ответ на действие посетителя (`action`); одно предупреждение таймера (`timer`). Фонового рассказа
 * нет. Начатую фразу не перебивает ничто, кроме ответа на действие. Сцена сменилась — фраза ушедшей сцены обрывается
 * (с затуханием — его делает проигрыватель), фразы ушедшей сцены из очереди выбрасываются, фразы для другой сцены
 * не принимаются. Фраза без сцены (переходная, «решаю за вас») живёт до конца. Сбой речи очередь не останавливает:
 * фраза считается сказанной, текст остаётся на экране.
 */
export type Priority = 'action' | 'timer' | 'scene';
/**
 * Фраза очереди. `scene` — ключ сцены (`sceneKey` режиссёра), к которой фраза относится; `parts` — куски склейки
 * предзаписи (заготовка с подстановками); `fallback` — заготовка на замену фразы, составленной ИИ сейчас, если
 * живой голос недоступен или не успевает.
 */
export interface Line { text: string; priority: Priority; source: string; scene?: string; parts?: string[]; fallback?: { text: string; parts?: string[] }; /** Образец живого голоса (Жуков, Конев); нет — как обычно, из предзаписи. */ voice?: string; /** Пауза после фразы, мс: между абзацами разбора. */ gapMs?: number }
export interface Speaker { speak(text: string, line?: Line): { done: Promise<void>; stop(): void } }

const RANK: Record<Priority, number> = { action: 0, timer: 1, scene: 2 };

export function voiceQueue(speaker: Speaker, o: { onLine?: (l: Line | null) => void; onDone?: (l: Line) => void } = {}) {
  let queue: Line[] = [];
  let cur: { line: Line; stop(): void } | null = null;
  let gen = 0;
  let scene: string | null = null;
  const foreign = (l: Line) => l.scene !== undefined && scene !== null && l.scene !== scene;

  const next = () => {
    const line = queue.shift() ?? null;
    cur = null;
    o.onLine?.(line);
    if (!line) return;
    const g = ++gen;
    const finish = () => {
      if (g !== gen) return;
      o.onDone?.(line);
      next();
    };
    try {
      const h = speaker.speak(line.text, line);
      cur = { line, stop: h.stop };
      h.done.then(finish, finish);
    } catch {
      queueMicrotask(finish);
    }
  };
  /** Оборвать звучащую фразу (без onDone: она не договорена). */
  const cut = () => {
    const c = cur;
    gen++;
    cur = null;
    c?.stop();
  };

  return {
    push(line: Line) {
      if (foreign(line)) return;
      // такая же фраза уже звучит или ждёт — второй раз не нужна
      if (cur?.line.text === line.text || queue.some((l) => l.text === line.text)) return;
      if (line.priority === 'action') {
        // ответ на действие — сразу: прежний ответ и звучащая фраза обрываются
        queue = queue.filter((l) => l.priority !== 'action');
        queue.unshift(line);
        if (cur) cut();
        return next();
      }
      const at = queue.findIndex((l) => RANK[l.priority] > RANK[line.priority]);
      if (at < 0) queue.push(line);
      else queue.splice(at, 0, line);
      if (!cur) next();
    },
    /** Смена сцены: фразы прежней сцены — прочь, звучащая — обрывается. */
    scene(key: string) {
      if (key === scene) return;
      scene = key;
      queue = queue.filter((l) => !foreign(l));
      if (cur && foreign(cur.line)) {
        cut();
        next();
      }
    },
    clear() {
      queue = [];
      cut();
      o.onLine?.(null);
    },
    current: () => cur?.line ?? null,
    /** Текущая сцена (ключ). */
    sceneNow: () => scene,
    busy: () => !!cur || queue.length > 0,
  };
}

/** Пора следующей фразе заставки: голос включён, очередь пуста, с начала тишины прошла пауза. */
export function attractLoopDue(o: { now: number; quietSince: number; pauseMs: number; on: boolean; busy: boolean }): boolean {
  if (!o.on || o.busy) return false;
  return o.now - o.quietSince >= o.pauseMs;
}
