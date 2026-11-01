/**
 * Части сцен сеанса по виду модели: оперативная сводка хода (лента операции с переломами и «сейчас», задачи фронта
 * с отметками, журнал событий хода ядра, расстояние до Берлина, потери и темп против истории, шкалы — только когда им
 * есть что показать), до первого решения — обстановка на начало (силы, соотношение, что предстоит).
 */
import { BANK, type TurnN } from './bank';
import { BRIEFING } from './briefing';
import type { ModelFrame } from './model';
import { timeAt, type ModelView, type Scales as ScalesData } from './session';
import { dayMonth } from './score';
import type { FrontId } from './settings';

export const turnDef = (front: FrontId | null, n: TurnN) => (front ? BANK.fronts[front].turns.find((t) => t.n === n) ?? null : null);

/** «20 апреля, 05:00». */
export const modelTime = (iso: string) => `${dayMonth(iso)}, ${iso.slice(11, 16)}`;

export function ModelNote({ model }: { model: ModelFrame }) {
  if (model.error) return <p className="expo-status" role="alert">{model.error}</p>;
  if (model.view?.busy) return <p className="expo-status">Модель считает ход операции…</p>;
  return null;
}

const AXES = [
  ['speed', 'Скорость'],
  ['cost', 'Цена'],
  ['intent', 'Замысел'],
] as const;

/** Есть ли что показать на шкале: события наступили, эталон потерь есть, задачи уже подошли. */
const hasAxis = (k: (typeof AXES)[number][0], a: ScalesData['axes']) => (k === 'speed' ? a.days !== null : k === 'cost' ? a.lossRatio !== null && a.lossRatio > 0 : a.due > 0);

