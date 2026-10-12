/**
 * Штабы на модели во время расчёта: по каждому штабу, который сейчас спрашивает модель, — ожидание, размышления и
 * ответ по мере прихода (событие staff-stream ядра). Видно, что модель работает, а не зависла.
 */
import { useEffect, useRef } from 'react';
import type { StaffLiveMsg } from './data';

const PHASE: Record<StaffLiveMsg['phase'], string> = { wait: 'ждёт модель', think: 'размышляет', answer: 'отвечает', done: 'готово', error: 'ошибка — решит доктрина' };

function Card({ m }: { m: StaffLiveMsg }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [m.think, m.text]);
  const going = m.phase !== 'done' && m.phase !== 'error';
  return (
    <div className={`live-card ${m.phase}`}>
      <div className="meta">{going && <span className="spinner" />}<b>{m.name}</b> · {m.time.slice(8, 10)}.{m.time.slice(5, 7)} {m.time.slice(11, 16)} · {PHASE[m.phase]} · {m.secs.toFixed(1)} с{m.parts ? ` · ${m.parts} ч.` : ''}</div>
      {(m.think || m.text) && <pre ref={box} className={m.text.trim() ? 'answer' : 'think'}>{m.text.trim() ? m.text : m.think}</pre>}
    </div>
  );
}

export function StaffLive({ items }: { items: StaffLiveMsg[] }) {
  if (!items.length) return null;
  return (
    <div className="inspector staff-live">
      <h2>Штабы думают</h2>
      <div className="sub">ответы модели по мере прихода; у каждого штаба — время с начала запроса</div>
      {items.map((m) => <Card key={m.hq} m={m} />)}
    </div>
  );
}
