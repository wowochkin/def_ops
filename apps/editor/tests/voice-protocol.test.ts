import { describe, expect, it } from 'vitest';
import { parseAudio, voiceStatus } from '../src/voice/protocol';

/** Собирает двоичное сообщение сервиса: [0x01][id u32 LE][rate u32 LE][pcm int16 LE]. */
function frame(id: number, rate: number, pcm: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(9 + pcm.length * 2);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint32(1, id, true);
  v.setUint32(5, rate, true);
  pcm.forEach((s, i) => v.setInt16(9 + i * 2, s, true));
  return buf;
}

describe('parseAudio', () => {
  it('читает id и частоту в little-endian', () => {
    const a = parseAudio(frame(0x01020304, 24000, [1, -2, 3]));
    expect(a.id).toBe(0x01020304);
    expect(a.rate).toBe(24000);
  });

  it('отдаёт отсчёты нужной длины и со знаком', () => {
    const a = parseAudio(frame(7, 24000, [1, -2, 32767, -32768]));
    expect(a.pcm.length).toBe(4);
    expect(Array.from(a.pcm)).toEqual([1, -2, 32767, -32768]);
  });

  it('пустой звук — пустой pcm', () => {
    expect(parseAudio(frame(1, 16000, [])).pcm.length).toBe(0);
  });

  it('слишком короткое сообщение — ошибка', () => {
    expect(() => parseAudio(new ArrayBuffer(4))).toThrow();
  });
});

describe('voiceStatus', () => {
  it('шлюз off или недоступен — off', () => {
    expect(voiceStatus({ state: 'off' }, 'closed', false)).toBe('off');
    expect(voiceStatus(null, 'closed', false)).toBe('off');
  });
  it('шлюз loading и ws закрыт — loading', () => {
    expect(voiceStatus({ state: 'loading' }, 'closed', false)).toBe('loading');
  });
  it('шлюз error — error', () => {
    expect(voiceStatus({ state: 'error' }, 'closed', false)).toBe('error');
  });
  it('шлюз ready, ws подключается — connecting', () => {
    expect(voiceStatus({ state: 'ready' }, 'connecting', false)).toBe('connecting');
    expect(voiceStatus({ state: 'ready' }, 'closed', false)).toBe('connecting');
  });
  it('ws открыт, но ready не пришёл — connecting', () => {
    expect(voiceStatus({ state: 'ready' }, 'open', false)).toBe('connecting');
  });
  it('ws открыт и ready — ready', () => {
    expect(voiceStatus({ state: 'ready' }, 'open', true)).toBe('ready');
  });
  it('был ready, ws закрыт — reconnecting', () => {
    expect(voiceStatus({ state: 'ready' }, 'closed', true)).toBe('reconnecting');
    expect(voiceStatus({ state: 'ready' }, 'connecting', true)).toBe('reconnecting');
  });
});
