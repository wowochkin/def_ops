/**
 * Очередь голоса выставочного сеанса. Голос звучит только: на входе в сцену (или пункт брифинга) — о том, что на
 * экране (`scene`); в ответ на действие посетителя (`action`); одно предупреждение таймера (`timer`). Фонового рассказа
 * нет. Начатую фразу не перебивает ничто, кроме ответа на действие и смены выбора в той же сцене (`replace`). Сцена сменилась — фраза ушедшей сцены обрывается
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
export interface Line { text: string; priority: Priority; source: string; scene?: string; parts?: string[]; fallback?: { text: string; parts?: string[] }; /** Образец живого голоса (разбор итога); нет — как обычно, из предзаписи. */ voice?: string; /** Пауза после фразы, мс: между абзацами разбора. */ gapMs?: number; /** Сменить звучащую фразу этой же сцены сразу: субтитр и предзапись, не дожидаясь конца прежней. */ replace?: boolean }
export interface Speaker { speak(text: string, line?: Line): { done: Promise<void>; stop(): void; /** Синтез закончен — следующую фразу с голосом можно готовить, пока эта ещё звучит. */ synth?: Promise<void> } }

const RANK: Record<Priority, number> = { action: 0, timer: 1, scene: 2 };

export function voiceQueue(speaker: Speaker, o: { onLine?: (l: Line | null) => void; onDone?: (l: Line) => void } = {}) {
  let queue: Line[] = [];
  let cur: { line: Line; stop(): void } | null = null;
  /** Следующая фраза уже отдана в синтез, пока звучит текущая: к её началу звук готов. */
  let ahead: { line: Line; stop(): void; done: Promise<void>; synth?: Promise<void> } | null = null;
  const waits = new Map<Line, () => void>();
  let gen = 0;
  let scene: string | null = null;
  const foreign = (l: Line) => l.scene !== undefined && scene !== null && l.scene !== scene;
  const same = (l: Line) => cur?.line.text === l.text || ahead?.line.text === l.text || queue.some((x) => x.text === l.text);

  const prefetch = () => {
    // не начинать следующую фразу, пока эта звучит: сервис на новом say обрывает текущую,
    // и из разбора доходит только каждая вторая-третья строка
  };

  const finishWait = (line: Line) => {
    const done = waits.get(line);
    if (!done) return;
    waits.delete(line);
    done();
  };
  const next = () => {
    const ready = ahead;
    ahead = null;
    const line = ready?.line ?? queue.shift() ?? null;
    cur = null;
    o.onLine?.(line);
    if (!line) return;
    const g = ++gen;
    const finish = () => {
      if (g !== gen) return;
      o.onDone?.(line);
      finishWait(line);
      next();
    };
    try {
      const h = ready ?? (() => {
        const s = speaker.speak(line.text, line);
        return { line, stop: s.stop, done: s.done, synth: s.synth };
      })();
      cur = { line, stop: h.stop };
      if (h.synth) void h.synth.then(() => { if (g === gen) prefetch(); });
      h.done.then(finish, finish);
    } catch {
      queueMicrotask(finish);
    }
  };
  /** Оборвать звучащую фразу и уже начатый синтез следующей (без onDone: они не договорены). */
  const cut = () => {
    const c = cur;
    const a = ahead;
    gen++;
    cur = null;
    ahead = null;
    if (c) finishWait(c.line);
    if (a) finishWait(a.line);
    c?.stop();
    a?.stop();
  };

  return {
    push(line: Line): Promise<void> {
      let done = () => {};
      const played = new Promise<void>((r) => { done = r; });
      const drop = () => done();
      if (foreign(line)) return drop(), played;
      // такая же фраза уже звучит или ждёт — второй раз не нужна.
      // у разбора одинаковый текст разных переломов всё равно произносится: он ещё только ждёт в очереди
      if (line.voice) {
        if (cur?.line.text === line.text || ahead?.line.text === line.text) return drop(), played;
      } else if (same(line)) return drop(), played;
      waits.set(line, done);
      if (line.replace) {
        queue = queue.filter((l) => {
          const keep = l.scene !== line.scene && l.text !== line.text;
          if (!keep) finishWait(l);
          return keep;
        });
        queue.unshift(line);
        if (cur?.line.scene === line.scene) cut();
        if (!cur) next();
        return played;
      }
      if (line.priority === 'action') {
        // разбор итога не перебивается: иначе комментарий к решению срезает хвост текста
        if (cur?.line.voice || queue.some((l) => l.voice)) {
          queue.push(line);
          if (!cur) next();
          return played;
        }
        // ответ на действие — сразу: прежний ответ и звучащая фраза обрываются
        queue = queue.filter((l) => {
          const keep = l.priority !== 'action';
          if (!keep) finishWait(l);
          return keep;
        });
        queue.unshift(line);
        if (cur) cut();
        next();
        return played;
      }
      const at = queue.findIndex((l) => RANK[l.priority] > RANK[line.priority]);
      if (at < 0) queue.push(line);
      else queue.splice(at, 0, line);
      if (!cur) next();
      return played;
    },
    /** Смена сцены: фразы прежней сцены — прочь, звучащая — обрывается. */
    scene(key: string) {
      if (key === scene) return;
      scene = key;
      queue = queue.filter((l) => {
        const keep = !foreign(l);
        if (!keep) finishWait(l);
        return keep;
      });
      if (ahead && foreign(ahead.line)) { ahead.stop(); ahead = null; }
      if (cur && foreign(cur.line)) {
        cut();
        next();
      }
    },
    clear() {
      for (const l of queue) finishWait(l);
      queue = [];
      cut();
      o.onLine?.(null);
    },
    current: () => cur?.line ?? null,
    /** Текущая сцена (ключ). */
    sceneNow: () => scene,
    busy: () => !!cur || !!ahead || queue.length > 0,
  };
}

/** Пора следующей фразе заставки: голос включён, очередь пуста, с начала тишины прошла пауза. */
export function attractLoopDue(o: { now: number; quietSince: number; pauseMs: number; on: boolean; busy: boolean }): boolean {
  if (!o.on || o.busy) return false;
  return o.now - o.quietSince >= o.pauseMs;
}

/** Заставка говорит, только пока это окно на экране и перед посетителем. Скрытое, свёрнутое или чужое окно молчит. */
export function attractShown(page: { hidden: boolean; focused: boolean }): boolean {
  return !page.hidden && page.focused;
}
