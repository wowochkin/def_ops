/** Решения штабов до выбранного часа: кто, что и почему; у штаба на модели — запрос и ответ модели. */
import type { RunData } from './data';

export function StaffLog({ data, hour, onHour }: { data: RunData; hour: number; onHour: (h: number) => void }) {
  const { trace } = data;
  const ev = trace.journal.filter((e) => e.agent === null && e.text.startsWith('штаб «') && e.tick <= hour).reverse();
  const calls = trace.staff ?? [];
  const src = trace.sources?.[1] ?? 'script';
  return (
    <div className="inspector">
      <h2>Решения штабов</h2>
      <div className="sub">немецкая сторона: {src === 'llm' ? `языковая модель ${trace.llm?.model ?? ''}` : src === 'doctrine' ? 'по доктрине' : 'исторические приказы'}</div>
      {src === 'script' && <div className="hint" style={{ marginTop: 8 }}>Штабы действуют по приказам сценария. Чтобы штабы решали сами, выберите «по доктрине» или «языковая модель» в настройках и пересчитайте.</div>}
      <ol className="journal">
        {ev.map((e, k) => {
          const [head, ...rest] = e.text.split(': ');
          const call = calls.find((c) => c.tick === e.tick && head.includes(trace.hqs.find((h) => h.id === c.hq)?.name ?? '\u0000'));
          return (
            <li key={k} onClick={() => onHour(e.tick)}>
              <span className="t">{e.time.slice(8, 10)}.{e.time.slice(5, 7)} {e.time.slice(11, 16)}</span> <b>{head}</b>
              <ul className="notes">{rest.join(': ').split('; ').map((x, i) => <li key={i}>{x}</li>)}</ul>
              {call && <details onClick={(x) => x.stopPropagation()}><summary>запрос и ответ модели</summary><pre className="pre">{call.request}</pre><pre className="pre">{call.reply}</pre></details>}
            </li>
          );
        })}
      </ol>
      {ev.length === 0 && src !== 'script' && <div className="hint">к этому часу решений ещё не было</div>}
    </div>
  );
}
