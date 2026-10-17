/**
 * Туры: шаги с подсветкой элемента (`data-tour="…"`), текстом, который проговаривает штаб, и примером фразы.
 * Движок — voice/tour.tsx; здесь — только описания туров (без React: проверяются в node).
 */
import type { Section } from '../../sections';
import { INTRO } from './intro';
import { VOICE_PANEL } from './voice-panel';

export interface TourStep {
  /** Значение `data-tour` подсвечиваемого элемента. */
  target: string;
  title: string;
  /** Что говорит штаб (и что видно в подписи). Числа — словами: текст звучит как есть. */
  text: string;
  /** Ответ на «подробнее». */
  more?: string;
  /** Пример фразы для подписи «Скажите: …». */
  example?: string;
  /** Обратимое действие реестра перед шагом: открыть раздел, вкладку, панель. */
  prepare?: { action: string; params?: unknown };
  /** Что сказать, если элемента нет (он появится позже): когда и как он появится. */
  unavailable?: string;
  /** Что подсветить вместо отсутствующего элемента — то, что к нему ведёт. */
  via?: string;
}

export interface Tour {
  id: string;
  /** Раздел тура; 'intro' — вступление о приложении, 'voice' — панель голоса (поверх любого раздела). */
  section: Section | 'intro' | 'voice';
  title: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [INTRO, VOICE_PANEL];

/** Тур по идентификатору или по разделу. */
export const findTour = (idOrSection: string, tours: Tour[] = TOURS): Tour | undefined =>
  tours.find((t) => t.id === idOrSection) ?? tours.find((t) => t.section === idOrSection);
