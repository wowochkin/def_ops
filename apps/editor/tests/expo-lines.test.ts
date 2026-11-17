import { describe, expect, it } from 'vitest';
import { LINES, allLines, answerFor, fillIn, pick, textErrors } from '../src/expo/lines';
import { INTRO_KEYS } from '../src/expo/intro-story';

describe('заготовки фраз', () => {
  it('подстановка: нет значения — заготовка не годится', () => {
    expect(fillIn('Маршал {marshal}', { marshal: 'Жуков' })).toBe('Маршал Жуков');
    expect(fillIn('До {date}', {})).toBeNull();
    expect(pick(['До {date}', 'Без даты'], {})).toBe('Без даты');
  });

  it('есть фразы на все ключи эффектов режиссёра', () => {
    for (const k of ['timer-warn', 'delay', 'offer-decide', 'voice-soon', 'ai-pick']) expect(LINES.say[k]?.length).toBeGreaterThan(0);
  });

  it('готовый ответ находится по своим словам', () => {
    expect(answerFor('А почему эти высоты так важны?')?.q).toMatch(/Зееловские/);
    expect(answerFor('Какой вариант лучше?')?.a).toBeTruthy();
    expect(answerFor('Какая погода в Париже')).toBeNull();
  });

  it('все заготовки проходят проверку текста', () => {
    expect(allLines().flatMap((t) => textErrors(t))).toEqual([]);
    expect(textErrors('Мы гарантированно победим')).toHaveLength(1);
  });

  it('утверждённые фразы сцен интро допускают 360 знаков, обычный текст — только 220', () => {
    expect(LINES.say['intro-11'][0].length).toBeGreaterThan(220);
    for (const key of INTRO_KEYS) {
      for (const text of LINES.say[key]) expect(textErrors(text)).toEqual([]);
    }
    const long = 'а'.repeat(221);
    expect(textErrors(long)).toEqual([expect.stringContaining('длиннее 220 знаков')]);
    expect(textErrors(long, { ...LINES, say: { 'intro-11': [long] } })).toEqual([expect.stringContaining('длиннее 220 знаков')]);
    expect(textErrors(`${LINES.say['intro-11'][0]} Дополнение.`)).toEqual([expect.stringContaining('длиннее 220 знаков')]);
  });

  it('исключение длины интро не отменяет стоп-слова и двойные пробелы', () => {
    const intro = LINES.say['intro-11'][0];
    expect(textErrors(intro, { ...LINES, stop: ['архитектура'] })).toEqual([expect.stringContaining('стоп-слово «архитектура»')]);
    expect(textErrors(intro.replace(' ', '  '))).toContainEqual(expect.stringContaining('двойной пробел'));
  });
});
