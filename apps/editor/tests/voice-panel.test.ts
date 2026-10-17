import { describe, expect, it } from 'vitest';
import {
  ENABLED_KEY, FEED_MAX, NOT_INSTALLED, UNSUPPORTED, VOICE_DISABLED, feedAdd, feedEcho, feedResolve, feedUtterance, panelState, parseEnabled, parseSettings, type FeedItem, type PanelInput,
} from '../src/voice/panel-state';

const base: PanelInput = { status: 'ready', speaking: false, listening: false, thinking: false, conversation: false };

describe('panelState', () => {
  it('состояние сервиса — простыми словами', () => {
    expect(panelState({ ...base, status: 'off' }).text).toBe(NOT_INSTALLED);
    expect(panelState({ ...base, status: 'loading' }).text).toBe('Голос загружается');
    expect(panelState({ ...base, status: 'connecting' }).text).toBe('Голос загружается');
    expect(panelState({ ...base, status: 'reconnecting' }).text).toBe('Переподключаюсь');
    expect(panelState({ ...base, status: 'error' }).key).toBe('error');
    expect(panelState({ ...base, status: 'error' }).text).toBe('Голос не запустился — перезапустите программу');
    expect(panelState({ ...base, status: 'unsupported' })).toEqual({ key: 'unsupported', text: UNSUPPORTED });
    expect(UNSUPPORTED).toBe('Голос в этой версии недоступен');
  });

  it('готов: говорит важнее слушает, слушает важнее думает, дальше — разговор и ожидание', () => {
    expect(panelState({ ...base, speaking: true, listening: true, thinking: true }).text).toBe('Говорит начальник штаба');
    expect(panelState({ ...base, listening: true, thinking: true }).text).toBe('Слушаю');
    expect(panelState({ ...base, thinking: true, conversation: true }).text).toBe('Думаю');
    expect(panelState({ ...base, conversation: true }).key).toBe('conversation');
    expect(panelState(base).text).toBe('Жду обращения');
  });

  it('без микрофона и во время калибровки — об этом, а не «жду обращения»', () => {
    expect(panelState({ ...base, micError: 'нет' }).key).toBe('mic');
    expect(panelState({ ...base, busy: 'Калибровка' }).text).toBe('Калибровка');
    // не установлен — важнее ошибки микрофона: микрофон и не нужен
    expect(panelState({ ...base, status: 'off', micError: 'нет' }).key).toBe('off');
  });

  it('голос выключен человеком — «Голос выключен», что бы ни было с сервисом и микрофоном', () => {
    expect(VOICE_DISABLED).toBe('Голос выключен');
    expect(panelState({ ...base, enabled: false })).toEqual({ key: 'disabled', text: 'Голос выключен' });
    for (const k of [{ status: 'off' }, { status: 'error' }, { status: 'loading' }, { status: 'reconnecting' }, { micError: 'нет' },
      { busy: 'Калибровка' }, { speaking: true }, { listening: true }, { thinking: true }, { conversation: true }] as Partial<PanelInput>[])
      expect(panelState({ ...base, ...k, enabled: false }).key).toBe('disabled');
    // голоса в этой версии нет — панели нет вовсе, выключать нечего
    expect(panelState({ ...base, status: 'unsupported', enabled: false }).key).toBe('unsupported');
    // по умолчанию — включён
    expect(panelState(base).key).toBe('idle');
    expect(panelState({ ...base, enabled: true }).key).toBe('idle');
  });

  it('в словах состояния нет технических терминов', () => {
    const keys: Partial<PanelInput>[] = [{ status: 'off' }, { status: 'unsupported' }, { status: 'error' }, { status: 'loading' }, { status: 'reconnecting' },
      { speaking: true }, { listening: true }, { thinking: true }, { conversation: true }, { enabled: false }, {}];
    for (const k of keys) expect(panelState({ ...base, ...k }).text).not.toMatch(/VAD|Smart Turn|порог|WebSocket/i);
  });
});

describe('parseSettings', () => {
  it('берёт известные поля в пределах, остальное отбрасывает', () => {
    expect(parseSettings(JSON.stringify({ vad: 0.35, barge_vad: 0.9, barge_ms: 400, end_ms: 20, x: 1 })))
      .toEqual({ vad: 0.35, barge_vad: 0.9, barge_ms: 400, end_ms: 20 });
    expect(parseSettings(JSON.stringify({ vad: 7, barge_vad: '0.5', end_ms: 400 }))).toEqual({ end_ms: 400 });
  });
  it('пусто и мусор — пустой объект', () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings('{не json')).toEqual({});
    expect(parseSettings('[1,2]')).toEqual({});
  });
});

describe('лента', () => {
  it('реплика — «услышано», потом итог разбора: не обращено — «не мне»', () => {
    let f: FeedItem[] = [];
    f = feedUtterance(f, { id: 1, text: 'штаб, открой переигровку' });
    f = feedUtterance(f, { id: 2, text: 'передайте в штаб армии' });
    expect(f.map((x) => x.kind)).toEqual(['heard', 'heard']);
    f = feedResolve(f, 1, 'done');
    f = feedResolve(f, 2, 'ignored');
    expect(f.map((x) => x.kind)).toEqual(['me', 'notme']);
  });

  it('склеенная реплика заменяет прежнюю и встаёт в конец', () => {
    let f: FeedItem[] = [];
    f = feedUtterance(f, { id: 1, text: 'штаб, открой' });
    f = feedAdd(f, { key: 'c1', kind: 'chief', text: 'Слушаю.' });
    f = feedUtterance(f, { id: 2, text: 'штаб, открой переигровку', continues: 1 });
    expect(f.map((x) => x.text)).toEqual(['Слушаю.', 'штаб, открой переигровку']);
    expect(f[1].utt).toBe(2);
  });

  it('эхо — в ленте с пояснением, что это похоже на голос штаба из динамиков', () => {
    const f = feedEcho([], 'штаб, открой переигровку', 7);
    expect(f).toEqual([{ key: 'x7', kind: 'echo', text: 'штаб, открой переигровку' }]);
    expect(feedEcho(f, 'ещё', 8)).toHaveLength(2);
  });

  it(`не длиннее ${FEED_MAX} записей`, () => {
    let f: FeedItem[] = [];
    for (let i = 0; i < FEED_MAX + 5; i++) f = feedAdd(f, { key: `n${i}`, kind: 'note', text: String(i) });
    expect(f).toHaveLength(FEED_MAX);
    expect(f[0].text).toBe('5');
  });
});

describe('parseEnabled', () => {
  it('включён, пока человек не выключил; выключение — только «false»', () => {
    expect(ENABLED_KEY).toBe('def_ops.voice.enabled');
    expect(parseEnabled(null)).toBe(true);
    expect(parseEnabled('true')).toBe(true);
    expect(parseEnabled('false')).toBe(false);
    expect(parseEnabled('мусор')).toBe(true);
  });
});
