/** Карточка агента: исходные данные с источниками, переменные во времени, машина состояний, журнал, сверка с документами. */
import type { RunData } from './data';
import { hourOf, km, posAt, rowAt, stateGroup, timeLabel } from './data';

interface Props { data: RunData; id: string; hour: number; onHour: (h: number) => void }

const VARS: { idx: number; label: string; fmt: (v: number) => string }[] = [
  { idx: 3, label: 'Люди', fmt: (v) => Math.round(v).toLocaleString('ru-RU') },
  { idx: 4, label: 'Танки и САУ', fmt: (v) => String(Math.round(v)) },
  { idx: 5, label: 'Орудия и миномёты', fmt: (v) => String(Math.round(v)) },
  { idx: 6, label: 'Боекомплекты', fmt: (v) => v.toFixed(2) },
  { idx: 7, label: 'Заправки', fmt: (v) => v.toFixed(2) },
  { idx: 8, label: 'Усталость', fmt: (v) => v.toFixed(2) },
  { idx: 9, label: 'Организованность', fmt: (v) => v.toFixed(2) },
];

/** Машина состояний (docs/plans/agents.md, раздел 3.3): группы и подсостояния. */
const DIAGRAM: { group: string; title: string; subs: string[] }[] = [
  { group: 'reserve', title: 'Резерв', subs: ['не введена в операцию', 'резерв'] },
  { group: 'march', title: 'Марш', subs: ['марш: по дороге', 'марш: вне дорог', 'марш: привал', 'марш: затор', 'марш: переправа'] },
  { group: 'deploy', title: 'Развёртывание', subs: ['развёртывание'] },
  { group: 'attack', title: 'Наступление', subs: ['наступление: атака', 'наступление: второй эшелон', 'наступление: бой в глубине', 'наступление: закрепление'] },
  { group: 'defense', title: 'Оборона', subs: ['оборона: поспешная', 'оборона: подготовленная'] },
  { group: 'withdraw', title: 'Отход', subs: ['отход', 'отступление', 'остатки: выход из боя'] },
  { group: 'destroyed', title: 'Выбыла', subs: ['небоеспособна', 'сведена в другую дивизию'] },
];

function Spark({ data: d, i, idx, hour }: { data: RunData; i: number; idx: number; hour: number }) {
  const vs = d.trace.frames.map((f) => f[i][idx] as number);
  // шкала от нуля (у усталости и организованности — до 1): мелкие изменения не выглядят обвалом
  const unit = idx >= 8;
  const max = Math.max(unit ? 1 : 0, ...vs), min = 0;
  const W = 120, H = 26, n = vs.length - 1;
  const y = (v: number) => (max === min ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4));
  const pts = vs.map((v, h) => `${(h / n) * W},${y(v)}`).join(' ');
  return (
    <svg className="spark" width={W} height={H}>
      <polyline points={pts} />
      <line x1={(hour / n) * W} x2={(hour / n) * W} y1={0} y2={H} className="now" />
    </svg>
  );
}

export function Inspector({ data, id, hour, onHour }: Props) {
  const { trace, history } = data;
  const i = trace.divisions.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const d = trace.divisions[i];
  const hq = trace.hqs.find((h) => h.id === d.hq);
  const row = rowAt(trace, i, hour);
  const cur = row[2];
  const events = trace.journal.filter((e) => e.agent === id && e.tick <= hour);
  const order = [...events].reverse().find((e) => e.text.startsWith('получен приказ'));
  const pos = posAt(trace, i, hour);
  const docs = history.divisions.filter((p) => p.formation === id)
    .map((p) => ({ ...p, h: hourOf(trace.start, p.time) }))
    .map((p) => ({ ...p, dist: km(posAt(trace, i, Math.max(0, Math.min(trace.hours, p.h))), p.at) }));

  return (
    <div className="inspector">
      <h2>{d.name}</h2>
      <div className="sub">{hq?.name} · {d.side === 'su' ? 'Красная армия' : 'вермахт'} · {timeLabel(trace.start, hour)} МСК</div>

      <section>
        <h3>Сейчас</h3>
        <div className={`state-now ${stateGroup(cur)}`}>{cur}</div>
        {order && <div className="order">Приказ: {order.text.replace(/^получен приказ /, '')}</div>}
        <div className="coords">{pos[1].toFixed(3)}° с. ш., {pos[0].toFixed(3)}° в. д.</div>
      </section>

      <section>
        <h3>Переменные</h3>
        <table className="vars"><tbody>
          {VARS.map((v) => (
            <tr key={v.idx}><td>{v.label}</td><td className="num">{v.fmt(row[v.idx] as number)}</td><td><Spark data={data} i={i} idx={v.idx} hour={hour} /></td></tr>
          ))}
        </tbody></table>
      </section>

      <section>
        <h3>Машина состояний</h3>
        <div className="diagram">
          {DIAGRAM.map((g) => (
            <div key={g.group} className={`node ${g.group} ${stateGroup(cur) === g.group ? 'on' : ''}`}>
              <b>{g.title}</b>
              {g.subs.length > 1 && <ul>{g.subs.map((s) => <li key={s} className={s === cur ? 'on' : ''}>{s.split(': ')[1] ?? s}</li>)}</ul>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Исходные данные</h3>
        <div className="params">{d.kind} · подвижность: {d.mobility} · качество {d.quality}</div>
        <ul className="notes">{d.note.split('; ').filter(Boolean).map((n, k) => <li key={k}>{n}</li>)}</ul>
      </section>

      {docs.length > 0 && (
        <section>
          <h3>По документам</h3>
          <table className="docs"><tbody>
            {docs.map((p, k) => (
              <tr key={k} className={p.h <= hour ? '' : 'future'} onClick={() => onHour(Math.max(0, Math.min(trace.hours, p.h)))}>
                <td>{p.time.slice(8, 10)}.{p.time.slice(5, 7)} {p.time.slice(11, 16)}</td><td>{p.set} ({p.reliability ?? '—'})</td>
                <td className="num">{p.dist.toFixed(1)} км</td>
              </tr>
            ))}
          </tbody></table>
          <div className="hint">расстояние расчётного положения от положения по документу на то же время</div>
        </section>
      )}

      <section>
        <h3>Журнал</h3>
        <ol className="journal">
          {[...events].reverse().slice(0, 40).map((e, k) => (
            <li key={k} onClick={() => onHour(e.tick)}><span className="t">{e.time.slice(8, 10)}.{e.time.slice(5, 7)} {e.time.slice(11, 16)}</span> {e.text}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
