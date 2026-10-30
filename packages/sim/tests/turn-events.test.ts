import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AgentHistory, AgentTrace } from '../src/agents';
import { LOSS_FIELDS } from '../src/results';
import { BAND_PAD_KM, debriefFor, debriefWindow, turnEvents } from '../src/turn-events';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../src/data';
import type { History } from '../src/history';
import { contextFrom } from '../src/source';
import type { SimContext } from '../src/step';

const ROOT = join(__dirname, '../../..');
const FIELDS = ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled', ...LOSS_FIELDS];
const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};
const BERLIN = JSON.parse(readFileSync(join(ROOT, 'packages/sim/data/scenarios/agents/berlin-1945.history.json'), 'utf8')) as AgentHistory;
const H: AgentHistory = { divisions: [], events: BERLIN.events };

type P = [number, number];
/** Точка в km к востоку (dx) и к северу (dy) от p. */
const off = (p: P, dx: number, dy = 0): P => [p[0] + dx / (111.32 * Math.cos((p[1] * Math.PI) / 180)), p[1] + dy / 110.57];

const DIVS = [
  ['su_a', 'su_8gva'], ['su_b', 'su_8gva'], ['su_c', 'su_8gva'], ['su_d', 'su_33a'], ['su_e', 'su_1gta'], ['su_f', 'su_1gta'],
  ['de_a', 'de_9a'], ['de_b', 'de_9a'], ['de_c', 'de_9a'],
] as const;
/** Исходные места: советские — восточнее Зееловских высот, немецкие — у Берлина (далеко от советских). */
const HOME: Record<string, P> = {
  su_a: [14.7, 52.5], su_b: [14.7, 52.53], su_c: [14.7, 52.47], su_d: [14.75, 52.75], su_e: [14.75, 52.3], su_f: [14.75, 52.27],
  de_a: [13.6, 52.5], de_b: [13.6, 52.53], de_c: [13.6, 52.47],
};
type Row = { at?: P; state?: string; enc?: number; lost?: number; captured?: number };
/** Ход на 24 кадра (часы 0…23); f(id, h) — отличия строки дивизии от обороны на месте без потерь. */
function trace(f: (id: string, h: number) => Row = () => ({})): AgentTrace {
  return {
    scenario: 'test', name: 'проба', start: '1945-04-16T05:00', hours: 23, seed: 1, fields: FIELDS,
    divisions: DIVS.map(([id, hq]) => ({ id, name: `дивизия ${id}`, side: id.slice(0, 2), hq, kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 })),
    hqs: [
      { id: 'su_stavka', name: 'Ставка ВГК', side: 'su', echelon: 'high_command', parent: null },
      { id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: 'su_stavka' },
      { id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'su_33a', name: '33-я армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'su_1gta', name: '1-я гвардейская танковая армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'de_9a', name: '9-я армия', side: 'de', echelon: 'army', parent: null },
    ],
    frames: Array.from({ length: 24 }, (_, h) => DIVS.map(([id]) => {
      const r = f(id, h);
      const at = r.at ?? HOME[id];
      return [at[0], at[1], r.state ?? 'оборона: подготовленная', 8000 - (r.lost ?? 0), 10, 50, 2, 1, 0.1, 0.9, r.enc ?? 0, r.lost ?? 0, 0, 0, r.captured ?? 0, 0];
    })),
    journal: [],
  };
}
const ATTACK = 'наступление: бой в глубине';
/** Дивизии 8 гв. А наступают и за часы 11…23 уходят на 8 км к западу. */
const push8 = (id: string, h: number): Row | null => id.startsWith('su_') && DIVS.find((d) => d[0] === id)![1] === 'su_8gva'
  ? { state: ATTACK, at: off(HOME[id], -8 * Math.max(0, h - 11) / 12) } : null;

