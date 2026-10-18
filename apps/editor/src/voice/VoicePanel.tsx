/**
 * Панель голоса поверх любого раздела: свёрнута — значок (цвет — состояние), развёрнута — состояние словами,
 * уровень речи с отметками, лента реплик, «Что можно сказать», калибровка, голоса и тонкая настройка.
 *
 * Пользователи — люди старшего возраста: крупный шрифт (не меньше 18 px), простые слова, регуляторы спрятаны
 * в «Тонкую настройку», главный путь — калибровка. Панель создаёт связь с сервисом (VoiceClient) и разборщик
 * реплик (Dispatcher) с моделью за правилами (llm.ts: модель «Голос» из раздела «ИИ»; пока она отвечает — «Думаю»,
 * новая реплика отменяет её прежний ответ); событие окна `voice:open` (detail 'calibrate' | 'voices', кнопкой — {what, manual})
 * открывает нужный экран.
 * Модель недоступна (проверка связи в «ИИ» не прошла или запрос не удался) — разборщик её не зовёт и сразу отвечает честно.
 *
 * Фраза штаба не начинается, пока человек говорит (SayGate: ждёт конца речи); заготовленные фразы о модели окно
 * разговора заново не открывают. Окно калибровки или голосов отменяет ожидание модели и глушит речь штаба.
 * Регуляторы помнят, при каком подавлении эха сняты: сервис теперь другой — подсказка пройти калибровку, а перебивание
 * до неё — «словом».
 *
 * Кнопка «Выключить голос» / «Включить голос» и событие окна `voice:power` (detail: boolean)
 * выключают голос: микрофон закрыт и сам не открывается (включить голосом тогда нельзя), звук штаба остановлен, связь
 * с сервисом остаётся. Выбор запоминается между запусками (ENABLED_KEY); по умолчанию голос включён.
 *
 * Без рук: «Штаб, отбой» — дежурный режим (событие окна `voice:standby`, detail: boolean): микрофон открыт, штаб ждёт
 * только «Штаб, на связь». Необратимое голосом — после «да»: вопрос крупно с кнопками «Да» / «Нет» (действия
 * `voice.yes` / `voice.no`). Окна, ждущие ответа (registry.openModal: вопросы dialogs.ts, калибровка, «Голоса»),
 * зачитываются штабом (registry.speak — через эту панель). Событие окна `voice:propose` (detail: {text, action,
 * params?}) — штаб спрашивает «да / нет» и на «да» исполняет действие. Голос впервые готов за запуск — событие
 * `voice:ready-first` (detail: {calibrated}, отменяемое): не отменили и калибровки не было — штаб предлагает её.
 *
 * Тур (voice/tour.tsx) говорит тем же путём, что ответы штаба (useTourVoice); `voice:open` с detail 'panel'
 * разворачивает панель (подготовка тура по ней). Элементы панели помечены `data-tour` для подсветки.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceClient } from './client';
import { CONVERSATION_S, Dispatcher, type Pending } from './dispatch';
import { createVoiceModel } from './llm';
import { ActButton, act, actions, listed, onModal, setProposer, setRetractor, setSpeaker, useAction } from './registry';
import type { LlmSettings } from '../sim/game-protocol';
import type { VoiceInfo, VoiceRoles, VoiceSettings, VoiceStatus } from './protocol';
import {
  DEFAULT_SETTINGS, ENABLED_KEY, SETTINGS_KEY, SayGate, aecChange, aecHint, bargeHint, chiefTalking, feedAdd, feedCorrection, feedEcho, feedResolve, feedUtterance, panelState,
  parseEnabled, parseSettings, resetStored, settleAec, storeSettings, wasCalibrated, type FeedItem,
} from './panel-state';
import { Calibration } from './Calibration';
import { Voices } from './Voices';
import { settleSpeech, stopTourSpeech, useIntroSetting, useTourVoice } from './tour';

const OPEN_KEY = 'def_ops.voice.panel';
const API_POLL_MS = 5000;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
/** Отказ микрофона простыми словами: разобранные причины — как есть, прочие — с пояснением, что случилось. */
const micText = (e: Error) => (/^(Микрофон|Браузер)/.test(e.message) ? e.message : `Микрофон не подключился: ${e.message}`);
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } };

