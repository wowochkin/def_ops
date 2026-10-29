import { describe, expect, it } from 'vitest';
import { controlMark, defaultEnemy, enemyOptions, findHq, fitEnemy, formTitle, initialCmds, markFor, MODE_TITLE, overHead, placeText, queueOp } from '../src/command-forms';

describe('формы приказа по ступеням', () => {
  it('советская сторона: директива, через голову — с пометкой; распоряжение — боевое распоряжение', () => {
    expect(formTitle('su', 'front', 'order')).toBe('директива Ставки');
    expect(formTitle('su', 'army', 'order')).toBe('директива Ставки — через голову (ПУ-39 ст. 93)');
    expect(formTitle('su', 'division', 'order')).toBe('директива Ставки — через голову (ПУ-39 ст. 93)');
    expect(formTitle('su', 'front', 'instruction')).toBe('боевое распоряжение Ставки');
    expect(formTitle('su', 'corps', 'instruction')).toBe('боевое распоряжение Ставки — через голову (ПУ-39 ст. 93)');
  });
  it('немецкая сторона: Weisung и Einzelbefehl с переводом', () => {
    expect(formTitle('de', 'front', 'order')).toBe('Weisung (директива ОКХ)');
    expect(formTitle('de', 'army', 'instruction')).toBe('Einzelbefehl (частный приказ ОКХ) — через голову');
  });
  it('через голову — получатель ниже фронта', () => {
    expect(overHead('front')).toBe(false);
    expect(['army', 'corps', 'division'].every(overHead)).toBe(true);
  });
  it('пометки управления', () => {
    expect(controlMark({ control: 'player', led: false })).toEqual({ text: 'взят под управление', cls: 'ctl-player' });
    expect(controlMark({ control: 'agent', led: true })).toEqual({ text: 'ведёт Ставка', cls: 'ctl-led' });
    expect(controlMark({ control: 'script', led: false })).toEqual({ text: 'по сценарию (гибрид)', cls: 'ctl-script' });
    expect(controlMark({ control: 'agent', led: false })).toBeNull();
    expect(controlMark(undefined)).toBeNull();
  });
  it('режимы игры названы', () => {
    expect(Object.keys(MODE_TITLE)).toEqual(['legacy', 'agents', 'commanders', 'hybrid', 'intent']);
    expect(MODE_TITLE.hybrid.title).toBe('Гибрид');
  });
});

describe('очередь команд управления на ход', () => {
  it('без повторов; взять и вернуть в одном ходе гасят друг друга; ответ на запрос — последний', () => {
    let q = queueOp([], { op: 'historical', id: 'a' });
    q = queueOp(q, { op: 'historical', id: 'a' });
    expect(q).toEqual([{ op: 'historical', id: 'a' }]);
    q = queueOp(q, { op: 'take', hq: 'su_8gva' });
    q = queueOp(q, { op: 'release', id: 'su_8gva' });
    expect(q).toEqual([{ op: 'historical', id: 'a' }]);
    q = queueOp(q, { op: 'permit', hq: 'de_101ak', yes: true });
    q = queueOp(q, { op: 'permit', hq: 'de_101ak', yes: false });
    expect(q).toEqual([{ op: 'historical', id: 'a' }, { op: 'permit', hq: 'de_101ak', yes: false }]);
  });
  it('штаб по названию или id', () => {
    const hqs = { su_8gva: { control: 'agent', led: false, name: '8-я гвардейская армия', echelon: 'army' }, su_4gsk: { control: 'agent', led: false, name: '4-й гвардейский стрелковый корпус', echelon: 'corps' } };
    expect(findHq(hqs, 'su_4gsk')).toBe('su_4gsk');
    expect(findHq(hqs, '8 гвардейскую армию')).toBe('su_8gva');
    expect(findHq(hqs, 'нет такого')).toBeNull();
  });
});

