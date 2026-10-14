/** Разговор с ассистентом модели — в этом браузере, последние 20 пар; испорченный или недоступный — пустой. */
import type { ModelFragment } from '@def-ops/knowledge';

export interface Turn { q: string; a: string; sources: ModelFragment[]; extra: ModelFragment[]; need?: string[]; error?: string; thinking?: string; seconds?: number }

export const HISTORY_KEY = 'def_ops.modelAssistant';
export const HISTORY_MAX = 20;

const isTurn = (t: unknown): t is Turn => !!t && typeof (t as Turn).q === 'string' && typeof (t as Turn).a === 'string'
  && Array.isArray((t as Turn).sources) && Array.isArray((t as Turn).extra);

export function loadHistory(): Turn[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isTurn).slice(-HISTORY_MAX) : [];
  } catch { return []; }
}

export function saveHistory(t: Turn[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(t.slice(-HISTORY_MAX))); } catch { /* без сохранения */ }
}
