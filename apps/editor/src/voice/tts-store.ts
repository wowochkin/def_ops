/**
 * Модель озвучки: что выбрано в сервисе голоса. Панель голоса (VoicePanel) держит связь с сервисом и кладёт сюда
 * его сообщения; раздел «ИИ» читает и просит сменить модель. Связи нет (голос не запущен) — выбирать нечем (`info` пуст).
 */
import { useSyncExternalStore } from 'react';

export interface TtsEngine { id: string; title: string; note: string; license: string; commercial: boolean; default: boolean }
export interface TtsInfo { engines: TtsEngine[]; current: string; state: 'ready' | 'loading'; error?: string }

let info: TtsInfo | null = null;
/** Почему голоса нет (текст панели: «Голос не установлен: …», «Голос загружается», …). */
let reason: string | null = null;
let sender: ((id: string) => void) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const ttsStore = {
  get: () => info,
  set(next: TtsInfo | null) { info = next; emit(); },
  /** Панель подключила / отключила сервис; отключён — выбор пропадает. */
  attach(send: ((id: string) => void) | null) { sender = send; if (!send) { info = null; } emit(); },
  /** Просьба сменить модель; false — нечем (нет связи), уже грузится или та же. */
  choose(id: string): boolean {
    if (!sender || !info || info.state === 'loading' || info.current === id || !info.engines.some((e) => e.id === id)) return false;
    info = { ...info, state: 'loading', error: undefined };  // до ответа сервиса: повторный выбор не уйдёт
    emit();
    sender(id);
    return true;
  },
  getReason: () => reason,
  setReason(r: string | null) { if (r !== reason) { reason = r; emit(); } },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export const useTts = (): TtsInfo | null => useSyncExternalStore(ttsStore.subscribe, ttsStore.get);
export const useTtsReason = (): string | null => useSyncExternalStore(ttsStore.subscribe, ttsStore.getReason);

/** Строка состояния под списком. */
export function ttsStatus(t: TtsInfo | null, why: string | null = null): { text: string; kind: 'ok' | 'wait' | 'fail' | 'off' } {
  if (!t) return { text: `${why ? `${why.replace(/[.\s]+$/, '')}. ` : 'Голос не запущен. '}Выбрать модель озвучки можно, когда голос на связи.`, kind: 'off' };
  if (t.state === 'loading') return { text: 'Загружаю модель озвучки (20–40 секунд, первый раз дольше — модель скачивается). Штаб пока молчит.', kind: 'wait' };
  const cur = t.engines.find((e) => e.id === t.current);
  if (t.error) return { text: `Модель не загрузилась, остаётся ${cur?.title ?? t.current}. Причина: ${t.error}`, kind: 'fail' };
  return { text: `Говорит: ${cur?.title ?? t.current}.`, kind: 'ok' };
}
