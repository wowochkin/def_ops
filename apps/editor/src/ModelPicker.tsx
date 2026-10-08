/**
 * Модель и размышление для отдельного помощника (база знаний, советник): свои, если выбраны, иначе — как в
 * разделе «ИИ». Значения хранятся в настройках модели (kbModel/kbThinking, advModel/advThinking).
 */
import type { Llm } from './shared';
import { ModelSelect } from './ui';

export const THINK_RU: Record<string, string> = { off: 'без размышления', low: 'короткое', medium: 'обычное', high: 'глубокое' };

export function ModelPicker({ llm, who, purpose }: { llm: Llm; who: 'kb' | 'adv'; purpose: string }) {
  const models = llm.check.state === 'ok' ? llm.check.models : [];
  const base = llm.settings.model || models[0] || '—';
  const mk = who === 'kb' ? 'kbModel' : 'advModel', tk = who === 'kb' ? 'kbThinking' : 'advThinking';
  return (
    <div className="kb-model">
      <ModelSelect value={llm.settings[mk] ?? ''} onChange={(v) => llm.set({ [mk]: v || undefined })} check={llm.check} empty={`как в «ИИ» (${base})`} title={`Модель для ${purpose}`} />
      <select value={llm.settings[tk] ?? ''} onChange={(e) => llm.set({ [tk]: (e.target.value || undefined) as typeof llm.settings.thinking })} title="Размышление модели перед ответом">
        <option value="">как в «ИИ» ({THINK_RU[llm.settings.thinking]})</option>
        {Object.entries(THINK_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <span className={`llm-st ${llm.check.state}`} title={llm.check.state === 'fail' ? llm.check.error : ''}>{llm.check.state === 'ok' ? '●' : llm.check.state === 'fail' ? '✗' : '…'}</span>
    </div>
  );
}
