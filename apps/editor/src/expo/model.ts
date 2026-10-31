/**
 * Ход модели выставочного сеанса по эффектам режиссёра: deal — (новый сеанс модели при первом переломе или смене
 * фронта) и раздача карточек, replace — замена карточки, decide — решение и прокрутка, newSession — сброс.
 * Работа идёт по очереди; ответ устаревшего сеанса (после newSession) отбрасывается. Вид модели — в `onView`.
 */
import { BANK, type Bank } from './bank';
import type { Effect } from './director';
import { ExpoSession, type ModelEnv, type ModelView } from './session';

export interface ModelFrame { view: ModelView | null; error: string | null }

export function modelRunner(makeEnv: () => Promise<ModelEnv>, onFrame: (f: ModelFrame) => void, bank: Bank = BANK, rnd?: () => number) {
  let session: ExpoSession | null = null;
  let env: Promise<ModelEnv> | null = null;
  let gen = 0;
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
          }
          session.deal(e.n);
          publish();
        });
      }
      if (e.e === 'replace') return run(() => { if (session?.replace(e.card)) publish(); });
      if (e.e === 'decide') {
        return run(async () => {
          if (!session) return;
          session.view.busy = true;
          publish();
          await session.decide(e.n, e.choice);
          publish();
        });
      }
      return queue;
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
