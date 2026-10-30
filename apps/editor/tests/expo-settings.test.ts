// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPO_DEFAULTS, normalizeSettings, settingsStore, localSettingsStore, appSettingsStore, type ExpoSettings } from '../src/expo/settings';

const clone = (): ExpoSettings => JSON.parse(JSON.stringify(EXPO_DEFAULTS));

describe('настройки стенда', () => {
  beforeEach(() => localStorage.clear());

  it('defaults are valid', () => {
    const r = normalizeSettings(EXPO_DEFAULTS);
    expect(r.problems).toEqual([]);
    expect(r.settings).toEqual(EXPO_DEFAULTS);
    expect(EXPO_DEFAULTS).toMatchObject({ autostart: false, aiMode: 'ai', input: 'touch', voiceInput: false, pin: '0000', maxReplacements: 2, idleSeconds: 90, resultSeconds: 20, timer: { on: true, seconds: 30 }, fronts: ['su_1bf', 'su_1uf'], volume: { voice: 0.8, ambient: 0.3, ambientOn: false }, screens: { count: 3, order: [] } });
  });

  it('corrupt settings fall back', async () => {
    for (const raw of ['не json', null, { version: 0 }]) {
      const r = normalizeSettings(raw);
      expect(r.settings).toEqual(EXPO_DEFAULTS);
      expect(r.problems.length).toBeGreaterThan(0);
    }
    localStorage.setItem('def_ops.expo.settings', '{испорчено');
    expect(await settingsStore().load()).toEqual(EXPO_DEFAULTS);
    expect(localStorage.getItem('def_ops.expo.settings.bad')).toBe('{испорчено');
  });

  it('corrupt settings fall back in app (expo.json.bad)', async () => {
    const calls: [string, unknown][] = [];
    const invoke = async (cmd: string, args?: unknown) => { calls.push([cmd, args]); return cmd === 'expo_settings_read' ? '{испорчено' : undefined; };
    expect(await appSettingsStore(invoke).load()).toEqual(EXPO_DEFAULTS);
    expect(calls).toContainEqual(['expo_settings_write', { text: '{испорчено', bad: true }]);
  });

  it('missing settings give defaults without .bad', async () => {
    expect(await localSettingsStore(localStorage).load()).toEqual(EXPO_DEFAULTS);
    expect(localStorage.getItem('def_ops.expo.settings.bad')).toBeNull();
    const calls: string[] = [];
    expect(await appSettingsStore(async (cmd) => { calls.push(cmd); return null; }).load()).toEqual(EXPO_DEFAULTS);
    expect(calls).toEqual(['expo_settings_read']);
  });

  it('bad field keeps others', () => {
    const given = { ...clone(), aiMode: 'noai', idleSeconds: 120, timer: { on: false, seconds: 5 } };
    const r = normalizeSettings(given);
    expect(r.settings).toEqual({ ...given, timer: { on: false, seconds: 30 } });
    expect(r.problems).toHaveLength(1);
  });

  it('range and subset checks', () => {
    const r = normalizeSettings({ ...clone(), fronts: [], pin: '12a4', maxReplacements: 9, volume: { voice: 2, ambient: 0.5, ambientOn: true }, screens: { count: 4, order: ['A', 'B'] } });
    expect(r.settings.fronts).toEqual(EXPO_DEFAULTS.fronts);
    expect(r.settings.pin).toBe('0000');
    expect(r.settings.maxReplacements).toBe(2);
    expect(r.settings.volume).toEqual({ voice: 0.8, ambient: 0.5, ambientOn: true });
    expect(r.settings.screens).toEqual({ count: 3, order: ['A', 'B'] });
    expect(r.problems).toHaveLength(5);
    expect(normalizeSettings({ ...clone(), fronts: ['su_1uf', 'su_1uf', 'x'] }).settings.fronts).toEqual(EXPO_DEFAULTS.fronts);
    expect(normalizeSettings({ ...clone(), fronts: ['su_1uf'], pin: '12345678' }).settings).toMatchObject({ fronts: ['su_1uf'], pin: '12345678' });
  });

  it('unknown fields dropped', () => {
    const r = normalizeSettings({ ...clone(), extra: 1, timer: { on: true, seconds: 40, more: 2 } });
    expect(r.settings).not.toHaveProperty('extra');
    expect(r.settings.timer).toEqual({ on: true, seconds: 40 });
    expect(r.problems).toEqual([]);
  });

  it('store roundtrip', async () => {
    const s: ExpoSettings = { ...clone(), aiMode: 'noai', input: 'mouse-keyboard', screens: { count: 2, order: ['m2', 'm1'] } };
    const store = settingsStore();
    await store.save(s);
    expect(await store.load()).toEqual(s);
  });
});
