/**
 * Ассистент модели: поиск по выжимке (packages/knowledge/data/model-index.json), ответ модели роли «база знаний»,
 * один дозапрос по точному имени. Выжимка загружается при первом вопросе.
 */
import { assistantMessages, byName, findFragments, modelIndex, parseNeed, type ModelFragment, type ModelIx } from '@def-ops/knowledge';
import type { LlmSettings } from '../sim/game-protocol';
import { kbLlm, llmClient, streamView } from '../kb/kb';

export type AssistStage = 'search' | 'need' | 'model';
export interface AssistStream { stage: AssistStage; answer: string; thinking: string; need?: string[] }
export interface AssistResult { text: string; thinking: string; sources: ModelFragment[]; extra: ModelFragment[]; need?: string[]; error?: string }

type Chat = (req: { messages: ReturnType<typeof assistantMessages>; signal?: AbortSignal; onDelta?: (k: 'reasoning' | 'content', t: string) => void }) => Promise<{ content: string; reasoning: string }>;
export interface AssistDeps { load?: () => Promise<ModelFragment[]>; chat?: (llm: LlmSettings) => Chat }

let ixp: Promise<ModelIx> | null = null;
const loadIx = (deps: AssistDeps): Promise<ModelIx> => {
  if (deps.load) return deps.load().then(modelIndex);
  // неудачная загрузка не запоминается: следующий вопрос пробует снова
  ixp ??= import('../../../../packages/knowledge/data/model-index.json').then((m) => modelIndex((m.default ?? m) as unknown as ModelFragment[])).catch((e) => { ixp = null; throw e; });
  return ixp;
};

/** Вопрос → поиск → ответ (с одним дозапросом). Ошибка модели — в error, найденные фрагменты всё равно в sources. */
export async function askModel(question: string, llm: LlmSettings, history: { q: string; a: string }[], onStream: (v: AssistStream) => void, signal?: AbortSignal, deps: AssistDeps = {}): Promise<AssistResult> {
  llm = kbLlm(llm);
  onStream({ stage: 'search', answer: '', thinking: '' });
  let ix: ModelIx;
  try { ix = await loadIx(deps); } catch (e) {
    return { text: '', thinking: '', sources: [], extra: [], error: `выжимка модели не загрузилась: ${(e as Error).message || e}` };
  }
  const sources = findFragments(ix, question);
  const chat: Chat = deps.chat ? deps.chat(llm) : (req) => llmClient(llm).chat(req);
  const off = llm.thinking === 'off';
  const run = async (frags: ModelFragment[], final: boolean, stage: AssistStage, need?: string[]) => {
    let content = '', reasoning = '', last = 0;
    const push = (end = false) => {
      const now = Date.now();
      if (end || now - last > 60) { last = now; onStream({ ...streamView(content, reasoning, off, end), stage, ...(need ? { need } : {}) }); }
    };
    const r = await chat({ messages: assistantMessages(question, frags, history, { final }), signal, onDelta: (k, t) => { if (k === 'content') content += t; else reasoning += t; push(); } });
    push(true);
    return r;
  };
  try {
    const first = await run(sources, false, 'model');
    const need = parseNeed(first.content);
    if (!need) return { text: first.content, thinking: first.reasoning, sources, extra: [] };
    const extra = byName(ix, need).filter((f) => !sources.some((s) => s.id === f.id));
    onStream({ stage: 'need', answer: '', thinking: '', need });
    const second = await run([...sources, ...extra], true, 'model', need);
    // повторная просьба не исполняется: строка «НУЖНО» убирается из ответа
    const text = parseNeed(second.content) ? second.content.split('\n').slice(1).join('\n').trim() || 'Во фрагментах ответа нет.' : second.content;
    return { text, thinking: second.reasoning, sources, extra, need };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const error = signal?.aborted ? 'остановлено' : /fetch|network|ECONNREFUSED/i.test(msg) ? `сервер моделей недоступен: ${msg}` : msg;
    return { text: '', thinking: '', sources, extra: [], error };
  }
}
