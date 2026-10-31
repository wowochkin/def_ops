/**
 * Части сцен сеанса по виду модели: карточки перелома, раскрытие решения, три шкалы хода операции, строки хода и итог.
 * Простая подача без карты и анимации (их добавит этап «Подача»).
 */
import { BANK, type TurnN } from './bank';
import type { ModelFrame } from './model';
import type { Scales as ScalesData } from './session';
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

/** Три шкалы: от −1 (хуже истории) до +1 (лучше); середина — как в истории. */
export function Scales({ scales }: { scales: ScalesData }) {
  return (
    <div className="expo-scales">
      {AXES.map(([k, label]) => {
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
    <ul className="expo-feed">
      {lines.slice(-4).map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
