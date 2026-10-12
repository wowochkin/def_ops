/**
 * Настройки модели: адрес сервера (протокол OpenAI, LM Studio), список моделей с сервера, модель немецкого штаба и
 * модель разговора с агентом, источник решений немецких штабов. Пересчёт — в приложении (ядро считает прогон).
 */
import { useState } from 'react';
import type { Settings, StaffSource } from './data';
import { isTauri, listModels } from './data';

interface Props { value: Settings; onChange: (s: Settings) => void; onRun: () => void; busy: boolean; onClose: () => void }

const SOURCES: { id: StaffSource; label: string; hint: string }[] = [
  { id: 'script', label: 'исторические приказы', hint: 'задачи сценария по документам и книгам' },
  { id: 'doctrine', label: 'по доктрине', hint: 'штабы корпусов решают сами по немецкой доктрине обороны 1944–45 гг.' },
  { id: 'llm', label: 'языковая модель', hint: 'штабы корпусов решают на выбранной модели; при сбое — по доктрине' },
];

export function SettingsPanel({ value, onChange, onRun, busy, onClose }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (p: Partial<Settings>) => onChange({ ...value, ...p });

  async function refresh() {
    setMsg('запрос списка моделей…');
    try {
      const m = await listModels(value.llmUrl);
      setModels(m);
      setMsg(m.length ? `моделей на сервере: ${m.length}` : 'сервер не вернул ни одной модели — загрузите модель в LM Studio');
      const pick = (cur: string) => (cur && m.includes(cur) ? cur : m[0] ?? '');
      onChange({ ...value, staffModel: pick(value.staffModel), chatModel: pick(value.chatModel) });
    } catch (e) {
      setMsg(`сервер модели недоступен: ${(e as Error).message}`);
    }
  }
  const options = (cur: string) => {
    const list = models.includes(cur) || !cur ? models : [cur, ...models];
    return list.map((m) => <option key={m} value={m}>{m}</option>);
  };

  return (
    <div className="settings">
      <div className="row head"><b>Модель и штабы</b><span className="spacer" /><button onClick={onClose} title="Закрыть">×</button></div>
      <label className="row">Сервер модели <input value={value.llmUrl} onChange={(e) => set({ llmUrl: e.target.value })} /></label>
      <div className="row"><button onClick={() => void refresh()}>Обновить список моделей</button>{msg && <span className="hint">{msg}</span>}</div>
      <label className="row">Модель немецкого штаба
        <select value={value.staffModel} onChange={(e) => set({ staffModel: e.target.value })}><option value="">—</option>{options(value.staffModel)}</select>
      </label>
      <label className="row">Модель разговора с агентом
        <select value={value.chatModel} onChange={(e) => set({ chatModel: e.target.value })}><option value="">—</option>{options(value.chatModel)}</select>
      </label>
      <div className="row col">
        <span>Немецкие штабы</span>
        {SOURCES.map((s) => (
          <label key={s.id} className="radio"><input type="radio" checked={value.de === s.id} onChange={() => set({ de: s.id })} /> {s.label} <span className="hint">— {s.hint}</span></label>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={onRun} disabled={busy || !isTauri() || (value.de === 'llm' && !value.staffModel)}>{busy ? 'Расчёт…' : 'Пересчитать'}</button>
        {!isTauri() && <span className="hint">пересчёт — в приложении (npm run agents:app); в браузере показан готовый прогон</span>}
        {isTauri() && value.de === 'llm' && !value.staffModel && <span className="hint">выберите модель штаба</span>}
      </div>
    </div>
  );
}
