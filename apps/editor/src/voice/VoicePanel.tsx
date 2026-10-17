/**
 * Панель голоса поверх любого раздела: свёрнута — значок (цвет — состояние), развёрнута — состояние словами,
 * уровень речи с отметками, лента реплик, «Что можно сказать», калибровка, голоса и тонкая настройка.
 *
 * Пользователи — люди старшего возраста: крупный шрифт (не меньше 18 px), простые слова, регуляторы спрятаны
 * в «Тонкую настройку», главный путь — калибровка. Панель создаёт связь с сервисом (VoiceClient) и разборщик
 * реплик (Dispatcher); событие окна `voice:open` (detail 'calibrate' | 'voices') открывает нужный экран.
 *
 * Кнопка «Выключить голос» / «Включить голос» и событие окна `voice:power` (detail: boolean; «Штаб, отбой»)
 * выключают голос: микрофон закрыт и сам не открывается, звук штаба остановлен, связь с сервисом остаётся.
 * Выбор запоминается между запусками (ENABLED_KEY).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceClient } from './client';
import { CONVERSATION_S, Dispatcher } from './dispatch';
import { actions } from './registry';
import type { VoiceInfo, VoiceRoles, VoiceSettings, VoiceStatus } from './protocol';
import {
  DEFAULT_SETTINGS, ENABLED_KEY, SETTINGS_KEY, bargeHint, feedAdd, feedCorrection, feedEcho, feedResolve, feedUtterance, panelState, parseEnabled, parseSettings,
  type FeedItem,
} from './panel-state';
import { Calibration } from './Calibration';
import { Voices } from './Voices';

const OPEN_KEY = 'def_ops.voice.panel';
const API_POLL_MS = 5000;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
/** Отказ микрофона простыми словами: разобранные причины — как есть, прочие — с пояснением, что случилось. */
const micText = (e: Error) => (/^(Микрофон|Браузер)/.test(e.message) ? e.message : `Микрофон не подключился: ${e.message}`);
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } };

/** Что сервис сообщил при подключении: голоса, роли, текст для записи нового голоса. */
export interface VoiceReady { voices: VoiceInfo[]; roles: VoiceRoles; recordText: string }

