/**
 * Меню оператора: вход по ПИН, сводка стенда (службы, статистика дня), действия над сеансом и настройки вкладками
 * «Сеанс», «Экраны», «Звук», «Доступ». Настройки сохраняются сразу при изменении (через `normalizeSettings`).
 * `setup` — то же меню на странице «Начало» полного режима: без сводки, вместо действий — включение выставочного режима.
 */
import { openPortableSetup } from '../portable/setup-state';
import { LENSES, LENSES_2, setLens } from './lens';
import { useEffect, useRef, useState } from 'react';
import { normalizeSettings, type ExpoSettings, type FrontId } from './settings';
import type { DirectorEvent } from './director';
import type { ProbeStates } from './health';
import type { ExpoStats } from './stats';
import type { MonitorInfo } from './windows';
import { pinAttempt } from './operator';
import { FRONT_NAMES } from './scenes';
import { MonitorOrder, ServiceSummary, Stepper } from './operator-parts';
import type { VoiceClient } from '../voice/client';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY, storeSettings } from '../voice/panel-state';
import './expo.css';

export interface OperatorSummary {
  phase: string;
  health: ProbeStates;
  note: string | null;
  stats: ExpoStats;
  screens: { open: number; want: number };
}

export interface OperatorProps {
  settings: ExpoSettings;
  open?: boolean;
  setup?: boolean;
  summary?: OperatorSummary;
  monitors?: () => Promise<MonitorInfo[]>;
  onSave: (s: ExpoSettings) => Promise<void>;
  onClose: () => void;
  onExit: () => void;
  onAction: (ev: DirectorEvent | 'reboot' | 'identify') => void;
  /** Голосовой сервис первого экрана: выбор микрофона. Нет — пункт не показывается. */
  mic?: VoiceClient | null;
}

type Tab = 'session' | 'screens' | 'sound' | 'access';
const TABS: [Tab, string][] = [
  ['session', 'Сеанс'],
  ['screens', 'Экраны'],
  ['sound', 'Звук'],
  ['access', 'Доступ'],
];
type JumpPhase = Extract<DirectorEvent, { t: 'jump' }>['phase'];