/** Шкалы, которым есть что показать: от −1 (хуже истории) до +1 (лучше); середина — как в истории. */
export function Scales({ scales }: { scales: ScalesData }) {
  const shown = AXES.filter(([k]) => hasAxis(k, scales.axes));
  if (!shown.length) return null;
  return (
    <div className="expo-scales">
      {shown.map(([k, label]) => {
        const v = scales.axes[k];
        return (
          <div key={k} className="expo-scale" data-axis={k}>
            <span className="expo-scale-label">{label}</span>
            <span className="expo-scale-bar" role="meter" aria-label={label} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={Number(v.toFixed(2))}>
              <span className={v >= 0 ? 'expo-scale-up' : 'expo-scale-down'} style={{ left: `${50 + Math.min(0, v) * 50}%`, width: `${Math.abs(v) * 50}%` }} />
            </span>
            <span className="expo-scale-note">{scales.notes[k]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Feed({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="expo-feed" aria-label="Журнал хода">
      {lines.slice(-4).map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

const START = '1945-04-16T05:00';
/** Конец операции по истории — 8 мая. */
const END = '1945-05-08T23:00';
/** Миллисекунды момента: дата (ГГГГ-ММ-ДД) — полдень этого дня. */
const ms = (iso: string) => Date.parse(`${iso.length === 10 ? `${iso}T12:00` : iso.slice(0, 16)}:00Z`);
/** Место момента на ленте, %. */
const at = (iso: string) => `${Math.max(0, Math.min(100, ((ms(iso) - ms(START)) / (ms(END) - ms(START))) * 100)).toFixed(2)}%`;
const num = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

/** Лента операции 16 апреля — 8 мая: три перелома, «сейчас», задачи — по истории (снизу) и в ходе (сверху). */
export function Timeline({ mv }: { mv: ModelView }) {
  const turns = BANK.fronts[mv.front].turns;
  return (
    <div className="expo-tl" role="img" aria-label={`Лента операции: сейчас ${modelTime(mv.time)}`}>
      <div className="expo-tl-axis" />
      {turns.map((x) => {
        const done = mv.decisions.some((d) => d.n === x.n);
        return (
          <span key={x.n} className={`expo-tl-turn${done ? ' expo-tl-done' : ''}`} style={{ left: at(timeAt(START, x.hour)) }}>
            {x.n}
          </span>
        );
      })}
      {mv.tasks.map((x) => (
        <span key={`h-${x.id}`} className="expo-tl-hist" style={{ left: at(x.historical) }} />
      ))}
      {mv.tasks.filter((x) => x.simulated).map((x) => (
        <span key={`s-${x.id}`} className="expo-tl-own" style={{ left: at(x.simulated!) }} />
      ))}
      <span className="expo-tl-now" style={{ left: at(mv.time) }} />
      <span className="expo-tl-from">16 апреля</span>
      <span className="expo-tl-to">8 мая</span>
    </div>
  );
}

/** Задачи фронта с отметками: выполнена (дата и сравнение с историей), по истории уже пора, впереди. */
export function Tasks({ mv, limit = 6 }: { mv: ModelView; limit?: number }) {
  const now = mv.time.slice(0, 10);
  return (
    <ul className="expo-tasks" aria-label="Задачи фронта">
      {mv.tasks.slice(0, limit).map((x) => {
        const state = x.simulated ? 'done' : x.historical && x.historical <= now ? 'late' : 'ahead';
        return (
          <li key={x.id} data-state={state}>
            <span className="expo-task-mark" aria-hidden="true">{state === 'done' ? '✓' : state === 'late' ? '!' : '○'}</span>
            <span className="expo-task-title">{x.title}</span>
            <span className="expo-task-when">
              {state === 'done'
                ? `${dayMonth(x.simulated!)}${x.days ? `, в истории — ${dayMonth(x.historical)}` : ', как в истории'}`
                : x.historical
                  ? `${state === 'late' ? 'в истории — уже' : 'в истории —'} ${dayMonth(x.historical)}`
                  : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Крупные цифры хода против истории: до Берлина, потери, темп задач. */
export function Figures({ mv, tempo = true }: { mv: ModelView; tempo?: boolean }) {
  const a = mv.scales.axes;
  const items: { value: string; label: string }[] = [];
  if (mv.berlinKm) items.push({ value: `${mv.berlinKm.now} км`, label: `до Берлина; в истории в этот день — ${mv.berlinKm.history} км` });
  if (mv.decisions.length && mv.loss.own > 0) items.push({ value: num(mv.loss.own), label: mv.loss.ref ? `потери; в истории к этому часу — ${num(mv.loss.ref)}` : 'потери фронта' });
  if (tempo && a.days !== null) items.push({ value: Math.abs(a.days) < 0.5 ? 'в срок' : `${a.days < 0 ? '−' : '+'}${Math.abs(a.days).toFixed(1).replace('.', ',')} сут`, label: Math.abs(a.days) < 0.5 ? 'задачи — как в истории' : `задачи ${a.days < 0 ? 'раньше' : 'позже'} истории, в среднем` });
  return (
    <dl className="expo-figures" data-n={items.length}>
      {items.map((x) => (
        <div key={x.label}>
          <dt>{x.value}</dt>
          <dd>{x.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Обстановка на начало (до первого решения): свои силы и соотношение из доклада, что предстоит. */
export function Opening({ mv, tasks = true }: { mv: ModelView; tasks?: boolean }) {
  const b = BRIEFING[mv.front];
  const facts = [...(b[1]?.facts ?? []), b[5]?.facts[0]].filter(Boolean).slice(0, tasks ? 4 : 3);
  return (
    <>
      <h3 className="expo-sum-h">Обстановка на начало</h3>
      <dl className="expo-figures" data-n={facts.length}>
        {facts.map((f) => (
          <div key={f!.value + f!.label}>
            <dt>{f!.value}</dt>
            <dd>{f!.label}</dd>
          </div>
        ))}
      </dl>
      {tasks && <h3 className="expo-sum-h">Что предстоит</h3>}
      {tasks && <Tasks mv={mv} />}
    </>
  );
}

/** Оперативная сводка хода: `full` — экран «Ход операции», `compact` — колонка рядом с решением. */
export function OpSummary({ mv, size }: { mv: ModelView; size: 'full' | 'compact' }) {
  if (!mv.decisions.length) return size === 'full' ? <><Timeline mv={mv} /><Opening mv={mv} /></> : <Opening mv={mv} tasks={false} />;
  return (
    <>
      {size === 'full' && <Timeline mv={mv} />}
      <Figures mv={mv} tempo={size === 'full'} />
      {size === 'full' && <Tasks mv={mv} />}
      <Scales scales={mv.scales} />
      <Feed lines={mv.feed.slice(size === 'full' ? -3 : -1)} />
    </>
  );
}
