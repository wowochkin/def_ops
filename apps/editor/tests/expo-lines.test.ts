import { describe, expect, it } from 'vitest';
import { LINES, allLines, answerFor, fillIn, pick, textErrors } from '../src/expo/lines';

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
});