let base: SimContext;
let history: History | null;
beforeAll(async () => { ({ ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks')); });

describe('ключевые события хода', () => {
  it('breakthrough by army', () => {
    const d = turnEvents(base, trace((id, h) => push8(id, h) ?? {}), H, history, 11, 23, { side: 'su' });
    const br = d.events.filter((e) => e.kind === 'breakthrough');
    expect(br).toHaveLength(1);
    expect(br[0].km!).toBeCloseTo(8, 0);
    expect(br[0].hqs).toEqual(expect.arrayContaining(['su_8gva', 'su_1bf']));
    expect(br[0].divisions.sort()).toEqual(['su_a', 'su_b', 'su_c']);
    expect(br[0].from).not.toBeNull();
    expect(br[0].side).toBe('su');
    expect(d.from).toBe(11);
    expect(d.to).toBe(23);
  });

  it('counterattack', () => {
    const d = turnEvents(base, trace((id, h) => (id === 'de_a' || id === 'de_b') && h >= 16 ? { state: 'наступление: встречный бой' } : {}), H, history, 11, 23, { side: 'su' });
    const ca = d.events.filter((e) => e.kind === 'counterattack');
    expect(ca).toHaveLength(1);
    expect(ca[0].side).toBe('de');
    expect(ca[0].divisions.sort()).toEqual(['de_a', 'de_b']);
    expect(ca[0].to).not.toBeNull();
  });

  it('encirclement and destroyed', () => {
    const d = turnEvents(base, trace((id, h) => id.startsWith('de_') ? { enc: h + 7, ...(id === 'de_c' && h >= 20 ? { state: 'небоеспособна' } : {}) } : {}), H, history, 11, 23, { side: 'su' });
    const enc = d.events.find((e) => e.kind === 'encirclement');
    expect(enc).toBeDefined();
    expect(enc!.side).toBe('de');
    expect(enc!.divisions.length).toBeGreaterThanOrEqual(2);
    const ds = d.events.find((e) => e.kind === 'destroyed');
    expect(ds?.divisions).toEqual(['de_c']);
    expect(ds!.tick).toBe(20);
  });

  it('capture from score events', () => {
    const c = base.theatre.area('Muencheberg')!.center! as P;
    const inWin = turnEvents(base, trace((id, h) => id === 'su_a' ? { at: h >= 15 ? c : off(c, 20) } : {}), H, history, 11, 23, { side: 'su' });
    const cap = inWin.events.find((e) => e.kind === 'capture');
    expect(cap?.id).toBe('seelow');
    expect(cap!.divisions).toContain('su_a');
    const before = turnEvents(base, trace((id, h) => id === 'su_a' ? { at: h >= 3 ? c : off(c, 20) } : {}), H, history, 11, 23, { side: 'su' });
    expect(before.events.find((e) => e.kind === 'capture')).toBeUndefined();
  });

  it('quiet turn', () => {
    const d = turnEvents(base, trace((id, h) => id.startsWith('su_') ? { lost: 10 * h } : {}), H, history, 11, 23, { side: 'su' });
    expect(d.events).toHaveLength(0);
    expect(d.quiet.maxAdvanceKm).toBeLessThan(1);
    expect(d.quiet.lost).toBe(6 * 10 * 12);
  });

  it('causes', () => {
    const t = trace((id, h) => push8(id, h) ?? ((id === 'de_a' || id === 'de_b') && h >= 16 ? { state: 'наступление: встречный бой' } : {}));
    t.documents = [
      { tick: 5, time: '', hq: 'su_8gva', kind: 'order', to: ['su_a'], text: 'Армии наступать на Зеелов', rule: null },
      { tick: 12, time: '', hq: 'de_9a', kind: 'order', to: ['de_a'], text: 'Контрудар у Альт-Тухебанда', rule: null },
    ];
    t.commanders = [{ hq: 'su_1bf', decisions: [{ tick: 15, trigger: 'x', chosen: 0, why: 'Ввести танки в прорыв', options: [] }] }] as unknown as AgentTrace['commanders'];
    const d = turnEvents(base, t, H, history, 11, 23, { side: 'su' });
    const br = d.events.find((e) => e.kind === 'breakthrough')!;
    expect(br.causes.map((c) => [c.kind, c.hq, c.tick])).toEqual([['decision', 'su_1bf', 15], ['document', 'su_8gva', 5]]);
    expect(br.causes[0].text).toBe('Ввести танки в прорыв');
    const ca = d.events.find((e) => e.kind === 'counterattack')!;
    expect(ca.causes).toHaveLength(0);
    expect(ca.text).toContain('решения противника известны только посреднику');
    const r = turnEvents(base, t, H, history, 11, 23, { side: 'su', reveal: true });
    expect(r.events.find((e) => e.kind === 'counterattack')!.causes.map((c) => c.text)).toContain('Контрудар у Альт-Тухебанда');
  });

  it('de side events and fog', () => {
    const seen = (id: string) => id.startsWith('de_');
    const far = turnEvents(base, trace((id, h) => push8(id, h) ?? {}), H, history, 11, 23, { side: 'de', seen });
    expect(far.events.find((e) => e.kind === 'breakthrough')).toBeUndefined();
    // немецкие дивизии — у конечных мест 8 гв. А
    const near = trace((id, h) => push8(id, h) ?? (id.startsWith('de_') ? { at: off(HOME[`su_${id[3]}`], -10) } : {}));
    const d = turnEvents(base, near, H, history, 11, 23, { side: 'de', seen });
    const br = d.events.find((e) => e.kind === 'breakthrough')!;
    expect(br).toBeDefined();
    expect(br.seen).toBe(false);
    expect(br.title).toContain('противник');
    expect(br.divisions.every((x) => x.startsWith('de_'))).toBe(true);
    expect(br.from).toBeNull();
    expect(Math.abs(br.at[0] - off(HOME.su_a, -10)[0])).toBeLessThan(0.01);
    expect(Object.keys(d.hqs)).toEqual(['de_9a']);
    expect(d.side).toBe('de');
  });

  it('perspective of removed hq', () => {
    const removed = turnEvents(base, trace((id, h) => id.endsWith('_e') || id.endsWith('_f') ? (h >= 6 && id.startsWith('su_') ? { state: 'не введена в операцию' } : {}) : {}), H, history, 11, 23, { side: 'su' });
    expect(removed.hqs.su_1gta.state).toBe('removed');
    expect(removed.hqs.su_1gta.alive).toBe(0);
    expect(debriefFor(removed, 'su_1gta').verdict).toContain('войск в строю нет: штаб снят с операции');
    expect(removed.hqs.su_8gva.state).toBe('line');
    const dead = turnEvents(base, trace((id, h) => (id === 'su_e' || id === 'su_f') && h >= 6 ? { state: 'небоеспособна' } : {}), H, history, 11, 23, { side: 'su' });
    expect(dead.hqs.su_1gta.state).toBe('destroyed');
    expect(debriefFor(dead, 'su_1gta').verdict).toContain('войск в строю нет: штаб разгромлен');
  });

  it('perspective filter', () => {
    const far = turnEvents(base, trace((id, h) => push8(id, h) ?? {}), H, history, 11, 23, { side: 'su' });
    const br = far.events.find((e) => e.kind === 'breakthrough')!;
    expect(debriefFor(far, 'su_8gva').events).toContain(br);
    expect(debriefFor(far, 'su_33a').events).not.toContain(br);
    expect(debriefFor(far, null).events).toEqual(far.events);
    const near = turnEvents(base, trace((id, h) => push8(id, h) ?? (id === 'su_d' ? { at: off(br.at, 0, BAND_PAD_KM - 5) } : {})), H, history, 11, 23, { side: 'su' });
    expect(debriefFor(near, 'su_33a').events.map((e) => e.kind)).toContain('breakthrough');
  });

  it('verdict of hq: task, goal, history', () => {
    const t = trace((id, h) => push8(id, h) ?? {});
    t.documents = [{ tick: 3, time: '', hq: 'su_1bf', kind: 'directive', to: ['su_8gva'], text: 'Прорвать оборону на Зееловских высотах', rule: null }];
    const end = off(HOME.su_a, -8);
    const h: AgentHistory = { ...H, armies: [{ formation: 'su_8gva', time: '1945-04-17T03:00', at: off(end, -10), approxKm: 5 }] };
    const d = turnEvents(base, t, h, history, 11, 23, { side: 'su' });
    const hq = d.hqs.su_8gva;
    expect(hq.task?.text).toBe('Прорвать оборону на Зееловских высотах');
    expect(hq.goal?.title).toContain('Мюнхеберг');
    expect(hq.goal!.kmBefore! - hq.goal!.kmAfter!).toBeGreaterThan(5);
    expect(hq.histKm!).toBeCloseTo(10, 0);
    const v = debriefFor(d, 'su_8gva').verdict.join('\n');
    expect(v).toContain('Прорвать оборону');
    expect(v).toMatch(/за ход ближе на \d/);
    expect(v).toMatch(/от исторического положения — 1\d км/);
    expect(debriefFor(d, 'su_33a').verdict.join('\n')).toContain('исторического пути этого штаба в данных нет');
  });

  it('window from game trace', () => {
    const fr = (n: number) => Array.from({ length: n }, () => []);
    expect(debriefWindow({ frames: fr(61), game: { takeover: 54 } }, 12)).toEqual({ from: 54, to: 60 });
    expect(debriefWindow({ frames: fr(73), game: { takeover: 54 } }, 12)).toEqual({ from: 60, to: 72 });
    expect(debriefWindow({ frames: fr(30) }, 12)).toEqual({ from: 17, to: 29 });
  });
});
