/**
 * Настройки выставочного стенда: тип, значения по умолчанию, проверка и хранение.
 *
 * Хранятся в окне приложения — файлом expo.json в папке данных приложения (команды Tauri expo_settings_read и
 * expo_settings_write), в браузере разработки — в localStorage (def_ops.expo.settings). Испорченный файл не роняет
 * стенд: каждое плохое поле заменяется значением по умолчанию, неизвестные поля отбрасываются, а сам испорченный текст
 * сохраняется рядом (expo.json.bad, в браузере — def_ops.expo.settings.bad).
 */

export type AiMode = 'ai' | 'noai';
export type InputProfile = 'touch' | 'mouse' | 'mouse-keyboard';
export type Role = 'ai' | 'map' | 'progress';
export type FrontId = 'su_1bf' | 'su_1uf';

export interface ExpoSettings {
  version: 1;
  autostart: boolean;
  aiMode: AiMode;
  input: InputProfile;
  voiceInput: boolean;
  timer: { on: boolean; seconds: number };
  fronts: FrontId[];
  idleSeconds: number;
  resultSeconds: number;
  volume: { voice: number; ambient: number; ambientOn: boolean };
  /** Число экранов и идентификаторы мониторов слева направо (пусто — по порядку системы). */
  screens: { count: 1 | 2 | 3; order: string[] };
  pin: string;
  maxReplacements: number;
}

const ALL_FRONTS: readonly FrontId[] = ['su_1bf', 'su_1uf'];

export const EXPO_DEFAULTS: ExpoSettings = Object.freeze({
  version: 1,
  autostart: false,
  aiMode: 'ai',
  input: 'touch',
  voiceInput: false,
  timer: { on: true, seconds: 30 },
  fronts: [...ALL_FRONTS],
  idleSeconds: 90,
  resultSeconds: 20,
  volume: { voice: 0.8, ambient: 0.3, ambientOn: false },
  screens: { count: 3, order: [] },
  pin: '0000',
  maxReplacements: 2,
}) as ExpoSettings;

const copyDefaults = (): ExpoSettings => JSON.parse(JSON.stringify(EXPO_DEFAULTS)) as ExpoSettings;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const inRange = (lo: number, hi: number, int = true) => (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v));
const oneOf = <T extends string>(...xs: T[]) => (v: unknown): v is T => typeof v === 'string' && (xs as string[]).includes(v);

/** Проверить настройки: плохое поле — значение по умолчанию и строка в problems; неизвестные поля отброшены. */
export function normalizeSettings(raw: unknown): { settings: ExpoSettings; problems: string[] } {
  const problems: string[] = [];
  let src: unknown = raw;
  if (typeof raw === 'string') {
    try { src = JSON.parse(raw); } catch { return { settings: copyDefaults(), problems: ['настройки — не JSON'] }; }
  }
  if (!isObj(src)) return { settings: copyDefaults(), problems: ['настройки — не объект'] };
  if (src.version !== 1) return { settings: copyDefaults(), problems: [`неизвестная версия настроек: ${JSON.stringify(src.version)}`] };

  const d = copyDefaults();
  const r = src;
  /** Значение поля, если проходит проверку, иначе — по умолчанию (с записью в problems). */
  const pick = <T>(name: string, v: unknown, ok: (v: unknown) => v is T, def: T): T => {
    if (ok(v)) return v;
    problems.push(`поле ${name}: ${v === undefined ? 'нет' : JSON.stringify(v)} — взято ${JSON.stringify(def)}`);
    return def;
  };
  const sub = (name: string): Obj => {
    const v = r[name];
    if (isObj(v)) return v;
    if (v !== undefined) problems.push(`поле ${name}: не объект — взяты значения по умолчанию`);
    return {};
  };

  const timer = sub('timer');
  const volume = sub('volume');
  const screens = sub('screens');
  const fronts = (v: unknown): v is FrontId[] =>
    Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every((f) => (ALL_FRONTS as unknown[]).includes(f));
  const order = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const count = (v: unknown): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3;

  const settings: ExpoSettings = {
    version: 1,
    autostart: pick('autostart', r.autostart, isBool, d.autostart),
    aiMode: pick('aiMode', r.aiMode, oneOf<AiMode>('ai', 'noai'), d.aiMode),
    input: pick('input', r.input, oneOf<InputProfile>('touch', 'mouse', 'mouse-keyboard'), d.input),
    voiceInput: pick('voiceInput', r.voiceInput, isBool, d.voiceInput),
    timer: {
      on: pick('timer.on', timer.on, isBool, d.timer.on),
      seconds: pick('timer.seconds', timer.seconds, inRange(10, 120), d.timer.seconds),
    },
    fronts: [...pick('fronts', r.fronts, fronts, d.fronts)],
    idleSeconds: pick('idleSeconds', r.idleSeconds, inRange(30, 600), d.idleSeconds),
    resultSeconds: pick('resultSeconds', r.resultSeconds, inRange(5, 120), d.resultSeconds),
    volume: {
      voice: pick('volume.voice', volume.voice, inRange(0, 1, false), d.volume.voice),
      ambient: pick('volume.ambient', volume.ambient, inRange(0, 1, false), d.volume.ambient),
      ambientOn: pick('volume.ambientOn', volume.ambientOn, isBool, d.volume.ambientOn),
    },
    screens: {
      count: pick('screens.count', screens.count, count, d.screens.count),
      order: [...pick('screens.order', screens.order, order, d.screens.order)],
    },
    pin: pick('pin', r.pin, (v): v is string => typeof v === 'string' && /^\d{4,8}$/.test(v), d.pin),
    maxReplacements: pick('maxReplacements', r.maxReplacements, inRange(0, 5), d.maxReplacements),
  };
  return { settings, problems };
}

export interface SettingsStore {
  load(): Promise<ExpoSettings>;
  save(s: ExpoSettings): Promise<void>;
}

const KEY = 'def_ops.expo.settings';
const serialize = (s: ExpoSettings) => JSON.stringify(normalizeSettings(s).settings, null, 2);

/** Браузер разработки: localStorage. */
export function localSettingsStore(storage: Storage): SettingsStore {
  return {
    async load() {
      let text: string | null = null;
      try { text = storage.getItem(KEY); } catch { /* хранилище недоступно */ }
      if (text === null) return copyDefaults();
      const r = normalizeSettings(text);
      if (r.problems.length) { try { storage.setItem(`${KEY}.bad`, text); } catch { /* не записалось */ } }
      return r.settings;
    },
    async save(s) { storage.setItem(KEY, serialize(s)); },
  };
}

export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Окно приложения: файл expo.json в папке данных приложения через команды Tauri. */
export function appSettingsStore(invoke: Invoke): SettingsStore {
  return {
    async load() {
      let text: unknown = null;
      try { text = await invoke('expo_settings_read'); } catch { return copyDefaults(); }
      if (typeof text !== 'string') return copyDefaults();
      const r = normalizeSettings(text);
      if (r.problems.length) { try { await invoke('expo_settings_write', { text, bad: true }); } catch { /* копия не сохранилась */ } }
      return r.settings;
    },
    async save(s) { await invoke('expo_settings_write', { text: serialize(s) }); },
  };
}

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Хранилище настроек: в окне приложения — файл expo.json, в браузере — localStorage. */
export function settingsStore(): SettingsStore {
  if (inApp()) return appSettingsStore(async (cmd, args) => (await import('@tauri-apps/api/core')).invoke(cmd, args));
  return localSettingsStore(globalThis.localStorage);
}
