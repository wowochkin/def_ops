/** Запуск голосового сервиса вместе с приложением: решение о запуске и пауза перед перезапуском. */
import { describe, it, expect } from 'vitest';
import { voicePlan, restartDelay } from '../server/voice.mjs';

describe('voicePlan', () => {
  it('порт отвечает — подключаемся к чужому процессу', () => {
    expect(voicePlan({ python: false, portAnswers: true })).toBe('attach');
    expect(voicePlan({ python: true, portAnswers: true })).toBe('attach');
  });
  it('порт молчит, окружение есть — запускаем сами', () => {
    expect(voicePlan({ python: true, portAnswers: false })).toBe('spawn');
  });
  it('ни порта, ни окружения — голос выключен', () => {
    expect(voicePlan({ python: false, portAnswers: false })).toBe('off');
  });
});

describe('restartDelay', () => {
  it('5 секунд для первых трёх перезапусков, потом отказ', () => {
    expect([0, 1, 2].map(restartDelay)).toEqual([5000, 5000, 5000]);
    expect(restartDelay(3)).toBeNull();
    expect(restartDelay(10)).toBeNull();
  });
});
