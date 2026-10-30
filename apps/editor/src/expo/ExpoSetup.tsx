/** Строка «Выставочный стенд» на странице «Начало»: меню оператора для настройки и включения стенда. */
import { useEffect, useState } from 'react';
import { EXPO_DEFAULTS, settingsStore, type ExpoSettings } from './settings';
import { OperatorMenu } from './OperatorMenu';
import { expoWindows } from './windows';

export function ExpoSetup() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(EXPO_DEFAULTS);
  useEffect(() => {
    const show = () => {
      void settingsStore()
        .load()
        .then((s) => {
          setSettings(s);
          setOpen(true);
        });
    };
    window.addEventListener('expo:setup', show);
    return () => window.removeEventListener('expo:setup', show);
  }, []);
  const save = async (s: ExpoSettings) => {
    await settingsStore().save(s);
    setSettings(s);
  };
  return (
    <>
      <section className="start-llm start-expo">
        <span className="start-card-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="2" y="4" width="8" height="11" rx="1" />
            <rect x="14" y="4" width="8" height="11" rx="1" />
            <path d="M6 19h12M12 15v4" />
          </svg>
        </span>
        <div>
          <b>Выставочный стенд</b>
          <small>
            Сеанс «Примите командование» для посетителей на одном–трёх экранах: заставка, выбор фронта, три перелома, итог.
            Настройка и включение — в меню оператора по ПИН.
          </small>
        </div>
        <button onClick={() => window.dispatchEvent(new Event('expo:setup'))}>Выставочный режим…</button>
      </section>
      <OperatorMenu
        setup
        open={open}
        settings={settings}
        monitors={() => expoWindows().monitors()}
        onSave={save}
        onClose={() => setOpen(false)}
        onAction={() => {}}
        onExit={() => {
          const u = new URL(location.href);
          u.searchParams.set('expo', '0');
          location.assign(u.href);
        }}
      />
    </>
  );
}
