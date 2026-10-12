/**
 * Ход операции: вехи (по истории, в расчёте и в варианте для сравнения) и потери сторон к выбранному часу.
 * Вехи — из истории сценария (выход к пункту, встреча войск); «отсечение» расчётом не проверяется.
 */
import { useMemo } from 'react';
import type { RunData } from './data';
import { hourOf, lossesAt, milestoneHour, timeLabel } from './data';

const fmt = (start: string, h: number | null) => (h === null ? 'не достигнуто' : timeLabel(start, h).slice(0, 5) + ' ' + timeLabel(start, h).slice(11));
const k = (v: number) => `${(v / 1000).toFixed(1).replace('.', ',')} тыс.`;

export function Operation({ data, compare, compareName, hour, onHour }: { data: RunData; compare: RunData | null; compareName: string | null; hour: number; onHour: (h: number) => void }) {
  const { trace, history } = data;
  const rows = useMemo(() => (history.events ?? []).map((m) => ({
    m, hist: hourOf(trace.start, `${m.date}T20:00`), a: milestoneHour(trace, m), b: compare ? milestoneHour(compare.trace, m) : null,
  })), [trace, history, compare]);
  const delta = (h: number | null, hist: number) => (h === null ? '' : ` (${h - hist > 0 ? '+' : ''}${((h - hist) / 24).toFixed(1).replace('.', ',')} сут)`);
  return (
    <div className="inspector operation">
      <h2>Ход операции</h2>
      <div className="sub">{compareName ? <>сравнение с вариантом «{compareName}»</> : 'расчёт и история; вариант для сравнения — в заголовке'}</div>
      <section>
        <h3>Потери к {timeLabel(trace.start, hour).slice(0, 5)}</h3>
        <table className="ops">
          <thead><tr><th /><th>расчёт</th>{compare && <th>вариант</th>}</tr></thead>
          <tbody>
            <tr><td>СССР</td><td>{k(lossesAt(trace, 'su', hour))}</td>{compare && <td>{k(lossesAt(compare.trace, 'su', hour))}</td>}</tr>
            <tr><td>Германия</td><td>{k(lossesAt(trace, 'de', hour))}</td>{compare && <td>{k(lossesAt(compare.trace, 'de', hour))}</td>}</tr>
          </tbody>
        </table>
      </section>
      {rows.length > 0 && (
        <section>
          <h3>Вехи</h3>
          <ol className="miles">
            {rows.map(({ m, hist, a, b }) => (
              <li key={m.id} title={m.source ?? ''}>
                <div className="m">{m.title}</div>
                <div className="w">
                  <span>история <b>{m.date.slice(8, 10)}.{m.date.slice(5, 7)}</b></span>
                  {m.kind === 'cut' ? <span className="d">расчётом не проверяется</span> : <>
                    <span className={`t ${a !== null && a <= hour ? 'done' : ''}`} onClick={() => a !== null && onHour(a)}>расчёт <b>{fmt(trace.start, a)}</b><span className="d">{delta(a, hist)}</span></span>
                    {compare && <span className={`t v ${b !== null && b <= hour ? 'done' : ''}`} onClick={() => b !== null && onHour(b)}>вариант <b>{fmt(trace.start, b)}</b><span className="d">{delta(b, hist)}</span></span>}
                  </>}
                </div>
              </li>
            ))}
          </ol>
          <div className="hint">по истории — день события (сверка в 20:00); в скобках — отклонение расчёта, сутки; щелчок — перейти к часу</div>
        </section>
      )}
    </div>
  );
}
