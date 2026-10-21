/**
 * Ответы советника вслух: настройка «Читать ответы вслух» (флажок у поля вопроса, голосом — «Штаб, читай ответы
 * советника вслух» / «не читай ответы»). Включена по умолчанию: вопрос, набранный или продиктованный в поле, и вопрос
 * из дерева тем озвучиваются так же, как вопрос голосом — коротко, остальное по «подробнее». Запоминается в окне.
 */
import { useSyncExternalStore } from 'react';

export const ADVISOR_SPEAK_KEY = 'def_ops.voice.advisorSpeak';
const subs = new Set<() => void>();
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

let cur: boolean | null = null;
/** Читать ли ответы советника вслух (нет записи — читать). */
export const speakAnswersOn = (): boolean => (cur ??= lsGet(ADVISOR_SPEAK_KEY) !== 'off');
export function setSpeakAnswers(on: boolean): void { cur = on; lsSet(ADVISOR_SPEAK_KEY, on ? 'on' : 'off'); subs.forEach((f) => f()); }
export function useSpeakAnswers(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, speakAnswersOn, speakAnswersOn);
  return [on, setSpeakAnswers];
}
