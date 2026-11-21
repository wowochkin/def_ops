import { useMemo, useState } from 'react';
import type { SavedSession } from './archive';
import { choiceLabel, deliveryLines, sideName, stamp } from './journal-text';
import { canJointReview, jointReview, type Decision, type LoggedEvent, type Session, type Side } from './session';

interface ComparedPeriod {
  end?: string;
  decisions: Partial<Record<Side, Decision>>;
  effectiveChoices?: Partial<Record<Side, string | null>>;
  events: readonly LoggedEvent[];
}

function periodsForComparison(session: Session) {
  const review = jointReview(session);
  const periods = new Map<string, ComparedPeriod>(review.periods.map(period => [period.start, period]));
  if (review.pending.a || review.pending.b) {
    periods.set(session.now, {
      decisions: review.pending, effectiveChoices: review.periods.at(-1)?.effectiveChoices, events: [],
    });
  }
  return periods;
}

function PeriodCell({ session, period, at }: { session: Session; period?: ComparedPeriod; at: string }) {
  if (!period) return <td>Сеанс завершён · {stamp(session.now)} UTC</td>;
  const through = at < session.now ? at : session.now;
  const events = period.events.filter(event => event.at <= through);
  return <td>
    <p>{period.end === undefined ? 'Незакрытый период'
      : period.end <= through ? 'Конец периода · ' + stamp(period.end) + ' UTC' : 'Период продолжается'}</p>
    {(['a', 'b'] as const).map(side => {
      const decision = period.decisions[side];
      return <div key={side}><strong>{sideName[side]}</strong>
        {decision ? <>
          <p>{choiceLabel(decision, session.scenario.choices, period.effectiveChoices?.[side])}</p>
          {decision.note && <p className="replay-verbatim">{decision.note}</p>}
        </> : <p>Запись не подтверждена</p>}
      </div>;
    })}
    {events.map((event, i) => <div key={i}>
      <p><time dateTime={event.at}>{stamp(event.at)} UTC</time> · {event.announcement && <strong>{event.announcement} · </strong>}{event.text}</p>
      {deliveryLines(event, through).map(line => <p key={line}><small>{line}</small></p>)}
    </div>)}
  </td>;
}

function AttemptHeading({ record, position }: { record: SavedSession; position: string }) {
  return <th scope="col">
    {record.summary.id === record.summary.original ? 'Исходный сеанс' : 'Повтор'} · {position}
    <div><small>Сохранено {stamp(record.summary.updated)} UTC</small></div>
  </th>;
}

interface CompareProps { left: SavedSession; right: SavedSession; onBack: () => void }

function Comparison({ left, right, onBack }: CompareProps) {
  const start = left.session.scenario.start;
  const end = left.session.now > right.session.now ? left.session.now : right.session.now;
  const [input, setInput] = useState(end.slice(0, -1));
  const timestamp = Date.parse(input + 'Z');
  const at = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
  const valid = at >= start && at <= end;
  const a = useMemo(() => periodsForComparison(left.session), [left.session]);
  const b = useMemo(() => periodsForComparison(right.session), [right.session]);
  const starts = [...new Set([...a.keys(), ...b.keys()])].filter(t => t <= at).sort();
  return <section className="replay-panel replay-compare">
    <button onClick={onBack}>К сеансам</button><h2>Сравнение прохождений</h2><p>{left.summary.title}</p>
    <label>Момент сравнения (UTC)
      <input type="datetime-local" step="any" min={start.slice(0, -1)} max={end.slice(0, -1)}
        value={input} onChange={event => setInput(event.target.value)} />
    </label>
    {!valid ? <p role="status">Выберите момент с {stamp(start)} по {stamp(end)} UTC.</p>
      : <table><thead><tr><th scope="col">Начало периода</th>
        <AttemptHeading record={left} position="первое выбранное прохождение" />
        <AttemptHeading record={right} position="второе выбранное прохождение" />
      </tr></thead>
        <tbody>{starts.length === 0 && <tr><td colSpan={3}>К этому моменту подтверждённых записей нет.</td></tr>}
          {starts.map(time => <tr key={time}><th scope="row">{stamp(time)} UTC</th>
          <PeriodCell session={left.session} period={a.get(time)} at={at} />
          <PeriodCell session={right.session} period={b.get(time)} at={at} />
        </tr>)}</tbody>
      </table>}
  </section>;
}

export function CompareSessions({ left, right, onBack }: CompareProps) {
  if (left.summary.id === right.summary.id || left.summary.original !== right.summary.original
      || !canJointReview(left.session) || !canJointReview(right.session)) {
    return <div role="alert">Выберите два раскрытых прохождения одного сценария. <button onClick={onBack}>Назад</button></div>;
  }
  return <Comparison key={left.summary.id + '/' + right.summary.id} left={left} right={right} onBack={onBack} />;
}
