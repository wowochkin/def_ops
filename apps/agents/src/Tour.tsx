/** Панель показа: момент операции с подписью, сверка с историей, переходы и проигрыш до следующего момента. */
import type { RunData } from './data';
import { hourOf, timeLabel } from './data';
import type { Moment } from './moments';
import { momentHour } from './moments';

interface Props { data: RunData; moments: Moment[]; idx: number; playing: boolean; onGo: (k: number) => void; onPlayNext: () => void; onClose: () => void }

export function Tour({ data, moments, idx, playing, onGo, onPlayNext, onClose }: Props) {
  const m = moments[idx];
  const { trace } = data;
  const { h, hist, reached } = momentHour(data, m);
  const d = hist ? (h - hourOf(trace.start, `${hist}T20:00`)) / 24 : null;
  return (
    <div className="tour">
      <div className="tour-head">
        <span className="tour-n">{idx + 1} / {moments.length}</span>
        <b>{m.title}</b>
        <span className="spacer" />
        <button onClick={onClose} title="Закрыть показ">×</button>
      </div>
      <div className="tour-when">
        {timeLabel(trace.start, h).slice(0, 5)} {timeLabel(trace.start, h).slice(11)} МСК
        {hist && <span className="muted"> · по истории {hist.slice(8, 10)}.{hist.slice(5, 7)}{reached ? (d !== null && Math.abs(d) >= 0.5 ? `, расчёт ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} сут` : ', расчёт в пределах суток') : ', по критерию вехи в этом прогоне не достигнуто'}</span>}
      </div>
      <p>{m.text}</p>
      <div className="tour-nav">
        <button disabled={idx === 0} onClick={() => onGo(idx - 1)}>← Назад</button>
        {idx + 1 < moments.length && <button onClick={onPlayNext} disabled={playing}>▶ до следующего</button>}
        <button disabled={idx + 1 >= moments.length} onClick={() => onGo(idx + 1)}>Далее →</button>
      </div>
    </div>
  );
}