/** Компонент остаётся смонтированным при закрытии: счётчик неверных ПИН не сбрасывается. */
export function OperatorMenu({ settings, open = true, setup = false, summary, monitors, onSave, onClose, onExit, onAction, mic = null }: OperatorProps) {
  const [authorized, setAuthorized] = useState(false);
  const [pin, setPin] = useState('');
  const [lock, setLock] = useState({ failures: 0, until: 0 });
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('session');
  const [found, setFound] = useState<MonitorInfo[]>([]);
  const [monitorRefresh, setMonitorRefresh] = useState(0);
  const monitorsRef = useRef(monitors);
  monitorsRef.current = monitors;
  const pendingSaves = useRef(0);
  const latestSettings = useRef(settings);
  if (!pendingSaves.current) latestSettings.current = settings;
  useEffect(() => {
    if (open) return;
    setAuthorized(false);
    setPin('');
    setError('');
    setTab('session');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open]);
  useEffect(() => {
    const list = monitorsRef.current;
    if (!open || !authorized || tab !== 'screens' || !list) return;
    let live = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void list()
      .then((m) => {
        if (live) setFound(m);
      })
      .catch(() => {
        if (live) setFound([]);
      }).finally(() => { pending = false; });
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, authorized, tab, monitorRefresh]);
  if (!open) return null;

  // Запись expo.json асинхронна: соседние переключатели объединяются до подтверждения родителя.
  const save = (patch: Partial<ExpoSettings>) => {
    const s = normalizeSettings({ ...latestSettings.current, ...patch }).settings;
    latestSettings.current = s;
    pendingSaves.current++;
    void onSave(s).catch((e) => setError(`Не удалось сохранить: ${String(e)}`)).finally(() => { pendingSaves.current--; });
  };
  const saveGeneration = (patch: Partial<ExpoSettings['generation']>) => save({ generation: { ...latestSettings.current.generation, ...patch } });
  const flag = (label: string, value: boolean, change: (v: boolean) => void) => (
    <label className="expo-check">
      <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} />
      {label}
    </label>
  );
  const volume = (label: string, value: number, change: (v: number) => void) => (
    <label>
      {label}
      <input type="range" min="0" max="1" step="0.05" value={value} onChange={(e) => change(Number(e.target.value))} />
    </label>
  );
  const locked = now < lock.until;

  const pinForm = (
    <form
      className="expo-pin"
      onSubmit={(e) => {
        e.preventDefault();
        const result = pinAttempt(lock, pin, settings, Date.now());
        setLock(result.lock);
        setAuthorized(result.ok);
        setPin('');
        setError(result.ok ? '' : 'Неверный ПИН');
      }}
    >
      <label>
        ПИН
        <input
          autoFocus
          aria-label="ПИН"
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          disabled={locked}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      <button className="expo-primary" disabled={locked} type="submit">
        Открыть меню
      </button>
      {locked && <p>Повторите через {Math.ceil((lock.until - now) / 1000)} с</p>}
    </form>
  );

  const actions = setup ? (
    <div className="expo-operator-actions">
      <button className="expo-primary" onClick={onExit}>
        Включить выставочный режим
      </button>
    </div>
  ) : (
    <div className="expo-operator-actions">
      <button className="expo-primary" onClick={() => onAction({ t: 'restart' })}>
        Начать заново
      </button>
      <label>
        Перейти к фазе
        <select
          value=""
          onChange={(e) => {
            const [phase, n] = e.target.value.split(':');
            onAction({ t: 'jump', phase: phase as JumpPhase, ...(n ? { n: Number(n) as 1 | 2 | 3 } : {}) });
          }}
        >
          <option value="">Выберите фазу…</option>
          <option value="attract">Заставка</option>
          <option value="welcome">Выбор фронта</option>
          <option value="briefing">Ввод в обстановку</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={`turn:${n}`}>
              Перелом {n}
            </option>
          ))}
          <option value="result">Итог</option>
        </select>
      </label>
      {tab !== 'screens' && <button onClick={() => onAction('identify')}>Показать номера экранов</button>}
      <button onClick={() => onAction('reboot')}>Перезапустить стенд</button>
      <button className="expo-danger" onClick={onExit}>
        Выйти в полный режим
      </button>
    </div>
  );

  const sessionTab = (
    <>
      <button onClick={openPortableSetup}>Модели, словарь и перенос библиотеки</button>
      <label>
        Режим ИИ
        <select value={settings.aiMode} onChange={(e) => save({ aiMode: e.target.value as ExpoSettings['aiMode'] })}>
          <option value="ai">С ИИ</option>
          <option value="noai">Без ИИ</option>
        </select>
      </label>
      <fieldset>
        <legend>Генерация и озвучка</legend>
        {flag('Комментарии после решений', settings.generation.comments, (v) => saveGeneration({ comments: v }))}
        {flag('Итоговый разбор', settings.generation.debrief, (v) => saveGeneration({ debrief: v }))}
        {flag('Озвучивать комментарии', settings.generation.commentVoice, (v) => saveGeneration({ commentVoice: v }))}
        {flag('Догенерировать озвучку итога', settings.generation.debriefVoice, (v) => saveGeneration({ debriefVoice: v }))}
        <label>
          Температура голоса
          <input type="number" min="0" max="1" step="0.1" value={settings.generation.temperature}
            onChange={(e) => { const temperature = e.target.valueAsNumber; if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 1) saveGeneration({ temperature }); }} />
        </label>
        <label>
          Размер пакета
          <select aria-label="Размер пакета" value={settings.generation.batchSize} onChange={(e) => saveGeneration({ batchSize: Number(e.target.value) as 1 | 2 | 4 })}>
            <option value="1">1</option><option value="2">2</option><option value="4">4</option>
          </select>
        </label>
        <label>
          Потоки CPU для TTS
          <select aria-label="Потоки CPU для TTS" value={settings.generation.cpuThreads} onChange={(e) => saveGeneration({ cpuThreads: Number(e.target.value) as 1 | 2 | 4 | 8 })}>
            <option value="1">1 — один поток</option><option value="2">2</option><option value="4">4</option><option value="8">8</option>
          </select>
        </label>
        <p>Готовые записи итогов звучат при любом положении переключателя. Если догенерация выключена, остальные фразы видны текстом. Настройки действуют со следующего этапа. Потоки CPU — для PyTorch в Windows.</p>
      </fieldset>
      <label>
        Ввод
        <select value={settings.input} onChange={(e) => save({ input: e.target.value as ExpoSettings['input'] })}>
          <option value="touch">Касание</option>
          <option value="mouse">Мышь</option>
          <option value="mouse-keyboard">Мышь и клавиатура</option>
        </select>
      </label>
      {flag('Голосовой ввод', settings.voiceInput, (v) => save({ voiceInput: v }))}
      <fieldset>
        <legend>Фронты</legend>
        {(Object.entries(FRONT_NAMES) as [FrontId, string][]).map(([id, name]) => (
          <span key={id}>
            {flag(name, settings.fronts.includes(id), (v) => {
              const fronts = v ? [...settings.fronts, id] : settings.fronts.filter((f) => f !== id);
              if (fronts.length) save({ fronts });
            })}
          </span>
        ))}
      </fieldset>
      <fieldset>
        <legend>Таймер выбора</legend>
        {flag('Включён', settings.timer.on, (v) => save({ timer: { ...settings.timer, on: v } }))}
        <Stepper
          label="Время выбора, с"
          value={settings.timer.seconds}
          min={10}
          max={120}
          step={5}
          onValue={(v) => save({ timer: { ...settings.timer, seconds: v } })}
        />
      </fieldset>
      <Stepper label="Бездействие, с" value={settings.idleSeconds} min={30} max={600} step={10} onValue={(v) => save({ idleSeconds: v })} />
      <Stepper
        label="Предупреждение перед заставкой, с"
        value={settings.resultSeconds}
        min={5}
        max={120}
        step={5}
        onValue={(v) => save({ resultSeconds: v })}
      />
    </>
  );

  const screensTab = (
    <>
      <Stepper
        label="Число экранов"
        value={settings.screens.count}
        min={1}
        max={3}
        step={1}
        onValue={(v) => save({ screens: { ...settings.screens, count: v as 1 | 2 | 3 } })}
      />
      <p className="expo-muted">Запрошено {settings.screens.count}, доступно {found.length}. {found.length < settings.screens.count ? 'Стенд использует доступные экраны.' : 'Экраны назначаются в порядке ниже.'}</p>
      <p className="expo-muted expo-monitor-note">В настройках компьютера выберите расширенный рабочий стол. HDMI-сплиттер дублирует один экран и не создаёт три независимых.</p>
      <div className="expo-monitor-actions">
        {!setup && <button onClick={() => onAction('identify')}>Показать номера экранов</button>}
        <button onClick={() => setMonitorRefresh(n => n + 1)}>Обновить подключения</button>
      </div>
      <MonitorOrder monitors={found} order={settings.screens.order} count={settings.screens.count} onOrder={(order) => save({ screens: { ...settings.screens, order } })} />
      <fieldset>
        <legend>Показ на одном мониторе (содержимое экрана раскладки во весь монитор)</legend>
        <p className="expo-muted">Переключатель «Все вместе / 1 / 2 / 3» меняет просмотр в одном окне. Назначение физических мониторов он не меняет.</p>
        {[...LENSES, ...LENSES_2.slice(1)].map((x) => (
          <button key={`${x.lens?.count}-${x.label}`} onClick={() => setLens(x.lens)}>
            {x.lens ? `${x.lens.count === 3 ? 'Раскладка на три' : 'Раскладка на два'}: ${x.label}` : x.label}
          </button>
        ))}
      </fieldset>
    </>
  );

  const soundTab = (
    <>
      {flag('Фоновый звук', settings.volume.ambientOn, (v) => save({ volume: { ...settings.volume, ambientOn: v } }))}
      {volume('Громкость голоса', settings.volume.voice, (v) => save({ volume: { ...settings.volume, voice: v } }))}
      {volume('Громкость фона', settings.volume.ambient, (v) => save({ volume: { ...settings.volume, ambient: v } }))}
      {flag('Голос на заставке по умолчанию', settings.attractCall.on, (v) => save({ attractCall: { ...settings.attractCall, on: v } }))}
      {flag('Интро сеанса', settings.intro, (v) => save({ intro: v }))}
      <p className="expo-note">После заставки, не вместо неё.<br />Изменение действует со следующего сеанса.</p>
      {mic && <MicField client={mic} />}
      <label>
        Пауза между фразами, с
        <input
          type="number"
          min="4"
          max="30"
          disabled={!settings.attractCall.on}
          value={settings.attractCall.pause}
          onChange={(e) => save({ attractCall: { ...settings.attractCall, pause: Math.min(30, Math.max(4, Math.round(Number(e.target.value) || 4))) } })}
        />
      </label>
    </>
  );

  const accessTab = (
    <>
      <label>
        Новый ПИН (4–8 цифр)
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          onBlur={(e) => {
            if (/^\d{4,8}$/.test(e.target.value)) {
              save({ pin: e.target.value });
              e.target.value = '';
            } else if (e.target.value) setError('ПИН должен содержать от 4 до 8 цифр');
          }}
        />
      </label>
      {flag('Запускать сразу в выставочном режиме', settings.autostart, (v) => save({ autostart: v }))}
    </>
  );

  return (
    <div className="expo-modal" role="dialog" aria-modal="true" aria-label="Меню оператора">
      <div className="expo-operator">
        <header>
          <h2>Меню оператора</h2>
          <button onClick={onClose}>Закрыть</button>
        </header>
        {!authorized ? (
          pinForm
        ) : (
          <>
            {summary && <p className="expo-phase">{summary.phase}</p>}
            {summary && <ServiceSummary health={summary.health} note={summary.note} stats={summary.stats} screens={summary.screens} />}
            {actions}
            <div role="tablist" className="expo-tabs">
              {TABS.map(([id, name]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {name}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="expo-settings">
              {tab === 'session' && sessionTab}
              {tab === 'screens' && screensTab}
              {tab === 'sound' && soundTab}
              {tab === 'access' && accessTab}
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}

/** Микрофон голосового сервиса: «как в системе» или найденное устройство. Выбор запоминается и берётся при «Говорить». */
function MicField({ client }: { client: VoiceClient }) {
  const [inputs, setInputs] = useState<{ id: string; label: string }[]>([]);
  const [mic, setMic] = useState('');
  useEffect(() => {
    let live = true;
    const take = (d: { inputs: { id: string; label: string }[]; mic: string }) => {
      if (!live) return;
      setInputs(d.inputs);
      setMic(d.mic);
    };
    // без разрешения имена устройств скрыты: короткий запрос микрофона их открывает и сразу отпускает
    void navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((s) => { s.getTracks().forEach((t) => t.stop()); return client.devices(); })
      .then((d) => take(d))
      .catch(() => { void client.devices().then((d) => take(d)); });
    const off = client.onDevices((d) => take(d));
    return () => { live = false; off(); };
  }, [client]);
  const saved = { ...DEFAULT_SETTINGS, ...parseSettings(localStorage.getItem(SETTINGS_KEY)) };
  const [sense, setSense] = useState(+(1 - saved.vad).toFixed(2));
  const setSensitivity = (v: number) => {
    const vad = +(1 - v).toFixed(2);
    setSense(v);
    const next = { ...DEFAULT_SETTINGS, ...parseSettings(localStorage.getItem(SETTINGS_KEY)), vad };
    try { localStorage.setItem(SETTINGS_KEY, storeSettings(localStorage.getItem(SETTINGS_KEY), next, {})); } catch { /* настройки звука необязательны */ }
    client.settings({ vad });
  };
  return (
    <>
      <label>
        Устройство ввода
        <select value={mic} onChange={(e) => { void client.setMic(e.target.value); }}>
          <option value="">Как в системе</option>
          {inputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <label>
        Чувствительность {Math.round(sense * 100)} %
        <input type="range" min="0.1" max="0.85" step="0.05" value={sense} onChange={(e) => setSensitivity(Number(e.target.value))} />
      </label>
    </>
  );
}