describe('очередь первого хода', () => {
  const view = (mode: string, turn: number) => ({ turn, command: { mode, hqs: {}, led: [], requests: [], documents: [], historical: [
    { id: 'a', time: '', to: '', toName: '', task: 'attack', form: 'order', note: '', issued: false, due: true },
    { id: 'b', time: '', to: '', toName: '', task: 'attack', form: 'order', note: '', issued: false, due: false },
    { id: 'c', time: '', to: '', toName: '', task: 'attack', form: 'order', note: '', issued: true, due: true }] } }) as never;
  it('агенты — наступившие, гибрид — все, после первого хода и «как сейчас» — ничего', () => {
    expect(initialCmds(view('agents', 1))).toEqual([{ op: 'historical', id: 'a' }]);
    expect(initialCmds(view('hybrid', 1))).toEqual([{ op: 'historical', id: 'a' }, { op: 'historical', id: 'b' }]);
    expect(initialCmds(view('agents', 2))).toEqual([]);
    expect(initialCmds(view('legacy', 1))).toEqual([]);
  });
  it('история как замысел — историю ведёт диспетчер: в очереди только директивы получателям под игроком', () => {
    expect(initialCmds(view('intent', 1))).toEqual([]);
    const v = view('intent', 1) as { command: { hqs: Record<string, unknown>; historical: { to: string }[] } };
    v.command.hqs = { su_1bf: { control: 'player', led: false, name: '', echelon: 'front', parent: 'su_stavka' }, su_8gva: { control: 'agent', led: false, name: '', echelon: 'army', parent: 'su_1bf' }, su_1uf: { control: 'script', led: false, name: '', echelon: 'front', parent: 'su_stavka' } };
    v.command.historical[0].to = 'su_8gva';
    v.command.historical[1].to = 'su_1uf';
    expect(initialCmds(v as never)).toEqual([{ op: 'historical', id: 'a' }]);
  });
});

describe('противник по режиму своей стороны', () => {
  it('в окне — только допустимые варианты', () => {
    expect(enemyOptions(false, 'intent')).toEqual(['llm', 'passive']);
    expect(enemyOptions(true, 'intent')).toEqual(['intent', 'llm']);
    expect(enemyOptions(true, 'commanders')).toEqual(['agents', 'llm']);
    expect(enemyOptions(true, 'legacy')).toEqual(['llm', 'passive', 'agents']);
    expect(enemyOptions(true, 'agents')).toEqual(['intent', 'llm', 'passive', 'agents']);
    expect(enemyOptions(true, 'hybrid')).toEqual(['intent', 'llm', 'passive', 'agents']);
  });
  it('умолчание — допустимое; при смене режима недопустимый выбор сменяется умолчанием', () => {
    expect(defaultEnemy(true, false, 'intent')).toBe('intent');
    expect(defaultEnemy(true, false, 'commanders')).toBe('agents');
    expect(defaultEnemy(true, false, 'legacy')).toBe('llm');
    expect(defaultEnemy(true, true, 'legacy')).toBe('passive');
    expect(fitEnemy('passive', true, 'intent', false)).toBe('intent');
    expect(fitEnemy('llm', true, 'intent', false)).toBe('llm');
    expect(fitEnemy('intent', true, 'legacy', false)).toBe('llm');
    expect(fitEnemy('intent', true, 'commanders', false)).toBe('agents');
    expect(fitEnemy('agents', true, 'agents', false)).toBe('agents');
  });
});

describe('пометка управления в докладах', () => {
  const v = (mode: string) => ({ command: { mode, hqs: { su_8gva: { control: 'script', led: false, name: '', echelon: 'army' } }, led: ['su_d1'], requests: [], historical: [], documents: [] } }) as never;
  it('«как сейчас» (и старые записи) — без пометок; гибрид — по сценарию; дивизия через голову — ведёт Ставка', () => {
    expect(markFor(v('legacy'), 'su_8gva')).toBeNull();
    expect(markFor(v('hybrid'), 'su_8gva')?.text).toBe('по сценарию (гибрид)');
    expect(markFor(v('agents'), 'su_d1')?.text).toBe('ведёт Ставка');
    expect(markFor({} as never, 'su_8gva')).toBeNull();
  });
});

describe('координаты в документах — пунктами', () => {
  const places = [{ id: 'p1', title: 'Зелов (Seelow)', at: [14.38, 52.6] as [number, number] }, { id: 'p2', title: 'Берлин', at: [13.4, 52.52] as [number, number] }];
  it('«широта, долгота» — ближайший пункт и расстояние до него', () => {
    expect(placeText('выдвигаться; ближайшая задача — рубеж у 52.60, 14.38', places)).toBe('выдвигаться; ближайшая задача — рубеж у Зелов (Seelow)');
    expect(placeText('рубеж у 52.60, 14.53', places)).toBe('рубеж у Зелов (Seelow), 10 км');
    expect(placeText('без координат', places)).toBe('без координат');
    expect(placeText('рубеж у 52.60, 14.38', [])).toBe('рубеж у 52.60, 14.38');
  });
});

describe('директива пункта управления в очереди', () => {
  it('новая директива тому же получателю заменяет прежнюю', () => {
    const d = (task: string) => ({ op: 'directive' as const, directive: { to: 'su_8gva', task, form: 'order' } });
    expect(queueOp(queueOp([], d('attack')), d('defend'))).toEqual([d('defend')]);
  });
});
