/** Поле ввода момента в выбранном поясе (мск / местное / UTC); хранится UTC. */
import type { TimeInstant } from '@def-ops/core';
import { fromInput, inputZoneId, toInput, useZones, zoneName, type InputZone } from './time';

const NEXT: Record<InputZone, InputZone> = { msk: 'local', local: 'utc', utc: 'msk' };
const LABEL: Record<InputZone, string> = { msk: 'мск', local: 'местн.', utc: 'UTC' };

export function MomentInput({ value, onChange, title }: { value: TimeInstant | null | undefined; onChange: (t: TimeInstant | null) => void; title?: string }) {
  const z = useZones();
  const zone = inputZoneId(z);
  return (
    <span className="moment-in" title={title}>
      <input type="datetime-local" value={toInput(value, zone)} onChange={(e) => onChange(fromInput(e.target.value, zone))} />
      <ZoneToggle />
      {z.input === 'local' && <span className="muted zone-hint">{zoneName(z.local)}</span>}
    </span>
  );
}

/** Переключатель пояса ввода (общий для всего редактора). */
export function ZoneToggle() {
  const z = useZones();
  return (
    <button className="zone-btn" title={`Время вводится как ${z.input === 'msk' ? 'московское' : z.input === 'local' ? `местное (${zoneName(z.local)})` : 'UTC'}. Щёлкните, чтобы сменить.`}
      onClick={(e) => { e.preventDefault(); z.setInput(NEXT[z.input]); }}>{LABEL[z.input]}</button>
  );
}
