import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './datetime.css';

const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'] as const;
const monthsGenitive = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'] as const;
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const pattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
const pad = (value: number) => String(value).padStart(2, '0');

type DateParts = { year: number; month: number; day: number; time: string };

type Props = {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  withTime?: boolean;
  required?: boolean;
  min?: string;
  max?: string;
  floating?: boolean;
  disabled?: boolean;
};

function parse(value: string): DateParts | null {
  const match = pattern.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3]);
  const time = `${match[4] ?? '00'}:${match[5] ?? '00'}`;
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  if (Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59) return null;
  return { year, month, day, time };
}

function cells(year: number, month: number): (number | null)[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day >= 1 && day <= count ? day : null;
  });
}

export function DateTimeField({ id, label, value, onChange, withTime = true, required = false, min, max, floating = false, disabled = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const validity = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const [placement, setPlacement] = useState({ left: 16, top: 16 });
  const parts = parse(value);
  const now = new Date();
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const years = [...new Set([...Array.from({ length: 201 }, (_, index) => 1900 + index), view.year])].sort((a, b) => a - b);

  function show(): void {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      setPlacement({ left: Math.max(16, Math.min(rect.left, window.innerWidth - 396)), top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 520)) });
      const below = window.innerHeight - rect.bottom;
      setUpward(below < 520 && rect.top > below);
    }
    setView(parts ? { year: parts.year, month: parts.month } : { year: now.getFullYear(), month: now.getMonth() });
    setOpen(true);
  }
  function close(restoreFocus = false): void {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function shiftMonth(offset: number): void {
    setView(current => {
      const date = new Date(current.year, current.month + offset, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  }
  function chooseDay(day: number): void {
    const date = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
    onChange(withTime ? `${date}T${parts?.time ?? '00:00'}` : date);
  }
  function dayDisabled(day: number): boolean {
    const date = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
    return Boolean(min && date < min.slice(0, 10)) || Boolean(max && date > max.slice(0, 10));
  }

  useEffect(() => {
    const input = validity.current;
    if (!input) return;
    input.setCustomValidity(value && min && value < min ? `Значение раньше допустимого: ${min}` : value && max && value > max ? `Значение позже допустимого: ${max}` : '');
  }, [value, min, max]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    document.addEventListener('mousedown', outside);
    panel.current?.querySelector<HTMLButtonElement>('[data-day][aria-pressed="true"], [data-day]')?.focus();
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open || !floating) return;
    const moved = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close(); };
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', moved, true);
    return () => { window.removeEventListener('resize', moved); window.removeEventListener('scroll', moved, true); };
  }, [open, floating]);
  const renderPanel = (content: React.ReactNode) => floating ? createPortal(<div className="modern-workspace modern-kshvi modern-datetime-floating">{content}</div>, document.body) : content;
  const text = parts ? `${pad(parts.day)}.${pad(parts.month + 1)}.${parts.year}${withTime ? ` · ${parts.time}` : ''}` : withTime ? 'Выбрать дату и время' : 'Выбрать дату';
  return <div className="modern-datetime" ref={root}>
    <label htmlFor={id}>{label}</label>
    <button disabled={disabled} ref={trigger} id={id} className="modern-datetime-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-required={required || undefined} onClick={() => open ? close() : show()}>
      <span>{text}</span><span aria-hidden="true">▾</span>
    </button>
    <input disabled={disabled} ref={validity} className="modern-datetime-validity" value={value} required={required} tabIndex={-1} aria-hidden="true" pattern={withTime ? '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' : '\\d{4}-\\d{2}-\\d{2}'} onChange={() => {}} onInvalid={event => { event.preventDefault(); show(); }} />
    {open && !disabled && renderPanel(<div ref={panel} style={floating ? { position: 'fixed', ...placement, bottom: 'auto', pointerEvents: 'auto' } : undefined} className={`modern-datetime-popover${upward && !floating ? ' modern-datetime-upward' : ''}`} role="dialog" aria-modal="false" aria-label={`${withTime ? 'Дата и время' : 'Дата'}: ${label}`} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    }}>
      <div className="modern-datetime-month">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>←</button>
        <select aria-label="Месяц" value={view.month} onChange={event => setView(current => ({ ...current, month: Number(event.target.value) }))}>
          {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
        </select>
        <select aria-label="Год" value={view.year} onChange={event => setView(current => ({ ...current, year: Number(event.target.value) }))}>
          {years.map(year => <option key={year} value={year}>{year}</option>)}
        </select>
        <button type="button" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>→</button>
      </div>
      <div className="modern-datetime-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
      <div className="modern-datetime-days">{cells(view.year, view.month).map((day, index) => day === null
        ? <span key={`empty-${index}`} aria-hidden="true" />
        : <button key={day} data-day={day} type="button" disabled={dayDisabled(day)} aria-label={`${day} ${monthsGenitive[view.month]} ${view.year}`} aria-pressed={parts?.year === view.year && parts.month === view.month && parts.day === day} onClick={() => chooseDay(day)}>{day}</button>)}
      </div>
      {withTime && <label className="modern-datetime-time">Время<input type="time" disabled={!parts} value={parts?.time ?? '00:00'} onChange={event => {
        if (parts && /^\d{2}:\d{2}$/.test(event.target.value)) onChange(`${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${event.target.value}`);
      }} /></label>}
      <div className="modern-datetime-actions">
        <button type="button" disabled={!parts} onClick={() => { onChange(''); close(true); }}>Очистить</button>
        <button className="kshvi-primary" type="button" disabled={!parts} onClick={() => close(true)}>Готово</button>
      </div>
    </div>)}
  </div>;
}
