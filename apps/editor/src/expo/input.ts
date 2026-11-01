/**
 * Профили ввода посетителя: размер целей, раскрытие карточки наведением, клавиши (только «мышь и клавиатура») и кнопка
 * голоса (только с ИИ). `keyToEvent` переводит клавишу в событие режиссёра с учётом фазы.
 */
import type { AiMode, FrontId, InputProfile } from './settings';
import { BRIEF_POINTS, type DirectorEvent, type Phase } from './director';
export function affordances(p: InputProfile, voiceInput: boolean, aiMode: AiMode) {
  return {
    hoverExpand: p !== 'touch',
    keys: p === 'mouse-keyboard',
    minTarget: p === 'touch' ? 96 : 64,
    voiceButton: voiceInput && aiMode === 'ai',
  };
}
export function keyToEvent(key: string, phase: Phase, context: { expanded?: number | null; front?: FrontId } = {}): DirectorEvent | null {
  if (phase.kind === 'turn' && phase.step === 'choose') {
    if (/^[1-3]$/.test(key)) return { t: 'choose', card: Number(key) - 1 };
    if (key.toLowerCase() === 'r' && context.expanded != null && context.expanded > 0) return { t: 'replace', card: context.expanded };
  }
  if (phase.kind === 'briefing') {
    if (key === 'ArrowRight' || key === 'Enter' || key === ' ') return phase.point + 1 < BRIEF_POINTS ? { t: 'brief', point: phase.point + 1 } : { t: 'next' };
    if (key === 'ArrowLeft' && phase.point > 0) return { t: 'brief', point: phase.point - 1 };
  }
  if (key === 'Enter' || key === ' ') {
    if (phase.kind === 'welcome' && context.front) return { t: 'pickFront', front: context.front };
    if (['attract', 'welcome', 'result'].includes(phase.kind)) return { t: 'touch' };
  }
  return null;
}
