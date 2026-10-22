import { describe, expect, it } from 'vitest';
import { FIELDS, issuers, missing, postTitle, recipients, sender, toDirective, type DirDraft } from '../src/command-post';

const hq = (id: string, name: string, echelon: string, parent: string | null, control = 'agent') => [id, { control, led: false, name, echelon, parent }] as const;
const v = (taken: string[] = []) => ({
  start: '1945-04-16T05:00', time: '1945-04-17T05:00',
  own: [
    { id: 'su_d1', name: '35 гв. сд', echelon: 'division', parent: 'su_4gsk', status: 'active' },
    { id: 'su_d2', name: '79 гв. сд', echelon: 'division', parent: 'su_4gsk', status: 'active' },
    { id: 'su_d9', name: '1 тбр', echelon: 'division', parent: 'su_8gva', status: 'active' },
    { id: 'su_dx', name: 'выбыла', echelon: 'division', parent: 'su_4gsk', status: 'destroyed' },
  ],
  command: { mode: 'agents', led: [], requests: [], historical: [], documents: [], hqs: Object.fromEntries([
    hq('su_stavka', 'Ставка ВГК', 'high_command', null, 'player'),
    hq('su_1bf', '1-й Белорусский фронт', 'front', 'su_stavka'),
    hq('su_8gva', '8-я гв. армия', 'army', 'su_1bf'),
    hq('su_1gta', '1-я гв. танковая армия', 'army', 'su_1bf'),
    hq('su_4gsk', '4-й гв. ск', 'corps', 'su_8gva'),
    hq('su_29gsk', '29-й гв. ск', 'corps', 'su_8gva'),
  ].map(([id, h]) => [id, taken.includes(id) ? { ...h, control: 'player' } : h])) },
}) as never;

describe('пункт управления по уровням', () => {
  it('Ставка: отдаёт верхняя инстанция, получатели — фронты', () => {
    expect(issuers(v(), 'stavka').map((x) => x.id)).toEqual(['su_stavka']);
    expect(recipients(v(), 'su_stavka').map((x) => x.id)).toEqual(['su_1bf']);
    expect(sender(v(), 'su_stavka')).toEqual({ from: undefined, overHead: false });
  });
  it('Армия: штабы армий, получатели — корпуса и дивизии прямо под армией; выбывшие — нет', () => {
    expect(issuers(v(), 'army').map((x) => x.id)).toEqual(['su_8gva', 'su_1gta']);
    expect(recipients(v(), 'su_8gva').map((x) => x.id)).toEqual(['su_4gsk', 'su_29gsk', 'su_d9']);
    expect(recipients(v(), 'su_4gsk').map((x) => x.id)).toEqual(['su_d1', 'su_d2']);
  });
  it('взятый штаб отдаёт сам; не взятый — Ставка через голову', () => {
    expect(sender(v(['su_8gva']), 'su_8gva')).toEqual({ from: 'su_8gva', overHead: false });
    expect(sender(v(), 'su_8gva')).toEqual({ from: undefined, overHead: true });
    expect(postTitle(v(['su_8gva']), 'su_8gva')).toBe('Штаб: 8-я гв. армия — взят под управление');
    expect(postTitle(v(), 'su_8gva')).toBe('Штаб: 8-я гв. армия — ведёт агент; приказ его подчинённым — от Ставки через голову (ПУ-39 ст. 93)');
  });
  it('поля формы по ступени получателя', () => {
    expect(FIELDS.stavka.map((f) => f.key)).toEqual(['task', 'axis', 'mainBlow', 'immediate', 'subsequent', 'boundaries', 'junction', 'reserve', 'note']);
    expect(FIELDS.front.map((f) => f.key)).toEqual(['task', 'boundaries', 'immediate', 'subsequent', 'commit', 'note']);
    expect(FIELDS.army.map((f) => f.key)).toEqual(['task', 'boundaries', 'echelon', 'immediate', 'subsequent', 'note']);
    expect(FIELDS.corps.map((f) => f.key)).toEqual(['task', 'boundaries', 'immediate', 'subsequent', 'axis', 'note']);
    expect(FIELDS.division.map((f) => f.key)).toEqual(['task', 'immediate', 'note']);
    expect(FIELDS.front.find((f) => f.key === 'immediate')!.label).toBe('Участок прорыва (рубеж)');
  });
  it('директива для ядра: часы сроков от начала операции, границы, главный удар; наступать без рубежа и оси — не готово', () => {
    const d: DirDraft = { to: 'su_1bf', level: 'stavka', task: 'attack', form: 'order', axis: [[14.6, 52.6], [13.4, 52.5]],
      immediate: [[14.2, 52.7], [14.2, 52.4]], immediateBy: '1945-04-18T05:00', subsequent: [], boundaries: [[[14.6, 52.8], [13.4, 52.8]], []],
      mainBlow: ['su_8gva'], reserve: [], note: 'на Берлин' };
    expect(toDirective(d, v())).toEqual({ to: 'su_1bf', task: 'attack', form: 'order', axis: [[14.6, 52.6], [13.4, 52.5]], immediate: [[14.2, 52.7], [14.2, 52.4]], immediateBy: 48,
      boundaries: [{ line: [[14.6, 52.8], [13.4, 52.8]] }], mainBlow: ['su_8gva'], note: 'на Берлин' });
    expect(toDirective({ ...d, to: 'su_4gsk', level: 'army' }, v(['su_8gva']), 'su_8gva').from).toBe('su_8gva');
    expect(missing(d)).toEqual([]);
    expect(missing({ ...d, axis: [], immediate: [] })).toEqual(['рубеж ближайшей задачи или ось']);
    expect(missing({ ...d, task: 'defend', axis: [], immediate: [] })).toEqual([]);
  });
});

describe('взятие в очереди хода', () => {
  it('«взять» в очереди — штаб отдаёт сам; «вернуть» после — снова через голову', () => {
    expect(sender(v(), 'su_8gva', [{ op: 'take', hq: 'su_8gva' }])).toEqual({ from: 'su_8gva', overHead: false });
    expect(sender(v(), 'su_8gva', [{ op: 'take', hq: 'su_8gva' }, { op: 'release', id: 'su_8gva' }]).overHead).toBe(true);
  });
});
