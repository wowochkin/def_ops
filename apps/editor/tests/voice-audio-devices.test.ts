import { afterEach, describe, expect, it, vi } from 'vitest';
import { onDevicesChanged, parseDevices, pickDevice, MIC_KEY } from '../src/voice/audio-devices';
import { micConstraints } from '../src/voice/protocol';

const dev = (kind: string, deviceId: string, label = '') => ({ kind, deviceId, label });

describe('устройства звука', () => {
  it('список: свои имена, без системных дублей, безымянные — по номерам', () => {
    const r = parseDevices([
      dev('audioinput', 'default', 'Default - MacBook'), dev('audioinput', 'a1', 'Микрофон MacBook Pro'), dev('audioinput', 'b2', 'USB камера'),
      dev('audioinput', 'c3', ''), dev('audiooutput', 'communications', 'x'), dev('audiooutput', 'o1', 'Динамики'), dev('videoinput', 'v1', 'камера'),
    ]);
    expect(r.inputs).toEqual([{ id: 'a1', label: 'Микрофон MacBook Pro' }, { id: 'b2', label: 'USB камера' }, { id: 'c3', label: 'Микрофон 1' }]);
    expect(r.outputs).toEqual([{ id: 'o1', label: 'Динамики' }]);
  });
  it('выбранное пропало — «как в системе»', () => {
    const l = [{ id: 'a1', label: 'A' }];
    expect(pickDevice('a1', l)).toBe('a1');
    expect(pickDevice('gone', l)).toBe('');
    expect(pickDevice('', l)).toBe('');
  });
  it('что делать микрофону при смене списка', () => {
    const A = { id: 'a', label: 'A' }, B = { id: 'b', label: 'B' };
    expect(onDevicesChanged({ chosen: 'a', before: [A], after: [A, B] })).toBe('keep');
    expect(onDevicesChanged({ chosen: 'b', before: [A, B], after: [A] })).toBe('fallback');
    expect(onDevicesChanged({ chosen: '', before: [A], after: [A, B] })).toBe('reopen');  // подключили веб-камеру — системный мог смениться
    expect(onDevicesChanged({ chosen: '', before: [A, B], after: [A, B] })).toBe('keep');
  });
  it('выбранное устройство — в запросе микрофона точным id', () => {
    expect(micConstraints(true, 'b2')).toMatchObject({ deviceId: { exact: 'b2' }, echoCancellation: false });
    expect(micConstraints(true)).not.toHaveProperty('deviceId');
  });
});

describe('клиент: выбор устройства', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('выбор запоминается и сообщается подписчику вместе с подсказкой о калибровке; повторный — без шума', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => [dev('audioinput', 'b2', 'USB камера')], addEventListener: () => {} } });
    const { VoiceClient } = await import('../src/voice/client');
    const c = new VoiceClient();
    const seen: { mic: string; note?: string }[] = [];
    c.onDevices((d) => seen.push({ mic: d.mic, note: d.note }));
    await c.setMic('b2');
    expect(store.get(MIC_KEY)).toBe('b2');
    expect(seen.at(-1)).toMatchObject({ mic: 'b2' });
    expect(seen.at(-1)!.note).toMatch(/калибровку заново/);
    const n = seen.length;
    await c.setMic('b2');
    expect(seen.length).toBe(n);
    await c.setMic('');
    expect(store.has(MIC_KEY)).toBe(false);
  });
});
