/**
 * Настройки модели: адрес сервера (протокол OpenAI, LM Studio), список моделей с сервера, модель немецкого штаба и
 * модель разговора с агентом, источник решений немецких штабов; для штаба на модели — уровень размышлений, потолок
 * токенов, число одновременных запросов (вручную или замером), решение в один час и один запрос на армию.
 * Пересчёт — в приложении (ядро считает прогон).
 */
import { useState } from 'react';
import type { ProbeResult, Reasoning, Settings, StaffSource } from './data';
import { isTauri, listModels, llmRun, probeParallel } from './data';

interface Props { value: Settings; onChange: (s: Settings) => void; onRun: () => void; busy: boolean; onClose: () => void }

const SOURCES: { id: StaffSource; label: string; hint: string }[] = [
  { id: 'script', label: 'исторические приказы', hint: 'задачи сценария по документам и книгам' },
  { id: 'doctrine', label: 'по доктрине', hint: 'штабы корпусов решают сами по немецкой доктрине обороны 1944–45 гг.' },
  { id: 'llm', label: 'языковая модель', hint: 'штабы корпусов решают на выбранной модели; при сбое — по доктрине' },
];

const REASONING: { id: Reasoning; label: string }[] = [
  { id: 'default', label: 'как задано в модели' },
  { id: 'off', label: 'выключить' },
  { id: 'low', label: 'низкий' },
  { id: 'medium', label: 'средний' },
  { id: 'high', label: 'высокий' },
];
const PARALLEL = [0, 1, 2, 3, 4, 6, 8, 12, 16];

export function SettingsPanel({ value, onChange, onRun, busy, onClose }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
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
  async function measure() {
    setProbing('замер: короткие ответы на 1, 2, 4, 8… одновременных запросах…');
    try {
      const p = await probeParallel(llmRun(value));
      setProbe(p);
      setProbing(null);
    } catch (e) {
      setProbing(`замер не удался: ${(e as Error).message}`);
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
      <label className="row">Размышления в разговоре
        <select value={value.chatReasoning} onChange={(e) => set({ chatReasoning: e.target.value as Reasoning })}>{REASONING.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        <span className="hint">размышления видны по мере прихода</span>
      </label>
      <div className="row col">
        <span>Советские штабы</span>
        <label className="radio"><input type="radio" checked={value.su !== 'doctrine'} onChange={() => set({ su: 'script' })} /> исторические приказы <span className="hint">— задачи и сроки по документам</span></label>
        <label className="radio"><input type="radio" checked={value.su === 'doctrine'} onChange={() => set({ su: 'doctrine' })} /> по доктрине <span className="hint">— задачи по документам, а эшелоны и ввод танковых армий решает штаб по советской доктрине 1944–45 гг.</span></label>
      </div>
      <div className="row col">
        <span>Немецкие штабы</span>
        {SOURCES.map((s) => (
          <label key={s.id} className="radio"><input type="radio" checked={value.de === s.id} onChange={() => set({ de: s.id })} /> {s.label} <span className="hint">— {s.hint}</span></label>
        ))}
      </div>
      <div className="row col">
        <span>Штаб на языковой модели</span>
        <label className="row">Уровень размышлений
          <select value={value.reasoning} onChange={(e) => set({ reasoning: e.target.value as Reasoning })}>{REASONING.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <label className="row">Потолок токенов ответа
          <input type="number" min={0} step={256} value={value.maxTokens} onChange={(e) => set({ maxTokens: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 90 }} />
          <span className="hint">{value.maxTokens === 0 ? '0 — без ограничения' : value.reasoning !== 'off' && value.maxTokens < 2048 ? 'с размышлениями ответ может не уместиться — тогда штаб решит по доктрине, в журнале будет причина' : 'размышления входят в потолок'}</span>
        </label>
        <label className="row">Одновременных запросов
          <select value={value.parallel} onChange={(e) => set({ parallel: Number(e.target.value) })}>{PARALLEL.map((n) => <option key={n} value={n}>{n === 0 ? 'авто (замер)' : n}</option>)}</select>
          <button onClick={() => void measure()} disabled={!value.staffModel || !!probing && probing.startsWith('замер:')}>Замерить</button>
          {probe && <button onClick={() => set({ parallel: probe.best })} title="Поставить найденное число вручную">взять {probe.best}</button>}
        </label>
        {probing && <span className="hint">{probing}</span>}
        {probe && <table className="probe"><thead><tr><th>одновременно</th><th>токенов/с всего</th><th>ступень, с</th></tr></thead><tbody>{probe.rows.map((r) => <tr key={r.parallel} className={r.parallel === probe.best ? 'on' : ''}><td>{r.parallel}</td><td>{r.tokensPerSec}</td><td>{r.secs}</td></tr>)}</tbody></table>}
        <span className="hint">«авто» — замер перед расчётом: берётся число запросов, после которого суммарная скорость растёт меньше чем на 20 %</span>
        <label className="radio"><input type="checkbox" checked={value.sync} onChange={(e) => set({ sync: e.target.checked })} /> штабы решают в один час <span className="hint">— запросы одного часа уходят одновременно; иначе вразнобой по часам, как по доктрине</span></label>
        <label className="radio"><input type="checkbox" checked={value.byArmy} onChange={(e) => set({ byArmy: e.target.checked })} /> один запрос на армию <span className="hint">— штаб армии решает за свои корпуса: запросов меньше, но корпус уже не отдельный агент</span></label>
      </div>
      <div className="row">
        <button className="primary" onClick={onRun} disabled={busy || !isTauri() || (value.de === 'llm' && !value.staffModel)}>{busy ? 'Расчёт…' : 'Пересчитать'}</button>
        {!isTauri() && <span className="hint">пересчёт — в приложении (npm run agents:app); в браузере показан готовый прогон</span>}
        {isTauri() && value.de === 'llm' && !value.staffModel && <span className="hint">выберите модель штаба</span>}
      </div>
    </div>
  );
}
