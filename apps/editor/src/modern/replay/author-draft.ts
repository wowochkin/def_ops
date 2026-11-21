import type { Choice, Material, Scenario, ScenarioEvent, Side } from './session';

export type CountryDraft = { code: string; materials: Material[] };
export type DraftSide = CountryDraft & { objective: string; alternatives: CountryDraft[] };
export type DraftEvent = ScenarioEvent & { key: number };
export type AreaOption = { key: string; name: string; bounds: [number, number, number, number] };
export type AuthorDraft = {
  step: number;
  title: string;
  times: { start: string; end: string };
  periodHours: 6 | 12;
  disclosure: Scenario['disclosure'];
  area: AreaOption;
  sides: Record<Side, DraftSide>;
  choices: Choice[];
  events: DraftEvent[];
  nextKey: number;
};

const key = 'def_ops.modern.replay.author.v1';

function materialValid(item: Material) {
  return item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.required === 'boolean'
    && [item.category, item.summary, item.sourceUrl].every(value => value === undefined || typeof value === 'string')
    && (!item.sourceUrl || (URL.canParse(item.sourceUrl) && new URL(item.sourceUrl).protocol === 'https:'));
}
function countryValid(row: CountryDraft, countries: ReadonlyMap<string, string>) {
  return row && (row.code === '' || countries.has(row.code)) && Array.isArray(row.materials) && row.materials.every(materialValid);
}
function sideValid(side: DraftSide, countries: ReadonlyMap<string, string>) {
  return countryValid(side, countries) && typeof side.objective === 'string' && Array.isArray(side.alternatives)
    && side.alternatives.every(alt => !!alt.code && countryValid(alt, countries));
}
function eventValid(event: DraftEvent) {
  const bySide = (value: unknown) => value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([side, field]) => (side === 'a' || side === 'b') && typeof field === 'string'));
  return event && Number.isSafeInteger(event.key) && typeof event.at === 'string' && typeof event.text === 'string'
    && ['a', 'b', 'both', 'none'].includes(event.audience) && bySide(event.when) && bySide(event.reportAt)
    && (event.announcement === undefined || typeof event.announcement === 'string')
    && (event.ends === undefined || typeof event.ends === 'boolean');
}
export function readAuthorDraft(countries: ReadonlyMap<string, string>): AuthorDraft | null {
  try {
    const draft: AuthorDraft = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!draft || ![0, 1, 2].includes(draft.step) || typeof draft.title !== 'string'
      || ![6, 12].includes(draft.periodHours) || !['immediate', 'mutual'].includes(draft.disclosure)
      || typeof draft.times?.start !== 'string' || typeof draft.times?.end !== 'string'
      || !sideValid(draft.sides.a, countries) || !sideValid(draft.sides.b, countries)
      || !Array.isArray(draft.choices) || !draft.choices.length || !draft.choices.every(c => c && typeof c.id === 'string' && typeof c.label === 'string')
      || !Array.isArray(draft.events) || !draft.events.every(eventValid) || !Number.isSafeInteger(draft.nextKey)
      || !draft.area || typeof draft.area.name !== 'string' || typeof draft.area.key !== 'string') return null;
    const b = draft.area.bounds;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || Math.abs(b[0]) > 180 || Math.abs(b[2]) > 180
      || Math.abs(b[1]) > 90 || Math.abs(b[3]) > 90 || b[0] === b[2] || b[1] >= b[3]) return null;
    return draft;
  } catch { return null; }
}
export function writeAuthorDraft(serialized: string): boolean {
  try { localStorage.setItem(key, serialized); return true; } catch { return false; }
}
export function clearAuthorDraft() {
  try { localStorage.removeItem(key); } catch { /* Хранилище недоступно. */ }
}
