import { describe, expect, it } from 'vitest';
import { answer, cardSmith, comment, parseCard, within, type Ask, type CardContext } from '../src/expo/ai';
import { cardErrors } from '../src/expo/bank';

const ctx: CardContext = {
  front: 'su_1bf', frontName: '1-й Белорусский фронт', marshal: 'Жуков', n: 1, turnTitle: 'Зееловские высоты',
  situation: 'Оборона на высотах.', armies: ['su_1gta', 'su_8ga'], places: ['Wriezen', 'Seelow'], shownTitles: ['Обход высот с севера'],
};
const check = (c: Parameters<typeof cardErrors>[0]) => cardErrors(c, new Set(ctx.armies), new Set(ctx.places));
const good = JSON.stringify({
  title: 'Ночной удар на Зелов',
  lines: ['Пехота — ночью на высоты', 'Танки — во втором эшелоне', 'Риск: потери на склонах', 'Расчёт: высоты к утру'],
  orders: [{ army: 'su_8ga', kind: 'attack', place: 'Seelow' }],
});

describe('ИИ сеанса', () => {
  it('карточка ИИ проходит проверку формы, чужая армия и объект — нет', () => {
    expect(parseCard(`Вот вариант: ${good}`, ctx, 'x', check)?.orders[0].place).toBe('Seelow');
    expect(parseCard(good.replace('su_8ga', 'us_9a'), ctx, 'x', check)).toBeNull();
    expect(parseCard(good.replace('"Seelow"', '"Paris"'), ctx, 'x', check)).toBeNull();
    expect(parseCard('не JSON', ctx, 'x', check)).toBeNull();
    expect(parseCard(good.replace('Ночной удар на Зелов', 'Обход высот с севера'), ctx, 'x', check)).toBeNull();
  });

  it('срок: медленная работа даёт null и отменяется', async () => {
    let aborted = false;
    const r = await within(10, (s) => new Promise((res) => { s.addEventListener('abort', () => (aborted = true)); setTimeout(() => res(1), 100); }));
    expect(r).toBeNull();
    expect(aborted).toBe(true);
    expect(await within(50, async () => 2)).toBe(2);
  });

  it('карточки заранее: готовая берётся сразу, без модели — null', async () => {
    const ask: Ask = async () => good;
    const smith = cardSmith({ ask: () => ask, check, perCardMs: 1000, wait: 1000 });
    smith.prefetch('t1', ctx, 1);
    const c = await smith.take('t1');
    expect(c?.title).toBe('Ночной удар на Зелов');
    expect(await smith.take('t2')).toBeNull();
    const none = cardSmith({ ask: () => null, check, perCardMs: 1000, wait: 1000 });
    none.prefetch('t1', ctx, 2);
    expect(await none.take('t1')).toBeNull();
  });

  it('ответ: ИИ в срок, иначе готовый ответ', async () => {
    expect(await answer(async () => 'Высоты прикрывали путь.', 'почему высоты', '', 1000)).toEqual({ text: 'Высоты прикрывали путь.', source: 'now' });
    const slow: Ask = () => new Promise(() => {});
    expect((await answer(slow, 'Почему высоты так важны?', '', 10)).source).toBe('prepared');
    expect((await answer(null, 'Какая погода', '', 10)).text).toMatch(/нет готового ответа/);
  });

  it('комментарий без ИИ — заготовка с подстановкой', async () => {
    const c = await comment(null, 'own', '', { title: 'Обход', marshal: 'Жуков', date: '20 апреля' }, 10);
    expect(c?.source).toBe('prepared');
    expect(c?.text).toMatch(/Обход|Жуков/);
  });
});
