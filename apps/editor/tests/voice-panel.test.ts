import { describe, expect, it } from 'vitest';
import {
  BARGE_WORD_HINT, DEFAULT_SETTINGS, ENABLED_KEY, HOLD_MAX_MS, STANDBY_TEXT, SayGate, UTT_WAIT_MS, chiefTalking, settleAec, aecChange, aecHint, resetStored, storeSettings, FEED_MAX, NOT_INSTALLED, UNSUPPORTED, VOICE_DISABLED, bargeHint, feedAdd, feedCorrection, feedEcho, feedResolve, feedUtterance, panelState, parseEnabled, parseSettings, type FeedItem, type PanelInput,
  COLLAPSE_MS, PanelSize, fitsStrip, parsePanelMode, topPlace, anchorBottom, fullHeight, RAIL_W, stripCut, stripLines, STRIP_LINE_CHARS, STRIP_OVER_CHARS,
} from '../src/voice/panel-state';
import { freeOffset } from '../src/engine/free-center';

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
  it('окно открыто или закрыто (clear с keep) — keep-фразы остаются и уходят по часам; без keep — всё забыто', () => {
    reset();
    const g = mk();
    g.speech(true);
    g.say(1, 'Обычная.');
    g.say(2, 'Готов ответ советника.', true);
    g.clear({ keep: true });
    expect(sent).toEqual([]);
    now += 1000;
    g.tick();
    expect(sent).toEqual(['2:Готов ответ советника.']);
    g.speech(true);
    g.say(3, 'Ещё.', true);
    g.clear(); // выключение голоса, обрыв связи: забыто всё
    now += 20_000;
    g.tick();
    expect(sent).toEqual(['2:Готов ответ советника.']);
  });
  it('человек говорит — фразы ждут конца речи и уходят по порядку', () => {
    reset();
    const g = mk();
    g.speech(true);
    g.say(1, 'Открываю.');
    g.say(2, 'Сделано.');
    expect(sent).toEqual([]);
    g.speech(false);
    g.utterance(); // реплика пришла и разобрана (или «не мне»)
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

describe('голос без рук: состояние панели', () => {
  it('дежурю — «Дежурю. Скажите: «Штаб, на связь»»; выключенный голос важнее дежурства', () => {
    expect(STANDBY_TEXT).toBe('Дежурю. Скажите: «Штаб, на связь»');
    expect(panelState({ ...base, standby: true })).toEqual({ key: 'standby', text: STANDBY_TEXT });
    expect(panelState({ ...base, standby: true, listening: true, speaking: true }).key).toBe('standby');
    expect(panelState({ ...base, standby: true, enabled: false }).key).toBe('disabled');
    expect(panelState({ ...base, standby: true, status: 'reconnecting' }).key).toBe('reconnecting');
  });
});

describe('ответ ждёт реплику после конца речи (N2)', () => {
  let sent: string[] = [];
  let now = 0;
  const mk = () => new SayGate((id, text) => sent.push(`${id}:${text}`), () => now, () => false);
  it('ожидание конца речи — 8 с, а не 15', () => {
    expect(HOLD_MAX_MS).toBe(8000);
    expect(UTT_WAIT_MS).toBe(2000);
  });
  it('настоящий порядок протокола: речь → ответ готов → конец речи → реплика → старый ответ снят', () => {
    sent = []; now = 1000;
    const g = mk();
    g.speech(true);
    g.say(1, 'Обстановка спокойная.');
    g.speech(false);
    expect(sent).toEqual([]); // ждёт реплику: может быть новая просьба
    g.drop(); // разборщик: новая реплика — supersede
    g.utterance();
    expect(sent).toEqual([]);
    g.say(2, 'Открываю карты.');
    expect(sent).toEqual(['2:Открываю карты.']);
  });
  it('реплика «не мне» или эхо — ответ отпускается сразу', () => {
    sent = []; now = 1000;
    const g = mk();
    g.speech(true);
    g.say(1, 'Обстановка спокойная.');
    g.speech(false);
    g.utterance();
    expect(sent).toEqual(['1:Обстановка спокойная.']);
  });
  it('реплики нет (кашель) — не дольше 2 с', () => {
    sent = []; now = 1000;
    const g = mk();
    g.speech(true);
    g.say(1, 'Есть.');
    g.speech(false);
    now += UTT_WAIT_MS - 1;
    g.tick();
    expect(sent).toEqual([]);
    now += 2;
    g.tick();
    expect(sent).toEqual(['1:Есть.']);
  });
});

describe('ответ модели во время «повторяю запрос» ждёт конца речи (N5)', () => {
  it('звучат только тихие фразы о модели — штаб «не говорит», ворота держат ответ', () => {
    expect(chiefTalking(new Set([5]), new Set([5]))).toBe(false);
    expect(chiefTalking(new Set([5, 6]), new Set([5]))).toBe(true);
    expect(chiefTalking(new Set(), new Set())).toBe(false);
    const sent: string[] = [];
    const speaking = new Set([5]);
    const quiet = new Set([5]);
    const g = new SayGate((id, text) => sent.push(`${id}:${text}`), () => 1000, () => chiefTalking(speaking, quiet));
    g.speech(true);
    g.say(7, 'Обстановка спокойная.');
    expect(sent).toEqual([]);
  });
});

describe('ручная правка до ответа сервиса (N5)', () => {
  const cfg = { vad: 0.4, barge_vad: 0.6, barge_ms: 300, end_ms: 400, barge_mode: 'voice' as const };
  it('подавление эха ещё неизвестно — ложной рамки «пройдите калибровку» нет; ответ сервиса его дописывает', () => {
    const raw = storeSettings(null, cfg, { aec: undefined });
    expect(aecChange(raw, true)).toBeNull();
    expect(aecChange(raw, false)).toBeNull();
    const settled = settleAec(raw, true)!;
    expect(JSON.parse(settled)).toMatchObject({ ...cfg, aec: true });
    expect(JSON.parse(settled).aec_unknown).toBeUndefined();
    expect(aecChange(settled, true)).toBeNull();
    expect(aecChange(settled, false)).toBe('off');
    // отмеченное — не трогается; старые без отметки — тоже (как прежде)
    expect(settleAec(storeSettings(null, cfg, { aec: false, calibrated: true }), true)).toBeNull();
    expect(settleAec(JSON.stringify(cfg), true)).toBeNull();
    expect(settleAec(raw, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------- компактная панель (Task 1b)

describe('компактная панель: вид по умолчанию, сама разворачивается и сворачивается', () => {
  let now = 0;
  const quiet = { speaking: false, pending: false };
  it('сохранённый вид: значок, развёрнута; прочее (и прежнее «open») — компактная полоса', () => {
    expect(parsePanelMode('icon')).toBe('icon');
    expect(parsePanelMode('full')).toBe('full');
    expect(parsePanelMode('open')).toBe('compact');
    expect(parsePanelMode(null)).toBe('compact');
    expect(parsePanelMode('мусор')).toBe('compact');
  });
  it('фраза штаба в две строки полосы — полоса; длиннее — та же полоса, но фраза целиком (панель не разворачивается)', () => {
    expect(fitsStrip('Слушаю.')).toBe(true);
    expect(fitsStrip('Открываю переигровку. Скажите, что считать.')).toBe(true);
    expect(fitsStrip('Можно сказать: «штаб, открой переигровку», «штаб, что я могу?», «штаб, калибровка», «штаб, голоса».')).toBe(false);
    const s = new PanelSize('compact', () => now);
    expect(s.view(false)).toBe('compact');
    s.chief('Слушаю.');
    expect(s.view(false)).toBe('compact');
    expect(s.whole(false)).toBe(false);
    s.chief('Можно сказать: «штаб, открой переигровку», «штаб, что я могу?», «штаб, калибровка», «штаб, голоса».');
    expect(s.view(false)).toBe('compact');
    expect(s.whole(false)).toBe(true);
  });
  it('фраза целиком — пока штаб говорит и ещё 10 с тишины (не меньше), потом снова обрезана', () => {
    now = 1000;
    const s = new PanelSize('compact', () => now);
    s.chief('x'.repeat(200));
    s.update({ speaking: true, pending: false });
    now += 30_000; // штаб говорит долго — фраза целиком
    s.update({ speaking: true, pending: false });
    expect(s.whole(false)).toBe(true);
    s.update(quiet); // договорил
    now += COLLAPSE_MS - 1;
    s.update(quiet);
    expect(s.whole(false)).toBe(true);
    now += 1;
    s.update(quiet);
    expect(s.whole(false)).toBe(false);
    expect(s.view(false)).toBe('compact');
    expect(COLLAPSE_MS).toBe(10_000);
  });
  it('вопрос «да / нет» из значка — полоса с кнопками, не развёрнутая панель; пока ждёт ответа — держится; ответили — через 10 с значок', () => {
    now = 0;
    const s = new PanelSize('icon', () => now);
    s.update({ speaking: false, pending: true });
    expect(s.view(false)).toBe('compact');
    now += 60_000;
    s.update({ speaking: false, pending: true });
    expect(s.view(false)).toBe('compact');
    s.update(quiet);
    now += COLLAPSE_MS;
    s.update(quiet);
    expect(s.view(false)).toBe('icon');
  });
  it('из значка длинная фраза не разворачивает — значок выбран человеком', () => {
    const s = new PanelSize('icon', () => now);
    s.chief('x'.repeat(200));
    expect(s.view(false)).toBe('icon');
  });
  it('развёрнутая вручную не сворачивается сама; «Свернуть» — полоса сразу, без 10 с', () => {
    now = 0;
    const s = new PanelSize('compact', () => now);
    s.set('full');
    s.update(quiet);
    now += 10 * COLLAPSE_MS;
    s.update(quiet);
    expect(s.view(false)).toBe('full');
    s.chief('x'.repeat(200)); // развёрнутая вручную — так и остаётся
    expect(s.view(false)).toBe('full');
    expect(s.whole(false)).toBe(false);
    s.set('compact');
    expect(s.view(false)).toBe('compact');
    // фраза целиком, а человек выбрал полосу кнопкой — обрезана сразу
    s.chief('x'.repeat(200));
    expect(s.whole(false)).toBe(true);
    s.set('compact');
    expect(s.whole(false)).toBe(false);
  });
  it('открыто окно — панель компактна (и развёрнутая вручную, и с вопросом); значок остаётся значком', () => {
    const s = new PanelSize('full', () => now);
    expect(s.view(true)).toBe('compact');
    s.set('compact');
    s.update({ speaking: false, pending: true });
    expect(s.view(true)).toBe('compact');
    expect(new PanelSize('icon', () => now).view(true)).toBe('icon');
  });
});

describe('панель — сверху по центру, под верхней полосой кнопок (topPlace)', () => {
  it('по центру свободной области справа от колонки разделов, сразу под верхней полосой', () => {
    const p = topPlace(1440, 500, 38);
    expect(p.left + 250).toBeCloseTo(RAIL_W + (1440 - RAIL_W) / 2, 5);
    expect(p.top).toBe(46);
    // узкое окно — не левее колонки разделов
    expect(topPlace(600, 560, 0).left).toBeGreaterThanOrEqual(RAIL_W);
  });
  it('верхняя полоса — нижний край видимых шапок у верха экрана; шапок нет — от самого верха', () => {
    expect(anchorBottom([{ top: 0, bottom: 38, width: 900 }, { top: 0, bottom: 52, width: 300 }])).toBe(52);
    expect(anchorBottom([{ top: 400, bottom: 460, width: 300 }])).toBe(0); // не у верха — не шапка
    expect(anchorBottom([{ top: 0, bottom: 40, width: 0 }])).toBe(0); // не видна
    expect(anchorBottom([])).toBe(0);
  });
  it('развёрнутая панель раскрывается вниз и оставляет низ экрана подписи тура', () => {
    expect(fullHeight(900, 46)).toBeLessThanOrEqual(900 - 46 - 400);
    expect(fullHeight(900, 46)).toBeGreaterThanOrEqual(260);
    expect(fullHeight(2000, 46)).toBe(520);
  });
});

describe('карта: центр — в свободной части (freeOffset)', () => {
  const map = { left: 400, top: 50, width: 1040, height: 850 };
  it('ничего не закрывает — смещения нет', () => {
    expect(freeOffset(map, [])).toEqual({ dx: 0, dy: 0 });
    expect(freeOffset(map, [{ left: 0, top: 0, width: 300, height: 900 }])).toEqual({ dx: 0, dy: 0 }); // вне карты
  });
  it('развёрнутая панель справа — центр левее на половину её ширины', () => {
    const o = freeOffset(map, [{ left: 986, top: 160, width: 440, height: 640 }]);
    expect(o.dy).toBe(0);
    expect(o.dx).toBeCloseTo(-(map.left + map.width - 986) / 2, 5);
  });
  it('полоса внизу справа — выше (по меньшей потере площади), легенда внизу слева — тоже выше', () => {
    const strip = freeOffset(map, [{ left: 986, top: 694, width: 440, height: 110 }]);
    expect(strip.dx).toBe(0);
    expect(strip.dy).toBeCloseTo(-(map.top + map.height - 694) / 2, 5);
    const both = freeOffset(map, [{ left: 986, top: 694, width: 440, height: 110 }, { left: 414, top: 760, width: 200, height: 48 }]);
    expect(both.dy).toBeCloseTo(-(map.top + map.height - 694) / 2, 5);
  });
  it('закрыто почти всё — смещение не больше трети размера карты', () => {
    const o = freeOffset(map, [{ left: 420, top: 60, width: 1020, height: 840 }]);
    expect(Math.abs(o.dx)).toBeLessThanOrEqual(map.width / 3);
    expect(Math.abs(o.dy)).toBeLessThanOrEqual(map.height / 3);
  });
});

describe('раунд 1 (Task 1b): окно и полоса', () => {
  it('M-2: фраза штаба при открытом окне (чтение вопроса) не раскрывает полосу; закрыли окно — обрезана сразу', () => {
    let now = 0;
    const s = new PanelSize('compact', () => now);
    s.setModal(true);
    s.chief('x'.repeat(300)); // окно читает длинный вопрос
    expect(s.view(true)).toBe('compact');
    expect(s.whole(true)).toBe(false);
    s.setModal(false);
    expect(s.whole(false)).toBe(false);
    // раскрылась сама до окна — после окна фраза снова обрезана
    s.chief('x'.repeat(300));
    expect(s.whole(false)).toBe(true);
    s.setModal(true);
    expect(s.whole(true)).toBe(false);
    s.setModal(false);
    expect(s.whole(false)).toBe(false);
    // вопрос «да / нет» после окна — полоса, как и без окна
    s.update({ speaking: false, pending: true });
    expect(s.view(false)).toBe('compact');
  });
  it('M-4: при открытом окне фраза — до трёх строк; длиннее — обрезана, и это видно (повторить)', () => {
    expect(stripLines(false)).toBe(2);
    expect(stripLines(true)).toBe(3);
    expect(stripCut('Скажите «готово».', true)).toBe(false);
    expect(stripCut('x'.repeat(STRIP_OVER_CHARS * 3), true)).toBe(false);
    expect(stripCut('x'.repeat(STRIP_OVER_CHARS * 3 + 1), true)).toBe(true);
    expect(stripCut('x'.repeat(STRIP_LINE_CHARS * 2 + 1), false)).toBe(true);
  });
});
