import { describe, expect, it } from 'vitest';
import { PETITION_COLOR, petitionAnswer, petitionMarks, petitionOp, petitionState, petitionText, type PetitionDraft } from '../src/petition';

const hq = (id: string, name: string, echelon: string, parent: string | null, control = 'agent') => [id, { control, led: false, name, echelon, parent }] as const;
const div = (id: string, parent: string, status = 'active') => ({ id, name: id, echelon: 'division', parent, status });
const v = (o: { mode?: string; control?: Record<string, string>; dead2bf?: boolean; terms?: Record<string, string> } = {}) => ({
  start: '1945-04-16T05:00', time: '1945-04-17T05:00',
  own: [div('su_d1', 'su_8gva'), div('su_d2', 'su_5ua'), div('su_d3', 'su_2bf_a', o.dead2bf ? 'destroyed' : 'active')],
  ...(o.terms ? { terms: o.terms } : {}),
  command: { mode: o.mode ?? 'intent', led: [], requests: [], historical: [], documents: [], petitions: [], hqs: Object.fromEntries([
    hq('su_stavka', 'Ставка ВГК', 'high_command', null, 'script'),
    hq('su_1bf', '1-й Белорусский фронт', 'front', 'su_stavka'),
    hq('su_1uf', '1-й Украинский фронт', 'front', 'su_stavka'),
    hq('su_2bf', '2-й Белорусский фронт', 'front', 'su_stavka'),
    hq('su_8gva', '8-я гв. армия', 'army', 'su_1bf'),
    hq('su_5ua', '5-я гв. армия', 'army', 'su_1uf'),
    hq('su_2bf_a', '65-я армия', 'army', 'su_2bf'),
  ].map(([id, h]) => [id, o.control?.[id] ? { ...h, control: o.control[id] } : h])) },
}) as never;
const opts = { stavkaLlm: true, llmOk: true, enemy: 'intent' as const, umpire: false };

