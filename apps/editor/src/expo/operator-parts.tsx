/** Элементы меню оператора: шаг числа, порядок мониторов, сводка служб и статистики дня. */
import { PROBE_NAMES, type ProbeState, type ProbeStates } from './health';
import type { ExpoStats } from './stats';
import type { MonitorInfo } from './windows';

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValue: (v: number) => void;
}) {
  const to = (v: number) => onValue(Math.min(max, Math.max(min, v)));
  return (
    <div className="expo-stepper" role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label}: меньше`} disabled={value <= min} onClick={() => to(value - step)}>
          −
        </button>
        <output>{value}</output>
        <button type="button" aria-label={`${label}: больше`} disabled={value >= max} onClick={() => to(value + step)}>
          +
        </button>
      </div>
    </div>
  );
}

/** Полный порядок мониторов (сначала известные из `order`, затем остальные по `ids`) со сдвигом `id` на `by`. */
export function moveMonitor(order: string[], ids: string[], id: string, by: -1 | 1): string[] {
  const first = [...new Set(order)].filter((x) => ids.includes(x));
  const full = [...first, ...ids.filter((x) => !first.includes(x))];
  const i = full.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= full.length) return full;
  [full[i], full[j]] = [full[j], full[i]];
  return full;
}

export function MonitorOrder({ monitors, order, onOrder }: { monitors: MonitorInfo[]; order: string[]; onOrder: (order: string[]) => void }) {
  if (!monitors.length) return <p className="expo-muted">Мониторы не найдены.</p>;
  const ids = monitors.map((m) => m.id);
  const full = moveMonitor(order, ids, '', 1);
  return (
    <ol className="expo-monitors" aria-label="Порядок экранов">
      {full.map((id, i) => {
        const m = monitors.find((x) => x.id === id)!;
        return (
          <li key={id}>
            <span>
              {m.name} · {m.id}
            </span>
            <button type="button" aria-label={`${m.name}: выше`} disabled={i === 0} onClick={() => onOrder(moveMonitor(order, ids, id, -1))}>
              ↑
            </button>
            <button
              type="button"
              aria-label={`${m.name}: ниже`}
              disabled={i === full.length - 1}
              onClick={() => onOrder(moveMonitor(order, ids, id, 1))}
            >
              ↓
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export const PROBE_WORDS: Record<ProbeState, string> = { wait: 'проверяю…', ok: 'готово', fail: 'нет связи', off: 'не требуется' };

export function ServiceSummary({
  health,
  note,
  stats,
  screens,
}: {
  health: ProbeStates;
  note: string | null;
  stats: ExpoStats;
  screens: { open: number; want: number };
}) {
  return (
    <section className="expo-summary" aria-label="Состояние стенда">
      <ul>
        {(Object.keys(PROBE_NAMES) as (keyof ProbeStates)[]).map((id) => (
          <li key={id} data-state={health[id]}>
            {id === 'windows' && health[id] === 'ok'
              ? `${PROBE_NAMES[id]} — ${screens.open} из ${screens.want}`
              : `${PROBE_NAMES[id]} — ${PROBE_WORDS[health[id]]}`}
          </li>
        ))}
      </ul>
      <dl>
        <div>
          <dt>Начато</dt>
          <dd>{stats.sessions}</dd>
        </div>
        <div>
          <dt>Завершено</dt>
          <dd>{stats.finished}</dd>
        </div>
        <div>
          <dt>Сбоев</dt>
          <dd>{stats.failures}</dd>
        </div>
        <div>
          <dt>ИИ вовремя</dt>
          <dd>{aiShare(stats)}</dd>
        </div>
      </dl>
      {note && <p className="expo-note">{note}</p>}
    </section>
  );
}

/** Доля ответов ИИ вовремя: «92 % (46 из 50)»; ответов не было — «—». */
export function aiShare(s: ExpoStats): string {
  const on = s.aiOnTime ?? 0;
  const all = on + (s.aiFallback ?? 0);
  return all ? `${Math.round((on / all) * 100)} % (${on} из ${all})` : '—';
}