/** Что сервис сообщил при подключении: голоса, роли, текст для записи нового голоса, подавляет ли он эхо. */
export interface VoiceReady { voices: VoiceInfo[]; roles: VoiceRoles; recordText: string; aec: boolean }

const OFFER_CALIBRATION = 'Голос готов. Калибровки ещё не было — провести её сейчас?';

/**
 * llmCheck — итог проверки связи с моделью в «ИИ» ('fail' — модель голосом не зовётся); recheck — проверить связь
 * заново (голос перепроверяет её при обращении, если модель «недоступна»).
 */
export function VoicePanel({ section, llm, llmCheck, recheck }: {
  section: string; llm: LlmSettings; llmCheck?: string; recheck?: () => Promise<{ state: string }>;
}) {
  const [enabled, setEnabledState] = useState(() => parseEnabled(lsGet(ENABLED_KEY)));
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const client = useMemo(() => {
    const c = new VoiceClient();
    if (!enabledRef.current) void c.setEnabled(false);
    return c;
  }, []);
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const llmRef = useRef(llm);
  llmRef.current = llm;
  const llmCheckRef = useRef(llmCheck);
  llmCheckRef.current = llmCheck;
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;

  const [status, setStatus] = useState<VoiceStatus>(client.status);
  const [open, setOpen] = useState(() => lsGet(OPEN_KEY) === 'open');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [level, setLevel] = useState({ p: 0, busy: false });
  const [cfg, setCfg] = useState<VoiceSettings>(() => ({ ...DEFAULT_SETTINGS, ...parseSettings(lsGet(SETTINGS_KEY)) }));
  /** Сохранённые регуляторы (строка SETTINGS_KEY): с ними сверяется подавление эха сервиса. */
  const [saved, setSaved] = useState<string | null>(() => lsGet(SETTINGS_KEY));
  const persist = (v: string | null) => { lsSet(SETTINGS_KEY, v); setSaved(v); };
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const speakingIds = useRef(new Set<number>());
  const previewIds = useRef(new Set<number>());
  /** Заготовленные фразы о модели: доиграв, окно разговора заново не открывают. */
  const quietIds = useRef(new Set<number>());
  const [speaking, setSpeaking] = useState(false);
  const [spokeAt, setSpokeAt] = useState(-Infinity);
  const [now, setNow] = useState(() => Date.now());
  const [micError, setMicError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'calibrate' | 'voices'>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  /** калибровка открыта голосом — шаги идут сами */
  const [autoCalib, setAutoCalib] = useState(false);
  const [standby, setStandby] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  /** Фразы, окончания которых ждут (калибровка и «Голоса» говорят, потом действуют). */
  const waiters = useRef(new Map<number, () => void>());
  const settle = (id: number) => { const w = waiters.current.get(id); if (w) { waiters.current.delete(id); w(); } };
  const settleAll = () => { const ws = [...waiters.current.values()]; waiters.current.clear(); ws.forEach((w) => w()); };
  const readyFirst = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState<VoiceReady | null>(null);
  const started = useRef(false);

  const syncSpeaking = () => setSpeaking(speakingIds.current.size > 0);
  // фраза штаба ждёт конца речи человека: не говорит поверх него и не обрывает себя его же репликой
  const gate = useMemo(() => new SayGate((id, text, role) => {
    speakingIds.current.add(id);
    syncSpeaking();
    client.say(id, role ?? 'chief', text);
    setFeed((f) => feedAdd(f, { key: `s${id}`, kind: role === 'umpire' ? 'umpire' : 'chief', text }));
  // «штаб говорит» — только настоящей фразой: пока звучит лишь «повторяю запрос», ответ модели ждёт конца речи человека;
  // снятые ждущие фразы — тур узнаёт, что они не прозвучат
  }, () => Date.now(), () => chiefTalking(speakingIds.current, quietIds.current), (ids) => ids.forEach((id) => settleSpeech(id, 'stopped'))), [client]); // eslint-disable-line react-hooks/exhaustive-deps
  const dispatcher = useMemo(() => new Dispatcher({
    now: () => Date.now(),
    section: () => sectionRef.current,
    // во время шага калибровки и записи голоса сервис фраз не произносит (say-done stopped) — замер не испортится
    say: (text, o) => {
      const id = client.newSayId();
      if (o?.quiet) quietIds.current.add(id);
      gate.say(id, text, o?.keep, o?.role);
      return id;
    },
    // фраза больше не нужна («повторяю запрос» после отмены): ждёт — снимается, звучит — гасится
    unsay: (id) => {
      quietIds.current.delete(id);
      if (gate.drop(id)) return;
      if (speakingIds.current.delete(id)) { client.stop(id); syncSpeaking(); }
    },
    supersede: () => gate.dropStale(),
    stop: () => { gate.drop(); client.stop(); speakingIds.current.clear(); syncSpeaking(); stopTourSpeech(); },
    // чего правила не поняли — модель «Голос» (настройки берутся в момент вопроса); проверка связи не прошла — не зовём
    model: createVoiceModel({ settings: () => llmRef.current }),
    modelReady: () => llmCheckRef.current !== 'fail',
    // «недоступна» — перепроверить связь (не дожидаясь возврата в окно): итог сразу виден разборщику
    recheck: async () => {
      const r = await recheckRef.current?.();
      if (r) llmCheckRef.current = r.state;
      return r?.state === 'ok';
    },
    thinking: setThinking,
    onPending: (p) => { setPending(p ? { ...p } : null); if (p) toggle(true); },
    onStandby: setStandby,
  }), [client, gate]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Фраза штаба от окна (калибровка, «Голоса»); промис — когда договорил, фразу сняли или голос не говорит. */
  const sayAndWait = (text: string) => new Promise<void>((resolve) => {
    const id = dispatcher.announce(text);
    if (id === undefined) { resolve(); return; }
    const t = setTimeout(() => settle(id), 6000 + text.length * 120); // фразу могли снять, не сыграв
    waiters.current.set(id, () => { clearTimeout(t); resolve(); });
  });

  // кнопки «Да» / «Нет» подтверждения — те же действия, что и голосом
  useAction({ id: 'voice.yes', section: 'global', title: 'Да', describe: 'Подтверждает то, о чём спросил штаб.',
    available: () => (dispatcher.pending ? true : 'подтверждать нечего'), run: async () => { await dispatcher.answer(true); } });
  useAction({ id: 'voice.no', section: 'global', title: 'Нет', describe: 'Отказ от того, о чём спросил штаб.',
    available: () => (dispatcher.pending ? true : 'подтверждать нечего'), run: async () => { await dispatcher.answer(false); } });
  // панель: развернуть / свернуть — кнопками и голосом
  useAction({ id: 'voice.panel.open', section: 'global', title: 'Открыть панель голоса', describe: 'Разворачивает панель голоса: состояние, лента реплик, что можно сказать.',
    say: ['штаб, открой панель голоса'], available: () => true, run: async () => { toggle(true); } });
  useAction({ id: 'voice.panel.close', section: 'global', title: 'Свернуть панель голоса', describe: 'Сворачивает панель голоса в значок.',
    say: ['штаб, сверни панель голоса'], available: () => true, run: async () => { toggle(false); } });

  // окна и модули говорят через штаб (в дежурном — молчат); открылось окно — прежний ответ модели уже не нужен
  useEffect(() => {
    setSpeaker((t, o) => dispatcher.announce(t, o));
    setRetractor((id) => dispatcher.retract(id));
    // предложения модулей («Составить разбор операции?»): в дежурном и при выключенном голосе — нет
    setProposer((text, id, params) => { if (enabledRef.current && !dispatcher.standby) dispatcher.propose(text, id, params); });
    const off = onModal((_m, opened) => { if (opened) { dispatcher.cancel(); gate.clear(); } });
    return () => { setSpeaker(null); setRetractor(null); setProposer(null); off(); };
  }, [dispatcher, gate]);
  // тур говорит голосом начальника штаба: та же очередь фраз, та же лента
  useTourVoice({
    client,
    send: (id, text) => gate.say(id, text),
    stop: (id) => { if (!gate.drop(id) && speakingIds.current.delete(id)) { client.stop(id); syncSpeaking(); } },
    live: () => enabledRef.current && !dialogRef.current && client.status === 'ready',
  });
  const [intro] = useIntroSetting();

  // связь с моделью проверена заново или настройки модели сменились — прежняя недоступность забыта
  useEffect(() => { if (llmCheck === 'ok') dispatcher.modelBack(); }, [llmCheck, dispatcher]);
  useEffect(() => { dispatcher.modelBack(); }, [llm.url, llm.model, llm.voiceModel, dispatcher]);

  /** Окно калибровки или голосов (auto — открыто голосом): ожидание модели отменено, речь штаба по разговору заглушена. */
  const openDialog = (d: 'calibrate' | 'voices', auto = false) => {
    dialogRef.current = d;
    setAutoCalib(auto && d === 'calibrate');
    setDialog(d);
    dispatcher.cancel();
    gate.clear();
    if (speakingIds.current.size) { client.stop(); speakingIds.current.clear(); syncSpeaking(); }
  };
  // сервис сбрасывает слушателя на шагах калибровки и записи — «речь кончилась» могло не прийти
  const closeDialog = () => { setDialog(null); setBusy(null); setListening(false); gate.clear(); };

  const toggle = (v: boolean) => { setOpen(v); lsSet(OPEN_KEY, v ? 'open' : null); };

  // связь с сервисом: подключение сразу (шлюз может молчать — сервис запущен вручную), состояние шлюза —
  // раз в 5 с; микрофон — когда сервис ответил (без сервиса микрофон не спрашиваем)
  useEffect(() => {
    const offStatus = client.onStatus(setStatus);
    client.connect(parseSettings(lsGet(SETTINGS_KEY)));
    void client.refreshApi();
    const t = setInterval(() => { void client.refreshApi(); }, API_POLL_MS);
    return () => { offStatus(); clearInterval(t); client.close(); started.current = false; };
  }, [client]);
  const startMic = () => {
    started.current = true;
    setMicError(null);
    client.start(parseSettings(lsGet(SETTINGS_KEY))).catch((e: Error) => { started.current = false; setMicError(micText(e)); });
  };
  useEffect(() => { if (enabled && status === 'ready' && !started.current && !micError) startMic(); }, [status, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Выключить / включить голос. Выключение закрывает окна калибровки и голосов (их шаги и пробы останавливаются),
   * микрофон и звук штаба; `finishSpeech` — ответ штаба на «отбой» договаривается.
   */
  const power = (on: boolean, finishSpeech = false) => {
    if (on === enabledRef.current) return;
    enabledRef.current = on;
    setEnabledState(on);
    lsSet(ENABLED_KEY, on ? 'true' : 'false');
    setMicError(null);
    dispatcher.setStandby(false, { quiet: true }); // выключили или включили кнопкой — дежурства больше нет
    if (!on) {
      dispatcher.cancel(); // ответ модели, пришедший после выключения, не звучит и не исполняется
      gate.clear();
      settleAll();
      setDialog(null);
      setBusy(null);
      setListening(false);
      setLevel({ p: 0, busy: false });
      if (!finishSpeech) { speakingIds.current.clear(); syncSpeaking(); }
      started.current = false;
      void client.setEnabled(false, { finishSpeech });
      return;
    }
    // микрофон откроет startMic (эффект выше), когда сервис готов; был открыт до выключения — открывается сразу,
    // и отказ показывается простыми словами, даже если попытка уже закончилась
    client.setEnabled(true).catch((e: Error) => { started.current = false; setMicError(micText(e)); });
  };

  // сообщения сервиса
  useEffect(() => {
    const offs = [
      client.on('ready', (m) => {
        setReady({ voices: m.voices ?? [], roles: m.roles, recordText: m.record_text ?? '', aec: m.aec === true });
      }),
      client.on('level', (m) => setLevel({ p: m.p, busy: m.busy })),
      client.on('speech', (m) => { setListening(m.state === 'start'); gate.speech(m.state === 'start'); }),
      client.on('settings', (m) => setCfg({
        vad: m.vad, barge_vad: m.barge_vad, barge_ms: m.barge_ms, end_ms: m.end_ms, barge_mode: m.barge_mode === 'word' ? 'word' : 'voice',
      })),
      client.on('utterance', (m) => {
        setListening(false);
        if (!enabledRef.current) { gate.utterance(); return; }  // договорено до выключения — уже не исполняется
        setFeed((f) => feedUtterance(f, m));
        // реплику поправили при разборе (огрехи распознавания) — в ленте видно, как она понята
        dispatcher.utterance(m.text, m.id, m.continues)
          .then((r) => setFeed((f) => feedCorrection(feedResolve(f, m.id, r), m.id, m.text, dispatcher.correction(m.id))))
          .catch(() => setFeed((f) => feedResolve(f, m.id, 'unknown')));
        // синхронная часть разбора уже сняла старые ответы, если это новая просьба (supersede) — ждущие фразы уходят
        gate.utterance();
      }),
      client.on('echo', (m) => { gate.utterance(); setFeed((f) => feedEcho(f, m.text, Date.now())); }),
      // перебили штаб: дальше человек говорит с ним — окно разговора, реплика без «штаб» не уходит в «не мне»
      client.on('barge', (m) => {
        if (previewIds.current.delete(m.id)) return;
        speakingIds.current.delete(m.id);
        syncSpeaking();
        settle(m.id);
        dispatcher.spoke();
        setSpokeAt(Date.now());
      }),
      client.on('say-done', (m) => { if (m.stopped) { previewIds.current.delete(m.id); speakingIds.current.delete(m.id); syncSpeaking(); settle(m.id); } }),
      // открытое окно калибровки или голосов показывает ошибку само — в ленте не дублируем
      client.on('error', (m) => { if (!dialogRef.current) setFeed((f) => feedAdd(f, { key: `e${Date.now()}`, kind: 'note', text: m.text })); }),
      client.onPlayed((id) => {
        if (previewIds.current.delete(id)) return;
        speakingIds.current.delete(id);
        syncSpeaking();
        settle(id);
        if (quietIds.current.delete(id)) return; // заготовленная фраза о модели окно разговора не открывает
        dispatcher.spoke();
        setSpokeAt(Date.now());
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [client, dispatcher]); // eslint-disable-line react-hooks/exhaustive-deps

  // обрыв связи: звук остановлен — штаб больше не говорит
  useEffect(() => { if (status !== 'ready') { speakingIds.current.clear(); syncSpeaking(); setListening(false); gate.clear(); settleAll(); } }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // часы окна разговора и «что можно сказать» (доступность действий меняется без событий); фразы штаба не ждут
  // конца речи вечно; подтверждение ждёт не дольше 15 с
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); gate.tick(); dispatcher.tick(); }, 1000); return () => clearInterval(t); }, [gate, dispatcher]);

  // голос впервые за запуск готов: калибровки не было — штаб предлагает её (тур вступления может отменить и предложить сам)
  useEffect(() => {
    if (readyFirst.current || !enabled || status !== 'ready') return;
    readyFirst.current = true;
    const calibrated = wasCalibrated(lsGet(SETTINGS_KEY));
    const ev = new CustomEvent('voice:ready-first', { detail: { calibrated }, cancelable: true });
    window.dispatchEvent(ev);
    if (ev.defaultPrevented || calibrated) return;
    const t = setTimeout(() => { if (!dialogRef.current && !dispatcher.standby && !dispatcher.pending) dispatcher.propose(OFFER_CALIBRATION, 'shell.calibrate'); }, 1000);
    return () => clearTimeout(t);
  }, [status, enabled, dispatcher]);

  // регуляторы правили руками до ответа сервиса — дописать, при каком подавлении эха (иначе ложная рамка «калибровка»)
  useEffect(() => { const s = settleAec(lsGet(SETTINGS_KEY), ready?.aec); if (s) persist(s); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // голосовые действия «калибровка» и «голоса»; звук — после первого действия человека
  useEffect(() => {
    // открыто голосом («Штаб, калибровка») — и ведётся голосом: шаги калибровки идут сами
    const onOpen = (e: Event) => {
      const raw = (e as CustomEvent).detail as string | { what: string; manual?: boolean };
      // кнопкой (manual) — как прежде: шаги калибровки по кнопке «Записать»; голосом — шаги идут сами
      const d = typeof raw === 'string' ? raw : raw?.what;
      const manual = typeof raw === 'object' && !!raw?.manual;
      if ((d === 'calibrate' || d === 'voices') && enabledRef.current) { openDialog(d, !manual); toggle(true); }
      if (d === 'panel') toggle(true);
    };
    const onPower = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d === 'boolean') power(d, !d);
    };
    // «Штаб, отбой» / «Штаб, на связь» (действия shell.standby / shell.wake)
    const onStandby = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d === 'boolean' && enabledRef.current) dispatcher.setStandby(d);
    };
    // предложение штаба «да / нет» от других модулей; без подробностей — калибровка (тур после вступления)
    const onPropose = (e: Event) => {
      const d = (e as CustomEvent).detail as { text?: string; action?: string; params?: unknown } | null;
      if (!enabledRef.current || dispatcher.standby) return;
      if (d?.text && d.action) dispatcher.propose(d.text, d.action, d.params);
      // без подробностей (тур после вступления) — предложение калибровки, если её не было
      else if (!wasCalibrated(lsGet(SETTINGS_KEY)) && !dialogRef.current && !dispatcher.pending) dispatcher.propose(OFFER_CALIBRATION, 'shell.calibrate');
    };
    const resume = () => client.resume();
    window.addEventListener('voice:open', onOpen);
    window.addEventListener('voice:power', onPower);
    window.addEventListener('voice:standby', onStandby);
    window.addEventListener('voice:propose', onPropose);
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('voice:open', onOpen);
      window.removeEventListener('voice:power', onPower);
      window.removeEventListener('voice:standby', onStandby);
      window.removeEventListener('voice:propose', onPropose);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Регуляторы: в сервис и в сохранённые; calibrated — итог калибровки (запоминает подавление эха сервиса). */
  const applySettings = (p: Partial<VoiceSettings>, calibrated = false) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    persist(storeSettings(lsGet(SETTINGS_KEY), next, { aec: ready?.aec, calibrated }));
    client.settings(p);
  };
  /** «По умолчанию»: регуляторы сервиса, а режим перебивания — тот, что выбрала калибровка. */
  const resetSettings = () => {
    const r = resetStored(lsGet(SETTINGS_KEY));
    persist(r.stored);
    setCfg(r.cfg);
    client.settings(r.cfg);
  };

  // подавление эха в сервисе не то, при котором сняты регуляторы: до новой калибровки перебивание — «словом»
  // (при громких динамиках «голосом» штаб перебивал бы сам себя); сохранённое не меняется
  const aec = live0(enabled, status) ? aecChange(saved, ready?.aec) : null;
  useEffect(() => { if (aec && cfg.barge_mode !== 'word') client.settings({ barge_mode: 'word' }); }, [aec, cfg.barge_mode, client]);

  const st = panelState({
    status, enabled, micError, busy, speaking, listening, thinking, standby,
    conversation: now - spokeAt <= CONVERSATION_S * 1000,
  });
  const live = enabled && status === 'ready' && !micError;
  const hint = live ? bargeHint(speaking, cfg.barge_mode) : null;
  const word = cfg.barge_mode === 'word';
  const errorText = status === 'error' ? client.errorText : null;
  const can = listed(actions(section)).filter((a) => a.hint || a.say?.length);
  const feedEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: 'nearest' }); }, [feed.length]);

  // голоса в этой версии нет (установленная программа, браузер, не Mac на Apple Silicon) — панели нет
  if (status === 'unsupported') return null;

  return (
    <div className={`vp ${st.key}`}>
      {!open ? (
        <button className="vp-icon" data-tour="voice" data-action="voice.panel.open" onClick={() => { void act('voice.panel.open'); }} title={`Голос: ${st.text}`} aria-label={`Голос: ${st.text}. Открыть панель голоса`}>
          <MicGlyph off={!enabled} sleep={enabled && standby} />
          {(!enabled || standby) && <span className="vp-icon-cap">{st.text}</span>}
        </button>
      ) : (
        <section className="vp-card" aria-label="Голос" data-tour="voice">
          <div className="vp-head" data-tour="voice-state">
            <span className="vp-dot" />
            <span className="vp-state" role="status">{st.text}</span>
            <ActButton className="vp-close" action="voice.panel.close" title="Свернуть панель голоса">Свернуть</ActButton>
          </div>
          {pending && live && (
            <div className="vp-confirm" role="alertdialog" aria-label="Подтверждение">
              <p className="vp-q">{pending.text}</p>
              <div className="vp-row">
                <ActButton action="voice.no">Нет</ActButton>
                <ActButton action="voice.yes" className="primary">Да</ActButton>
              </div>
            </div>
          )}
          <button className={`vp-power${enabled ? '' : ' primary'}`} data-tour="voice-power" onClick={() => power(!enabled)}>
            <MicGlyph off={enabled} /> {enabled ? 'Выключить голос' : 'Включить голос'}
          </button>
          {enabled && <p className="vp-note">Выключить — микрофон закроется: включить голосом будет нельзя, только этой кнопкой. Чтобы штаб просто замолчал, скажите: «Штаб, отбой».</p>}
          {!enabled && <p className="vp-note">Микрофон выключен: штаб вас не слышит и не говорит.</p>}
          {enabled && errorText && (
            <div className="vp-mic">
              <p>Причина: {errorText}</p>
              <p>Если перезапуск не помог, покажите это сообщение тому, кто устанавливал программу.</p>
            </div>
          )}
          {enabled && micError && (
            <div className="vp-mic">
              <p>{micError}</p>
              <button onClick={startMic}>Попробовать снова</button>
            </div>
          )}
          {aec && (
            <div className="vp-mic vp-aec" role="status">
              <p>{aecHint(aec)}</p>
              <ActButton action="shell.calibrate" params={{ manual: true }} disabled={!live}>Калибровать</ActButton>
            </div>
          )}
          {enabled && <Level p={live ? level.p : 0} busy={level.busy} cfg={cfg} />}
          {hint && <p className="vp-hint stop" role="status">{hint}</p>}
          {enabled && <p className="vp-hint">Не знаете, что сказать? Скажите: Штаб, что я могу?</p>}

          <div className="vp-feed" aria-label="Что сказано" data-tour="voice-feed">
            {!feed.length && <p className="vp-empty">Здесь будет видно, что я услышал и что ответил.</p>}
            {feed.map((x) => (
              <div key={x.key} className={`vp-item ${x.kind}`}>
                {x.kind !== 'fix' && <span className="vp-who">{x.kind === 'chief' ? 'Штаб:' : x.kind === 'umpire' ? 'Посредник:' : x.kind === 'note' ? 'Сбой:' : x.kind === 'echo' ? 'Слышно:' : 'Вы:'}</span>} {x.text}
                {x.kind === 'notme' && <span className="vp-notme">не мне</span>}
                {x.kind === 'echo' && <span className="vp-notme">похоже на мой же голос из динамиков</span>}
              </div>
            ))}
            <div ref={feedEnd} />
          </div>

          {enabled && <details className="vp-cans" data-tour="voice-cans">
            <summary>Что можно сказать</summary>
            <ul>
              {can.map((a) => {
                const av = a.available();
                return (
                  <li key={a.id} className={av === true ? '' : 'off'}>
                    {(a.hint ? [a.hint] : a.say!).map((s) => <span key={s} className="vp-can">«{s}»</span>)}
                    {av !== true && <span className="vp-why">сейчас нельзя: {av}</span>}
                  </li>
                );
              })}
            </ul>
          </details>}

          <div className="vp-btns" data-tour="voice-btns">
            <ActButton action="shell.calibrate" params={{ manual: true }} disabled={!live}>Калибровка</ActButton>
            <ActButton action="shell.voices" params={{ manual: true }} disabled={!live}>Голоса</ActButton>
          </div>

          <details className="vp-tune" data-tour="voice-tune">
            <summary>Тонкая настройка</summary>
            <p className="vp-note">Обычно хватает калибровки. Правее — чутче.</p>
            {/* режим выбирает калибровка; «словом» — когда динамики слышно громко */}
            <div className="vp-mode" role="group" aria-label="Перебивать">
              <span>Перебивать:</span>
              <button className={word ? '' : 'on'} aria-pressed={!word} disabled={!!aec} title={aec ? 'Сначала пройдите калибровку' : undefined}
                onClick={() => applySettings({ barge_mode: 'voice' })}>голосом</button>
              <button className={word ? 'on' : ''} aria-pressed={word} onClick={() => applySettings({ barge_mode: 'word' })}>словом</button>
            </div>
            <p className="vp-note">{word ? 'Штаб замолкает, когда вы скажете «Стоп» или «Штаб…».' : 'Штаб замолкает, когда вы громко заговорите.'}</p>
            <Slider label="Чувствительность в тишине" value={1 - cfg.vad} min={0.1} max={0.85} step={0.05} show={pct(1 - cfg.vad)}
              onChange={(v) => applySettings({ vad: +(1 - v).toFixed(2) })} />
            <Slider label="Чувствительность, когда говорит штаб" value={1 - cfg.barge_vad} min={0.05} max={0.85} step={0.05} show={pct(1 - cfg.barge_vad)}
              onChange={(v) => applySettings({ barge_vad: +(1 - v).toFixed(2) })} />
            {!word && <Slider label="Перебить штаб, если говорю дольше" value={cfg.barge_ms} min={100} max={1000} step={50} show={`${cfg.barge_ms} мс`}
              onChange={(v) => applySettings({ barge_ms: v })} />}
            <Slider label="Пауза до ответа" value={cfg.end_ms} min={20} max={1500} step={10} show={`${cfg.end_ms} мс`}
              onChange={(v) => applySettings({ end_ms: v })} />
            <button onClick={resetSettings}>По умолчанию</button>
            <label className="vp-check-intro">
              <input type="checkbox" checked={intro} onChange={(e) => { void act(e.target.checked ? 'tour.introOn' : 'tour.introOff'); }} /> Вступление при запуске
            </label>
          </details>
        </section>
      )}

      {dialog === 'calibrate' && (
        <Calibration client={client} setBusy={setBusy} onClose={closeDialog} auto={autoCalib} say={sayAndWait}
          onResult={(c) => applySettings(c, true)} />
      )}
      {dialog === 'voices' && (
        <Voices client={client} ready={ready} setBusy={setBusy} onClose={closeDialog} say={sayAndWait}
          previewId={() => { const id = client.newSayId(); previewIds.current.add(id); return id; }} />
      )}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
/** Голос включён и сервис на связи (подсказка о подавлении эха — только тогда). */
const live0 = (enabled: boolean, status: VoiceStatus) => enabled && status === 'ready';

/** Уровень речи: заливка — насколько уверенно звучит речь; отметки — откуда слышу вас и откуда вы перебиваете штаб. */
function Level({ p, busy, cfg }: { p: number; busy: boolean; cfg: VoiceSettings }) {
  const thr = busy ? cfg.barge_vad : cfg.vad;
  return (
    <div className="vp-levelbox" data-tour="voice-level">
      <div className={`vp-level${p >= thr ? ' over' : ''}`} data-p={p} role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={p} aria-label="Слышу речь">
        <i style={{ width: `${Math.round(p * 100)}%` }} />
        <span className="mk in" style={{ left: `${cfg.vad * 100}%` }} title="Отсюда слышу вас" />
        <span className="mk br" style={{ left: `${cfg.barge_vad * 100}%` }} title="Отсюда вы перебиваете штаб" />
      </div>
      <div className="vp-legend"><span className="in">▍ слышу вас</span> <span className="br">▍ перебиваете штаб</span></div>
    </div>
  );
}

function Slider({ label, value, min, max, step, show, onChange }: {
  label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void;
}) {
  return (
    <label className="vp-slider">
      <span>{label}: <b>{show}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

/** Микрофон; off — перечёркнутый (голос выключен); sleep — дежурит («zz»). */
function MicGlyph({ off = false, sleep = false }: { off?: boolean; sleep?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <g opacity={sleep ? 0.45 : 1}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
      </g>
      {off && <path className="vp-cross" d="M3.5 3.5l17 17" strokeWidth="2.4" />}
      {sleep && <text className="vp-zz" x="15.5" y="7.5" fill="currentColor" stroke="none" fontSize="8" fontWeight="700">zz</text>}
    </svg>
  );
}