describe('ходатайство о разграничительной линии', () => {
  it('скрыто: Ставку ведёт игрок', () => {
    const s = petitionState(v({ mode: 'agents', control: { su_stavka: 'player', su_1bf: 'player' } }), 'su_1bf', opts);
    expect(s.show).toBe(false);
    expect(s.why).toMatch(/^Ставку ведёте вы сами/);
  });
  it('скрыто: пункт — сама Ставка', () => {
    expect(petitionState(v(), 'su_stavka', opts).why).toMatch(/^Ставку ведёте вы сами/);
  });
  it('история как замысел: взятый фронт подаёт, рассматривает правило', () => {
    const s = petitionState(v({ control: { su_1bf: 'player' } }), 'su_1bf', opts);
    expect(s).toMatchObject({ show: true, who: 'rules' });
    expect(s.why).toMatch(/^Рассматривает Ставка на этом ходу по правилу/);
    expect(s.neighbours.map((n) => n.id)).toEqual(['su_1uf', 'su_2bf']);
  });
  it('скрыто: фронт не взят', () => {
    const s = petitionState(v(), 'su_1bf', opts);
    expect(s.show).toBe(false);
    expect(s.why).toContain('1-й Белорусский фронт ведёт история или агент');
  });
  it('скрыто: пункт армии', () => {
    const s = petitionState(v({ control: { su_8gva: 'player' } }), 'su_8gva', opts);
    expect(s.show).toBe(false);
    expect(s.why).toContain('подаёт командующий фронтом');
  });
  it('скрыто: нынешняя модель без модели-Ставки', () => {
    const now = { time: '1945-04-17T05:00', own: [] } as never;
    const off = petitionState(now, null, { ...opts, llmOk: false, enemy: 'llm' });
    expect(off.show).toBe(false);
    expect(off.why).toContain('подать некому');
    expect(petitionState(now, null, { ...opts, enemy: 'passive' }).show).toBe(false);
    expect(petitionState(now, null, { ...opts, stavkaLlm: false, enemy: 'llm' }).show).toBe(false);
    expect(petitionState(now, null, { ...opts, llmOk: true, enemy: 'llm', stavkaLlm: true })).toMatchObject({ show: true, who: 'llm' });
    expect(petitionState(now, null, { ...opts, enemy: 'passive', umpire: true })).toMatchObject({ show: true, who: 'llm' });
  });
  it('скрыто: агентная модель «Как сейчас» (без командования по ступеням)', () => {
    const s = petitionState(v({ mode: 'legacy', control: { su_1bf: 'player' } }), 'su_1bf', opts);
    expect(s.show).toBe(false);
    expect(s.why).toContain('нет командования по ступеням');
  });
  it('нынешняя модель: соседи — объединения верхнего уровня стороны', () => {
    const now = { time: '1945-04-17T05:00', own: [], groups: [{ id: 'su_1bf', name: '1-й Белорусский фронт' }, { id: 'su_1uf', name: '1-й Украинский фронт' }] } as never;
    expect(petitionState(now, null, { ...opts, enemy: 'llm' }).neighbours.map((n) => n.id)).toEqual(['su_1bf', 'su_1uf']);
  });
  it('соседи — только фронты той же Ставки с войсками', () => {
    const s = petitionState(v({ control: { su_1bf: 'player' }, dead2bf: true }), 'su_1bf', opts);
    expect(s.neighbours).toEqual([{ id: 'su_1uf', name: '1-й Украинский фронт' }]);
  });
  it('немецкая сторона — ОКХ', () => {
    const terms = { top: 'ОКХ', topGen: 'ОКХ', topTo: 'в ОКХ', group: 'группа армий', groupsGen: 'групп армий', directive: 'приказ' };
    const s = petitionState(v({ mode: 'agents', control: { su_stavka: 'player', su_1bf: 'player' }, terms }), 'su_1bf', opts);
    expect(s.why).toMatch(/^ОКХ ведёте вы сами/);
    expect(s.why).not.toMatch(/Ставк|фронт/);
    const r = petitionState(v({ control: { su_1bf: 'player' }, terms }), 'su_1bf', opts);
    expect(r.why).toMatch(/^Рассматривает ОКХ на этом ходу/);
    expect(r.why).not.toMatch(/Ставк|фронт/);
    expect(petitionState(v({ control: { su_8gva: 'player' }, terms }), 'su_8gva', opts).why).toContain('подаёт командующий группой армий');
  });
  it('petitionOp: без соседа или из одной точки — нет; из двух — команда ядру', () => {
    const p: PetitionDraft = { neighbour: 'su_1uf', line: [[14.5, 52.3]], note: 'войска соседа в нашей полосе' };
    expect(petitionOp('su_1bf', p)).toBeNull();
    expect(petitionOp('su_1bf', undefined)).toBeNull();
    expect(petitionOp('su_1bf', { ...p, neighbour: '', line: [[14.5, 52.3], [13.9, 52.2]] })).toBeNull();
    const line: [number, number][] = [[14.5, 52.3], [13.9, 52.2]];
    expect(petitionOp('su_1bf', { ...p, line })).toEqual({ op: 'petition', from: 'su_1bf', neighbour: 'su_1uf', line, note: 'войска соседа в нашей полосе' });
  });
  it('petitionText: сосед и пункты у точек линии', () => {
    const places = [{ id: 'a', title: 'Котбус', at: [14.33, 51.76] }, { id: 'b', title: 'Луккау', at: [13.71, 51.86] }] as never;
    const p: PetitionDraft = { neighbour: 'su_1uf', line: [[14.3, 51.75], [14.34, 51.77], [13.7, 51.85]], note: 'Его войска вышли в нашу полосу.' };
    expect(petitionText(p, (id) => (id === 'su_1uf' ? '1-й Украинский фронт' : id), places))
      .toBe('Прошу установить разграничительную линию с 1-й Украинский фронт через Котбус — Луккау. Его войска вышли в нашу полосу.');
    expect(petitionText({ ...p, note: '' }, () => 'сосед', places)).toBe('Прошу установить разграничительную линию с сосед через Котбус — Луккау.');
  });
  it('petitionAnswer: последний ответ по времени', () => {
    const w = v({ control: { su_1bf: 'player' } }) as unknown as { command: { petitions: unknown[] } };
    w.command.petitions = [
      { from: 'su_1bf', neighbour: 'su_1uf', neighbourName: '1-й Украинский фронт', time: '18.04 05:00', accepted: true, why: 'полоса соседа — 80 % прежней' },
      { from: 'su_1bf', neighbour: 'su_1uf', neighbourName: '1-й Украинский фронт', time: '17.04 05:00', accepted: false, why: 'отнимает главный удар' },
      { from: 'su_1uf', neighbour: 'su_1bf', neighbourName: '1-й Белорусский фронт', time: '19.04 05:00', accepted: false, why: 'чужое' },
    ];
    expect(petitionAnswer(w as never, 'su_1bf')).toEqual({ time: '18.04 05:00', accepted: true, text: 'линия принята — полоса соседа — 80 % прежней' });
    w.command.petitions.splice(0, 1);
    expect(petitionAnswer(w as never, 'su_1bf')).toEqual({ time: '17.04 05:00', accepted: false, text: 'отнимает главный удар' });
    expect(petitionAnswer(w as never, 'su_2bf')).toBeNull();
  });
});

describe('ходатайство на карте', () => {
  const draft: PetitionDraft = { neighbour: 'su_1uf', line: [[14.4, 52.3], [14.5, 52.2], [14.6, 52.1]], note: '' };
  it('линия — своим цветом и пунктиром, не как разграничительная линия; подпись читаема', () => {
    const fs = petitionMarks(draft, '1-й Украинский фронт', '1945-04-17T05:00');
    const line = fs.find((f) => f.kind === 'line') as never as { style: { layers: { color: string; dash: number[] | null }[] }; name: string };
    expect(line.style.layers[0].color).toBe(PETITION_COLOR);
    expect(line.style.layers[0].dash).toEqual([7, 5]);
    expect(line.name).toBe('Ходатайство: линия с соседом (1-й Украинский фронт)');
    const lb = fs.find((f) => f.kind === 'label') as never as { text: string; at: number[]; style: { color: string; halo: { width: number } | null; size: number } };
    expect(lb.text).toBe('ходатайство: линия с соседом (1-й Украинский фронт)');
    expect(lb.style.color).toBe(PETITION_COLOR);
    expect(lb.style.halo?.width).toBeGreaterThan(1);
    expect(lb.style.size).toBeGreaterThanOrEqual(13);
    expect(lb.at[1]).toBeCloseTo(52.2 + 0.012);
  });
  it('одна точка — знак и подпись, без линии', () => {
    const fs = petitionMarks({ ...draft, line: [[14.4, 52.3]] }, '', '1945-04-17T05:00');
    expect(fs.map((f) => f.kind)).toEqual(['symbol', 'label']);
  });
  it('нет точек — ничего', () => expect(petitionMarks({ ...draft, line: [] }, 'x', 't')).toEqual([]));
});
