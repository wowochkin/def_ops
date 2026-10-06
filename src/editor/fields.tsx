/** Поля ввода инспектора свойств. */
import type { ReactNode } from 'react';

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="row" title={hint}>
      <span className="lbl">{label}</span>
      <span className="ctl">{children}</span>
    </label>
  );
}

export function Num({ label, value, onChange, min = 0, max = 100, step = 0.1, hint }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string;
}) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <Row label={label} hint={hint}>
      <input type="range" min={min} max={Math.max(max, v)} step={step} value={v} onChange={(e) => onChange(+e.target.value)} />
      <input type="number" className="num" step={step} value={+v.toFixed(3)} onChange={(e) => onChange(+e.target.value)} />
    </Row>
  );
}

export function ColorF({ label, value, onChange, opacity, onOpacity }: {
  label: string; value: string; onChange: (v: string) => void; opacity?: number; onOpacity?: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <input type="color" value={normHex(value)} onChange={(e) => onChange(e.target.value)} />
      <input type="text" className="hex" value={value} onChange={(e) => onChange(e.target.value)} />
      {onOpacity && (
        <input type="number" className="num sm" title="Непрозрачность 0..1" min={0} max={1} step={0.05} value={opacity ?? 1}
          onChange={(e) => onOpacity(Math.max(0, Math.min(1, +e.target.value)))} />
      )}
    </Row>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <select value={String(value)} onChange={(e) => {
        const o = options.find(([k]) => String(k) === e.target.value);
        if (o) onChange(o[0]);
      }}>
        {options.map(([k, n]) => <option key={String(k)} value={String(k)}>{n}</option>)}
      </select>
    </Row>
  );
}

export function Text({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <Row label={label}>
      {multiline
        ? <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Row>
  );
}

export function DashF({ label, value, onChange }: { label: string; value?: number[]; onChange: (v: number[] | undefined) => void }) {
  return (
    <Row label={label} hint="Пунктир: длины штрихов и промежутков через пробел, пусто — сплошная">
      <input type="text" value={(value ?? []).map((x) => +x.toFixed(2)).join(' ')} placeholder="сплошная"
        onChange={(e) => {
          const arr = e.target.value.split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
          onChange(arr.length ? arr : undefined);
        }} />
    </Row>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section">
      <div className="sec-h"><span>{title}</span>{right}</div>
      {children}
    </div>
  );
}

function normHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  return '#000000';
}
