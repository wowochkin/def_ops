import { afterEach, describe, expect, it, vi } from 'vitest';
import { ttsStatus, ttsStore, type TtsInfo } from '../src/voice/tts-store';

const info = (o: Partial<TtsInfo> = {}): TtsInfo => ({
  engines: [
    { id: 'a', title: 'Первая', note: '', license: '', commercial: true, default: true },
    { id: 'b', title: 'Вторая', note: '', license: '', commercial: false, default: false },
  ],
  current: 'a', state: 'ready', ...o,
});

afterEach(() => { ttsStore.attach(null); });

describe('модель озвучки в окне', () => {
  it('без связи выбирать нечем', () => {
    const send = vi.fn();
    ttsStore.attach(send);
    expect(ttsStore.choose('b')).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(ttsStatus(ttsStore.get()).kind).toBe('off');
  });

  it('выбор уходит один раз: до ответа сервиса состояние «грузится»', () => {
    const send = vi.fn();
    ttsStore.attach(send);
    ttsStore.set(info());
    expect(ttsStore.choose('b')).toBe(true);
    expect(send).toHaveBeenCalledWith('b');
    expect(ttsStore.get()?.state).toBe('loading');
    expect(ttsStore.choose('a')).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('та же или неизвестная модель не уходит', () => {
    const send = vi.fn();
    ttsStore.attach(send);
    ttsStore.set(info());
    expect(ttsStore.choose('a')).toBe(false);
    expect(ttsStore.choose('нет')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('состояния читаются простыми словами', () => {
    expect(ttsStatus(info()).text).toBe('Говорит: Первая.');
    expect(ttsStatus(info({ state: 'loading' })).kind).toBe('wait');
    const bad = ttsStatus(info({ error: 'RuntimeError: нет весов' }));
    expect(bad.kind).toBe('fail');
    expect(bad.text).toContain('остаётся Первая');
  });
});
