import { describe, expect, it } from 'vitest';
import {
  BARGE_WORD_HINT, DEFAULT_SETTINGS, ENABLED_KEY, HOLD_MAX_MS, SayGate, aecChange, aecHint, resetStored, storeSettings, FEED_MAX, NOT_INSTALLED, UNSUPPORTED, VOICE_DISABLED, bargeHint, feedAdd, feedCorrection, feedEcho, feedResolve, feedUtterance, panelState, parseEnabled, parseSettings, type FeedItem, type PanelInput,
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
  it('режим перебивания — «голосом» или «словом», чужое значение отбрасывается', () => {
    expect(parseSettings(JSON.stringify({ barge_mode: 'word', vad: 0.4 }))).toEqual({ barge_mode: 'word', vad: 0.4 });
    expect(parseSettings(JSON.stringify({ barge_mode: 'voice' }))).toEqual({ barge_mode: 'voice' });
    expect(parseSettings(JSON.stringify({ barge_mode: 'громко' }))).toEqual({});
    expect(parseSettings(JSON.stringify({ barge_mode: 1 }))).toEqual({});
    expect(DEFAULT_SETTINGS.barge_mode).toBe('voice');
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

describe('перебивание словом', () => {
  it('подсказка «Перебить: скажите «Стоп»» — только пока штаб говорит в режиме «словом»', () => {
    expect(BARGE_WORD_HINT).toBe('Перебить: скажите «Стоп»');
    expect(bargeHint(true, 'word')).toBe(BARGE_WORD_HINT);
    expect(bargeHint(false, 'word')).toBeNull();
    expect(bargeHint(true, 'voice')).toBeNull();
  });
});

describe('поправка распознанного', () => {
  it('«Услышано: … — понял: …» после реплики с поправками; без поправок — ничего', () => {
    let f = feedUtterance([], { id: 3, text: 'штап открой пере игровку' });
    f = feedCorrection(f, 3, 'штап открой пере игровку', { fixes: ['штап → штаб', 'пере игровку → переигровка'], understood: 'штаб открой переигровка' });
    expect(f.at(-1)).toEqual({ key: 'f3', kind: 'fix', text: 'Услышано: «штап открой пере игровку» — понял: «штаб открой переигровка»' });
    expect(feedCorrection(f, 4, 'штаб открой карты', { fixes: [], understood: 'штаб открой карты' })).toBe(f);
  });
});

describe('фраза штаба ждёт конца реплики (SayGate)', () => {
  let sent: string[] = [];
  let now = 0;
  let busy = false;
  const mk = () => new SayGate((id, text) => sent.push(`${id}:${text}`), () => now, () => busy);
  const reset = () => { sent = []; now = 1000; busy = false; };

  it('человек молчит — фраза уходит сразу', () => {
    reset();
    const g = mk();
    g.say(1, 'Слушаю.');
    expect(sent).toEqual(['1:Слушаю.']);
  });
  it('человек говорит — фразы ждут конца речи и уходят по порядку', () => {
    reset();
    const g = mk();
    g.speech(true);
    g.say(1, 'Открываю.');
    g.say(2, 'Сделано.');
    expect(sent).toEqual([]);
    g.speech(false);
    expect(sent).toEqual(['1:Открываю.', '2:Сделано.']);
  });
  it('штаб уже говорит — следующая фраза его ответа не ждёт (речь в микрофоне — скорее эхо)', () => {
    reset();
    const g = mk();
    g.speech(true);
    busy = true;
    g.say(1, 'Знаков двенадцать.');
    expect(sent).toEqual(['1:Знаков двенадцать.']);
  });
  it('новая реплика — ждущие фразы снимаются (drop), одну можно снять по номеру', () => {
    reset();
    const g = mk();
    g.speech(true);
    g.say(1, 'а'); g.say(2, 'б'); g.say(3, 'в');
    expect(g.drop(2)).toBe(true);
    expect(g.drop(7)).toBe(false);
    g.drop();
    g.speech(false);
    expect(sent).toEqual([]);
  });
  it('речь «идёт» дольше HOLD_MAX_MS (конца не пришло) — фразы не зависают', () => {
    reset();
    const g = mk();
    g.speech(true);
    g.say(1, 'Слушаю.');
    now += HOLD_MAX_MS - 1;
    g.tick();
    expect(sent).toEqual([]);
    now += 2;
    g.tick();
    expect(sent).toEqual(['1:Слушаю.']);
    g.say(2, 'Есть.');
    expect(sent).toEqual(['1:Слушаю.', '2:Есть.']);
  });
  it('clear — очередь пуста, ожидание снято', () => {
    reset();
    const g = mk();
    g.speech(true);
    g.say(1, 'а');
    g.clear();
    g.say(2, 'б');
    expect(sent).toEqual(['2:б']);
  });
});

describe('калибровка помнит подавление эха', () => {
  const cfg = { vad: 0.4, barge_vad: 0.6, barge_ms: 300, end_ms: 400, barge_mode: 'voice' as const };
  it('калибровка сохраняет режим подавления эха и свой режим перебивания', () => {
    const raw = storeSettings(null, cfg, { aec: true, calibrated: true });
    expect(JSON.parse(raw)).toEqual({ ...cfg, aec: true, calib_mode: 'voice' });
    expect(aecChange(raw, true)).toBeNull();
    // ручная правка не меняет того, при каком подавлении эха снята калибровка
    const raw2 = storeSettings(raw, { ...cfg, barge_mode: 'word' }, { aec: false });
    expect(JSON.parse(raw2)).toMatchObject({ barge_mode: 'word', aec: true, calib_mode: 'voice' });
    // без калибровки — запоминается текущий режим
    expect(JSON.parse(storeSettings(null, cfg, { aec: false })).aec).toBe(false);
  });
  it('режим сервиса другой — расхождение; старые настройки без aec — расхождение, если сейчас aec включено', () => {
    const on = storeSettings(null, cfg, { aec: true, calibrated: true });
    const off = storeSettings(null, cfg, { aec: false, calibrated: true });
    expect(aecChange(on, false)).toBe('off');
    expect(aecChange(off, true)).toBe('on');
    expect(aecChange(off, false)).toBeNull();
    const old = JSON.stringify(cfg);
    expect(aecChange(old, true)).toBe('on');
    expect(aecChange(old, false)).toBeNull();
    // не настраивали вовсе, мусор, сервис ещё не ответил — расхождения нет
    expect(aecChange(null, true)).toBeNull();
    expect(aecChange('мусор', true)).toBeNull();
    expect(aecChange(on, undefined)).toBeNull();
  });
  it('подсказка — простыми словами, с просьбой пройти калибровку', () => {
    expect(aecHint('on')).toBe('Подавление эха включено после настройки — пройдите калибровку заново.');
    expect(aecHint('off')).toBe('Подавление эха выключено после настройки — пройдите калибровку заново.');
  });
});

describe('«По умолчанию» в тонкой настройке', () => {
  const cfg = { vad: 0.4, barge_vad: 0.6, barge_ms: 500, end_ms: 300, barge_mode: 'word' as const };
  it('калибровка выбрала «словом» — регуляторы по умолчанию, режим «словом» остаётся', () => {
    const raw = storeSettings(storeSettings(null, cfg, { aec: false, calibrated: true }), { ...cfg, barge_mode: 'voice' }, {});
    const r = resetStored(raw);
    expect(r.cfg).toEqual({ ...DEFAULT_SETTINGS, barge_mode: 'word' });
    expect(JSON.parse(r.stored!)).toEqual({ ...DEFAULT_SETTINGS, barge_mode: 'word', aec: false, calib_mode: 'word' });
  });
  it('калибровки не было — всё по умолчанию, сохранённое стирается', () => {
    expect(resetStored(null)).toEqual({ cfg: DEFAULT_SETTINGS, stored: null });
    expect(resetStored(JSON.stringify({ vad: 0.3, barge_mode: 'voice' }))).toEqual({ cfg: DEFAULT_SETTINGS, stored: null });
  });
  it('старые настройки без отметки калибровки с «словом» — «словом» остаётся (безопасно)', () => {
    expect(resetStored(JSON.stringify({ vad: 0.3, barge_mode: 'word' })).cfg.barge_mode).toBe('word');
  });
});
