/**
 * Справка из базы знаний для потока игры. База со слоем пользователя, закреплениями и смысловым поиском живёт в окне:
 * поток просит справку сообщением kbRef и ждёт kbRefResult не дольше KB_REF_TIMEOUT_MS. Окно не ответило или ответило
 * ошибкой — справка по встроенному сиду (без слоя пользователя), ответ помечен fallback; запоздалый ответ окна
 * отбрасывается.
 */
import { doctrineFor, Index, roleReference, type DoctrineClaim, type DoctrineRule, type DoctrineTrigger, type Entry, type RoleRef, type RoleScope } from '@def-ops/knowledge';

export interface KbRefRequest {
  queries: string[];
  scope: RoleScope;
  limit?: number;
  chars?: number;
  doctrine?: { side: 'su' | 'de'; triggers: DoctrineTrigger[]; query: string; levels?: DoctrineClaim['level'][] };
}
export interface KbRefAnswer { refs: RoleRef[]; text: string; doctrine?: { rules: DoctrineRule[]; text: string } }

/** Сколько поток ждёт справку от окна. */
export const KB_REF_TIMEOUT_MS = 8000;
/** Пределы справки по умолчанию: 5 записей по 700 знаков. */
export const KB_REF_LIMIT = 5;
export const KB_REF_CHARS = 700;

/**
 * Штабу, Ставке и посреднику справка — только на момент хода: без момента фильтр роли не отсекает будущее
 * (записи с началом позже хода), поэтому такой запрос — ошибка вызывающего.
 */
export function checkScope(scope: RoleScope): void {
  if ((scope.role === 'staff' || scope.role === 'stavka' || scope.role === 'umpire') && !scope.moment)
    throw new Error(`справка роли «${scope.role}» без момента хода`);
}

type Reply = { id: number; ok: boolean; answer?: KbRefAnswer; error?: string };

/**
 * Клиент справки в потоке: request — сообщение окну и ожидание ответа до timeoutMs, иначе запасной путь (fallback);
 * receive — ответ окна. Каждый запрос разрешается один раз: после срока или ошибки ответ окна игнорируется, ответ с
 * неизвестным id — тоже.
 */
export function kbRefClient(post: (m: { kind: 'kbRef'; id: number; req: KbRefRequest }) => void, fallback: (req: KbRefRequest) => Promise<KbRefAnswer>,
  timeoutMs = KB_REF_TIMEOUT_MS): { request(req: KbRefRequest): Promise<KbRefAnswer & { fallback?: true }>; receive(m: Reply): void } {
  let next = 0;
  const pending = new Map<number, (m: Reply | null) => void>();
  return {
    request(req) {
      checkScope(req.scope);
      const id = ++next;
      return new Promise((resolve, reject) => {
        const viaSeed = () => { fallback(req).then((a) => resolve({ ...a, fallback: true }), reject); };
        const timer = setTimeout(() => pending.get(id)?.(null), timeoutMs);
        pending.set(id, (m) => {
          pending.delete(id);
          clearTimeout(timer);
          if (m?.ok && m.answer) resolve(m.answer); else viaSeed();
        });
        try { post({ kind: 'kbRef', id, req }); } catch { pending.get(id)?.(null); }
      });
    },
    receive(m) { pending.get(m.id)?.(m); },
  };
}

const indexes = new WeakMap<Entry[], { index: Index; byId: Map<string, Entry> }>();
/**
 * Справка по сиду (запасной путь): справка роли по индексу записей без готовой выдачи поиска (только слова) и
 * доктрина без закреплений.
 */
export function seedAnswer(entries: Entry[], req: KbRefRequest): KbRefAnswer {
  checkScope(req.scope);
  let ix = indexes.get(entries);
  if (!ix) { ix = { index: new Index(entries), byId: new Map(entries.map((e) => [e.id, e])) }; indexes.set(entries, ix); }
  const r = roleReference(ix.index, ix.byId, req.queries, req.scope, { limit: req.limit ?? KB_REF_LIMIT, chars: req.chars ?? KB_REF_CHARS });
  const d = req.doctrine;
  return { ...r, ...(d ? { doctrine: doctrineFor(entries, {}, d.side, d.triggers, d.query, d.levels ? { levels: d.levels } : {}) } : {}) };
}

/**
 * Справки посреднику: роль «посредник», операция, момент хода; не больше 8 записей по 900 знаков. Справка по сиду
 * (окно не ответило) — onFallback.
 */
export const umpireRefs = (c: ReturnType<typeof kbRefClient>, operation: string, onFallback?: () => void) =>
  async (queries: string[], moment: string): Promise<RoleRef[]> => {
    const a = await c.request({ queries, scope: { role: 'umpire', operation, moment }, limit: 8, chars: 900 });
    if (a.fallback) onFallback?.();
    return a.refs;
  };