export function VoicePanel({ section }: { section: string }) {
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

  const [status, setStatus] = useState<VoiceStatus>(client.status);
  const [open, setOpen] = useState(() => lsGet(OPEN_KEY) === 'open');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [level, setLevel] = useState({ p: 0, busy: false });
  const [cfg, setCfg] = useState<VoiceSettings>(() => ({ ...DEFAULT_SETTINGS, ...parseSettings(lsGet(SETTINGS_KEY)) }));
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(0);
  const speakingIds = useRef(new Set<number>());
  const previewIds = useRef(new Set<number>());
  const [speaking, setSpeaking] = useState(false);
  const [spokeAt, setSpokeAt] = useState(-Infinity);
  const [now, setNow] = useState(() => Date.now());
  const [micError, setMicError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'calibrate' | 'voices'>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState<VoiceReady | null>(null);
  const started = useRef(false);

  const syncSpeaking = () => setSpeaking(speakingIds.current.size > 0);
  const dispatcher = useMemo(() => new Dispatcher({
    now: () => Date.now(),
    section: () => sectionRef.current,
    say: (text) => {
      const id = client.newSayId();
      speakingIds.current.add(id);
      syncSpeaking();
      client.say(id, 'chief', text);
      setFeed((f) => feedAdd(f, { key: `s${id}`, kind: 'chief', text }));
    },
    stop: () => { client.stop(); speakingIds.current.clear(); syncSpeaking(); },
  }), [client]);

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
    if (!on) {
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
      client.on('ready', (m) => setReady({ voices: m.voices ?? [], roles: m.roles, recordText: m.record_text ?? '' })),
      client.on('level', (m) => setLevel({ p: m.p, busy: m.busy })),
      client.on('speech', (m) => setListening(m.state === 'start')),
      client.on('settings', (m) => setCfg({
        vad: m.vad, barge_vad: m.barge_vad, barge_ms: m.barge_ms, end_ms: m.end_ms, barge_mode: m.barge_mode === 'word' ? 'word' : 'voice',
      })),
      client.on('utterance', (m) => {
        setListening(false);
        if (!enabledRef.current) return;  // договорено до выключения — уже не исполняется
        setFeed((f) => feedUtterance(f, m));
        setThinking((n) => n + 1);
        // реплику поправили при разборе (огрехи распознавания) — в ленте видно, как она понята
        dispatcher.utterance(m.text, m.id, m.continues)
          .then((r) => setFeed((f) => feedCorrection(feedResolve(f, m.id, r), m.id, m.text, dispatcher.correction(m.id))))
          .catch(() => setFeed((f) => feedResolve(f, m.id, 'unknown')))
          .finally(() => setThinking((n) => n - 1));
      }),
      client.on('echo', (m) => setFeed((f) => feedEcho(f, m.text, Date.now()))),
      // перебили штаб: дальше человек говорит с ним — окно разговора, реплика без «штаб» не уходит в «не мне»
      client.on('barge', (m) => {
        if (previewIds.current.delete(m.id)) return;
        speakingIds.current.delete(m.id);
        syncSpeaking();
        dispatcher.spoke();
        setSpokeAt(Date.now());
      }),
      client.on('say-done', (m) => { if (m.stopped) { previewIds.current.delete(m.id); speakingIds.current.delete(m.id); syncSpeaking(); } }),
      // открытое окно калибровки или голосов показывает ошибку само — в ленте не дублируем
      client.on('error', (m) => { if (!dialogRef.current) setFeed((f) => feedAdd(f, { key: `e${Date.now()}`, kind: 'note', text: m.text })); }),
      client.onPlayed((id) => {
        if (previewIds.current.delete(id)) return;
        speakingIds.current.delete(id);
        syncSpeaking();
        dispatcher.spoke();
        setSpokeAt(Date.now());
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [client, dispatcher]); // eslint-disable-line react-hooks/exhaustive-deps

  // обрыв связи: звук остановлен — штаб больше не говорит
  useEffect(() => { if (status !== 'ready') { speakingIds.current.clear(); syncSpeaking(); setListening(false); } }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // часы окна разговора и «что можно сказать» (доступность действий меняется без событий)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // голосовые действия «калибровка» и «голоса»; звук — после первого действия человека
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if ((d === 'calibrate' || d === 'voices') && enabledRef.current) { setDialog(d); toggle(true); }
    };
    // «Штаб, отбой» (разборщик) — выключение; ответ штаба договаривается
    const onPower = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d === 'boolean') power(d, !d);
    };
    const resume = () => client.resume();
    window.addEventListener('voice:open', onOpen);
    window.addEventListener('voice:power', onPower);
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('voice:open', onOpen);
      window.removeEventListener('voice:power', onPower);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySettings = (p: Partial<VoiceSettings>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    lsSet(SETTINGS_KEY, JSON.stringify(next));
    client.settings(p);
  };
  const resetSettings = () => {
    lsSet(SETTINGS_KEY, null);
    setCfg(DEFAULT_SETTINGS);
    client.settings(DEFAULT_SETTINGS);
  };

  const st = panelState({
    status, enabled, micError, busy, speaking, listening, thinking: thinking > 0,
    conversation: now - spokeAt <= CONVERSATION_S * 1000,
  });
  const live = enabled && status === 'ready' && !micError;
  const hint = live ? bargeHint(speaking, cfg.barge_mode) : null;
  const word = cfg.barge_mode === 'word';
  const errorText = status === 'error' ? client.errorText : null;
  const can = actions(section).filter((a) => a.say?.length);
  const feedEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: 'nearest' }); }, [feed.length]);

  // голоса в этой версии нет (установленная программа, браузер, не Mac на Apple Silicon) — панели нет
  if (status === 'unsupported') return null;

  return (
    <div className={`vp ${st.key}`}>
      {!open ? (
        <button className="vp-icon" onClick={() => toggle(true)} title={`Голос: ${st.text}`} aria-label={`Голос: ${st.text}. Открыть панель голоса`}>
          <MicGlyph off={!enabled} />
          {!enabled && <span className="vp-icon-cap">{st.text}</span>}
        </button>
      ) : (
        <section className="vp-card" aria-label="Голос">
          <div className="vp-head">
            <span className="vp-dot" />
            <span className="vp-state" role="status">{st.text}</span>
            <button className="vp-close" onClick={() => toggle(false)} title="Свернуть панель голоса">Свернуть</button>
          </div>
          <button className={`vp-power${enabled ? '' : ' primary'}`} onClick={() => power(!enabled)}>
            <MicGlyph off={enabled} /> {enabled ? 'Выключить голос' : 'Включить голос'}
          </button>
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
          {enabled && <Level p={live ? level.p : 0} busy={level.busy} cfg={cfg} />}
          {hint && <p className="vp-hint stop" role="status">{hint}</p>}
          {enabled && <p className="vp-hint">Не знаете, что сказать? Скажите: Штаб, что я могу?</p>}

          <div className="vp-feed" aria-label="Что сказано">
            {!feed.length && <p className="vp-empty">Здесь будет видно, что я услышал и что ответил.</p>}
            {feed.map((x) => (
              <div key={x.key} className={`vp-item ${x.kind}`}>
                {x.kind !== 'fix' && <span className="vp-who">{x.kind === 'chief' ? 'Штаб:' : x.kind === 'note' ? 'Сбой:' : x.kind === 'echo' ? 'Слышно:' : 'Вы:'}</span>} {x.text}
                {x.kind === 'notme' && <span className="vp-notme">не мне</span>}
                {x.kind === 'echo' && <span className="vp-notme">похоже на мой же голос из динамиков</span>}
              </div>
            ))}
            <div ref={feedEnd} />
          </div>

          {enabled && <details className="vp-cans">
            <summary>Что можно сказать</summary>
            <ul>
              {can.map((a) => {
                const av = a.available();
                return (
                  <li key={a.id} className={av === true ? '' : 'off'}>
                    {a.say!.map((s) => <span key={s} className="vp-can">«{s}»</span>)}
                    {av !== true && <span className="vp-why">сейчас нельзя: {av}</span>}
                  </li>
                );
              })}
            </ul>
          </details>}

          <div className="vp-btns">
            <button onClick={() => setDialog('calibrate')} disabled={!live}>Калибровка</button>
            <button onClick={() => setDialog('voices')} disabled={!live}>Голоса</button>
          </div>

          <details className="vp-tune">
            <summary>Тонкая настройка</summary>
            <p className="vp-note">Обычно хватает калибровки. Правее — чутче.</p>
            {/* режим выбирает калибровка; «словом» — когда динамики слышно громко */}
            <div className="vp-mode" role="group" aria-label="Перебивать">
              <span>Перебивать:</span>
              <button className={word ? '' : 'on'} aria-pressed={!word} onClick={() => applySettings({ barge_mode: 'voice' })}>голосом</button>
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
          </details>
        </section>
      )}

      {dialog === 'calibrate' && (
        <Calibration client={client} setBusy={setBusy} onClose={() => { setDialog(null); setBusy(null); }}
          onResult={(c) => applySettings(c)} />
      )}
      {dialog === 'voices' && (
        <Voices client={client} ready={ready} setBusy={setBusy} onClose={() => { setDialog(null); setBusy(null); }}
          previewId={() => { const id = client.newSayId(); previewIds.current.add(id); return id; }} />
      )}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Уровень речи: заливка — насколько уверенно звучит речь; отметки — откуда слышу вас и откуда вы перебиваете штаб. */
function Level({ p, busy, cfg }: { p: number; busy: boolean; cfg: VoiceSettings }) {
  const thr = busy ? cfg.barge_vad : cfg.vad;
  return (
    <div className="vp-levelbox">
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

/** Микрофон; off — перечёркнутый (голос выключен). */
function MicGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
      {off && <path className="vp-cross" d="M3.5 3.5l17 17" strokeWidth="2.4" />}
    </svg>
  );
}
