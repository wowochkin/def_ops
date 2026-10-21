/**
 * Туры: шаги с подсветкой элемента (`data-tour="…"`), текстом, который проговаривает штаб, и примером фразы.
 * Движок — voice/tour.tsx; здесь — только описания туров (без React: проверяются в node).
 */
import type { LngLat } from '@def-ops/core';
import type { Section } from '../../sections';
import type { SpeakRole } from '../registry';
import { INTRO } from './intro';
import { VOICE_PANEL } from './voice-panel';
import { EDITOR } from './editor';
import { MODELING } from './modeling';
import { MAPS } from './maps';
import { LIBRARY } from './library';
import { KNOWLEDGE } from './knowledge';
import { STAFF } from './staff';
import { REPLAY } from './replay';
import { COMMAND, COMMAND_ENTRY } from './command';

export interface TourStep {
  /** Значение `data-tour` подсвечиваемого элемента. */
  target: string;
  title: string;
  /** Что видно в подписи и что говорит штаб (если нет speech). Числа — словами: текст звучит как есть. */
  text: string;
  /** Что говорит штаб, когда звучать должно иначе, чем написано («LM Studio» → «Эл Эм Студио»). */
  speech?: string;
  /** Ответ на «подробнее». */
  more?: string;
  /** Пример фразы для подписи «Скажите: …». */
  example?: string;
  /** Обратимое действие реестра перед шагом: открыть раздел, вкладку, панель. */
  prepare?: { action: string; params?: unknown };
  /** Если элемента нет (он появится позже) — добавка к тексту шага: почему его сейчас не видно и когда он появится. */
  unavailable?: string;
  /** Что подсветить вместо отсутствующего элемента — то, что к нему ведёт. */
  via?: string;
  /** Элемента нет, а этот на экране — шаг целиком заменяется им (например, итог игры вместо кнопки хода). */
  alt?: Omit<TourStep, 'alt'>;
  /** Карта на шаге (разбор хода): куда переехать, проиграть ли время, где метка и рамка. */
  map?: TourMap;
}

/**
 * Карта на шаге тура: переезд к месту (at, zoom) или показ всех точек fit; play — проиграть время карты от начала
 * хода до конца (движение войск, линия фронта, зоны влияния); spot — метка-пульс, box — рамка вокруг точек (место
 * боя и его участники).
 */
export interface TourMap {
  at?: LngLat;
  zoom?: number;
  /**
   * Уровень карты шага: tac / op / st — желательный (масштаб — из рекомендуемого интервала уровня; точки шага не
   * помещаются — берётся следующий уровень), auto — подходящий по тому, сколько карты занимают точки. Нет — как есть.
   */
  level?: 'tac' | 'op' | 'st' | 'auto';
  fit?: LngLat[];
  play?: [string, string];
  spot?: LngLat;
  box?: LngLat[];
}

export interface Tour {
  id: string;
  /** Раздел тура; 'intro' — вступление о приложении, 'voice' — панель голоса (поверх любого раздела). */
  section: Section | 'intro' | 'voice';
  /**
   * Для «Переигровки»: true — тур идёт только в игре (командование), false — только вне игры. Началась или кончилась
   * игра посреди тура — тур остановлен (TourEngine.onGame).
   */
  game?: boolean;
  title: string;
  steps: TourStep[];
  /** Чьим голосом звучат шаги: по умолчанию — начальник штаба; разбор хода — посредник. */
  role?: SpeakRole;
  /** Команда голосом посреди тура исполняется, а тур встаёт на паузу (разбор хода). */
  pauseOnCommand?: boolean;
}

// тур раздела «Переигровка» вне игры — первым из туров этого раздела (findTour по разделу)
export const TOURS: Tour[] = [INTRO, VOICE_PANEL, EDITOR, REPLAY, COMMAND, COMMAND_ENTRY, MODELING, MAPS, LIBRARY, KNOWLEDGE, STAFF];

/** Тур по идентификатору или по разделу. */
export const findTour = (idOrSection: string, tours: Tour[] = TOURS): Tour | undefined =>
  tours.find((t) => t.id === idOrSection) ?? tours.find((t) => t.section === idOrSection);
