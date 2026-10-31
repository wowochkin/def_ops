/**
 * Ход модели выставочного сеанса по эффектам режиссёра: deal — (новый сеанс модели при первом переломе или смене
 * фронта) и раздача карточек, replace — замена карточки, decide — решение и прокрутка, newSession — сброс.
 * Работа идёт по очереди; ответ устаревшего сеанса (после newSession) отбрасывается. Вид модели — в `onView`.
 */
import { BANK, type Bank } from './bank';
import type { Effect } from './director';
import { ExpoSession, type ModelEnv, type ModelView } from './session';
import type { cardSmith } from './ai';
import type { TurnN } from './bank';
import type { AgentTrace } from '@def-ops/sim';

/** ИИ при ходе модели: карточки заранее и по замене, отклик на решение (комментарий — снаружи). */
export interface ModelHooks {
  smith?: ReturnType<typeof cardSmith>;
  want?: number;
  decided?: (s: ExpoSession, n: TurnN, choice: number | 'delay') => void;
  /** Новый ход ядра сеанса (после начала и после каждого решения) — для карты; `final` — после третьего решения. */
  traced?: (trace: AgentTrace, env: ModelEnv, s: ExpoSession, final: boolean) => void;
}

export interface ModelFrame { view: ModelView | null; error: string | null }

export function modelRunner(makeEnv: () => Promise<ModelEnv>, onFrame: (f: ModelFrame) => void, bank: Bank = BANK, rnd?: () => number, hooks: ModelHooks = {}) {
  let session: ExpoSession | null = null;
  let env: Promise<ModelEnv> | null = null;
  let gen = 0;
  const key = (n: number) => `${gen}-${session?.front}-${n}`;
  let queue: Promise<void> = Promise.resolve();
  const publish = (error: string | null = null) => onFrame({ view: session ? structuredClone(session.view) : null, error });
  const run = (f: () => Promise<void> | void) => {
    const g = gen;
    queue = queue
      .then(async () => {
        if (g === gen) await f();
      })
      .catch((e) => {
        if (g !== gen) return;
        env = null;
        publish(`Модель недоступна: ${String((e as Error)?.message ?? e)}`);
      });
    return queue;
  };
  return {
    handle(e: Effect): Promise<void> {
      if (e.e === 'newSession') {
        gen++;
        session = null;
        hooks.smith?.reset();
        publish();
        return queue;
      }
      if (e.e === 'deal') {
        return run(async () => {
          if (!session || session.front !== e.front || e.n <= session.view.decisions.length) {
            const g = gen;
            const s = new ExpoSession(await (env ??= makeEnv()), bank, e.front, rnd);
            await s.start();
            if (g !== gen) return;
            session = s;
            if (s.lastTrace) hooks.traced?.(s.lastTrace, await env!, s, false);
          }
          session.deal(e.n);
          publish();
          hooks.smith?.prefetch(key(e.n), session.cardContext(e.n), hooks.want ?? 2);
        });
      }
      if (e.e === 'replace') {
        return run(async () => {
          const s = session;
          if (!s || s.isHistorical(e.card)) return;
          const ai = (await hooks.smith?.take(key(e.n))) ?? null;
          if (s === session && s.replace(e.card, ai)) publish();
        });
      }
      if (e.e === 'decide') {
        return run(async () => {
          if (!session) return;
          session.view.busy = true;
          publish();
          await session.decide(e.n, e.choice);
          publish();
          hooks.decided?.(session, e.n, e.choice);
          if (session.lastTrace) hooks.traced?.(session.lastTrace, await env!, session, e.n === 3);
        });
      }
      return queue;
    },
    /**
     * Переигровка операции «как было» на заставку: весь ход ядра в режиме сеанса без решений посетителя. Только между
     * сеансами (идёт сеанс — null): она занимает ядро, следующий сеанс начинается с чистого мира.
     */
    history(): Promise<{ trace: AgentTrace; env: ModelEnv } | null> {
      let out: { trace: AgentTrace; env: ModelEnv } | null = null;
      return run(async () => {
        if (session) return;
        const e = await (env ??= makeEnv());
        await e.call('game_start', { scenario: bank.scenario, seed: 1, takeover: 0, player: 'su', enemy: 'intent', mode: 'intent' });
        out = { trace: (await e.call('game_turn', { orders: [], hours: bank.end })) as AgentTrace, env: e };
      }).then(() => out);
    },
    /** Дождаться конца начатой работы (для проверок). */
    idle: () => queue,
  };
}

/** Окружение модели в приложении (или в браузере с мостом к ядру): команды ядра, контекст театра и история. */
export async function coreEnv(): Promise<ModelEnv> {
  const [{ invoke }, { contextFrom }, { getData }] = await Promise.all([import('@tauri-apps/api/core'), import('@def-ops/sim'), import('../sim/userdata')]);
  const [{ ctx, history }, raw] = await Promise.all([contextFrom(getData, BANK.context), invoke<string>('read_text', { path: BANK.history })]);
  return {
    call: (cmd, args) => invoke(cmd, args),
    ctx,
    history: JSON.parse(raw),
    baseHistory: history,
    placeAt: (p) => (ctx.theatre.area(p)?.center as [number, number] | undefined) ?? null,
  };
}
