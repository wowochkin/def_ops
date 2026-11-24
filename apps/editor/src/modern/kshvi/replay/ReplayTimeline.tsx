import { useState } from 'react';

export function ReplayTimeline({ sequence, maxSequence, operationalAt, wallClockAt, onSeek }: {
  sequence: number;
  maxSequence: number;
  operationalAt: string;
  wallClockAt: string;
  onSeek: (sequence: number) => void;
}) {
  const [speed, setSpeed] = useState('1');
  return <section aria-label="Шкала реплея" style={{ display: 'grid', gap: 8 }}>
    <div><label htmlFor="replay-position">Позиция реплея</label>
      <input id="replay-position" type="range" min={0} max={maxSequence} step={1} value={sequence}
        onChange={event => onSeek(Number(event.currentTarget.value))} />
      <output>{sequence}</output>
    </div>
    <label>Скорость просмотра
      <select aria-label="Скорость просмотра" value={speed} onChange={event => setSpeed(event.currentTarget.value)}>
        <option value="0.5">0,5×</option><option value="1">1×</option><option value="8">8×</option><option value="16">16×</option>
      </select>
    </label>
    <p>Оперативное время: {operationalAt}</p>
    <p>Астрономическое время: {wallClockAt}</p>
    <small>Скорость влияет только на отображение и не меняет расчёт или хеш состояния.</small>
  </section>;
}
