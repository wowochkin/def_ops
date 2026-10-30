/**
 * Меню оператора: вход по ПИН, сводка стенда (службы, статистика дня), действия над сеансом и настройки вкладками
 * «Сеанс», «Экраны», «Звук», «Доступ». Настройки сохраняются сразу при изменении (через `normalizeSettings`).
 * `setup` — то же меню на странице «Начало» полного режима: без сводки, вместо действий — включение выставочного режима.
 */
import { useEffect, useRef, useState } from 'react';
import { normalizeSettings, type ExpoSettings, type FrontId } from './settings';
import type { DirectorEvent } from './director';
import type { ProbeStates } from './health';
import type { ExpoStats } from './stats';
import type { MonitorInfo } from './windows';
import { pinAttempt } from './operator';
import { FRONT_NAMES } from './scenes';
import { MonitorOrder, ServiceSummary, Stepper } from './operator-parts';
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
export function OperatorMenu({ settings, open = true, setup = false, summary, monitors, onSave, onClose, onExit, onAction }: OperatorProps) {
  const [authorized, setAuthorized] = useState(false);
  const [pin, setPin] = useState('');
  const [lock, setLock] = useState({ failures: 0, until: 0 });
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('session');
  const [found, setFound] = useState<MonitorInfo[]>([]);
  const monitorsRef = useRef(monitors);
  monitorsRef.current = monitors;
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
    void list()
      .then((m) => {
        if (live) setFound(m);
      })
      .catch(() => {
        if (live) setFound([]);
      });
    return () => {
      live = false;
    };
  }, [open, authorized, tab]);
  if (!open) return null;

  const save = (patch: Partial<ExpoSettings>) => {
    const s = normalizeSettings({ ...settings, ...patch }).settings;
    void onSave(s).catch((e) => setError(`Не удалось сохранить: ${String(e)}`));
  };
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
      <button onClick={() => onAction('identify')}>Показать номера экранов</button>
      <button onClick={() => onAction('reboot')}>Перезапустить стенд</button>
      <button className="expo-danger" onClick={onExit}>
        Выйти в полный режим
      </button>
    </div>
  );

  const sessionTab = (
    <>
      <label>
        Режим ИИ
        <select value={settings.aiMode} onChange={(e) => save({ aiMode: e.target.value as ExpoSettings['aiMode'] })}>
          <option value="ai">С ИИ</option>
          <option value="noai">Без ИИ</option>
        </select>
      </label>
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
        label="Возврат после итога, с"
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
      <MonitorOrder monitors={found} order={settings.screens.order} onOrder={(order) => save({ screens: { ...settings.screens, order } })} />
    </>
  );

  const soundTab = (
    <>
      {flag('Фоновый звук', settings.volume.ambientOn, (v) => save({ volume: { ...settings.volume, ambientOn: v } }))}
      {volume('Громкость голоса', settings.volume.voice, (v) => save({ volume: { ...settings.volume, voice: v } }))}
      {volume('Громкость фона', settings.volume.ambient, (v) => save({ volume: { ...settings.volume, ambient: v } }))}
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
