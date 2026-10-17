import { describe, expect, it } from 'vitest';
import { places as simPlaces, Theatre, type Scenario, type TheatreData } from '@def-ops/sim';
import type { Place } from '../src/sim/game-protocol';
import { findPlace, findUnit, nearestPlace, offsetPoint, parseRelative, resolveRelative } from '../src/voice/places';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945-tasks.json';
import cityScenario from '../../../packages/sim/data/scenarios/berlin-city-1945.json';
import vistulaScenario from '../../../packages/sim/data/scenarios/vistula-oder-1945.json';

const T = new Theatre(theatreFile as unknown as TheatreData);
/** То же, что game-worker.ts кладёт в TurnView.places. */
const P: Place[] = simPlaces(T).map((p) => ({ id: p.id, title: p.title, at: p.at }));
const names = (s: unknown) => (s as Scenario).formations.map((f) => ({ id: f.id, name: f.name }));
const U = names(scenarioFile);

describe('места по названию', () => {
  const title = (q: string) => findPlace(q, P).place?.title;
  it('русские названия, падежи и «е/ее»', () => {
    expect(title('Зелов')).toBe('Зелов (Seelow)');
    expect(title('у Зелова')).toBe('Зелов (Seelow)');
    expect(title('Зеловские высоты')).toBe('Зееловские высоты');
    expect(title('Зееловские высоты')).toBe('Зееловские высоты');
    expect(title('на Зееловских высотах')).toBe('Зееловские высоты');
  });
  it('Кюстрин: русское и исходное написание, огрехи распознавания', () => {
    expect(title('Кюстрин')).toBe('Кюстрин (Kostrzyn)');
    expect(title('в Кюстрине')).toBe('Кюстрин (Kostrzyn)');
    expect(title('Kostrzyn')).toBe('Кюстрин (Kostrzyn)');
    expect(title('kostrzyn')).toBe('Кюстрин (Kostrzyn)');
    expect(title('Кюстрен')).toBe('Кюстрин (Kostrzyn)');
  });
  it('часть длинного названия: «Франкфурт» → Франкфурт-на-Одере', () => {
    expect(title('Франкфурт')).toBe('Франкфурт-на-Одере (Frankfurt)');
    expect(title('Франкфурт на Одере')).toBe('Франкфурт-на-Одере (Frankfurt)');
  });
  it('неоднозначность: нет place, 2–3 варианта', () => {
    const r = findPlace('Гросс', P);
    expect(r.place).toBeUndefined();
    expect(r.options.map((o) => o.title)).toEqual(['Гросс-Кёльциг (Gross Koelzig)', 'Гросс-Шаксдорф (Gross Schacksdorf)']);
    // точное название побеждает частичные совпадения: «Берлин» — сам город, а не «Берлин, Рейхстаг»
    expect(title('Берлин')).toBe('Берлин');
    expect(title('Берлин Рейхстаг')).toBe('Берлин, Рейхстаг (Reichstag)');
    expect(title('Губен')).toBe('Губен (Guben)');
  });
  it('обычное слово не даёт места', () => {
    for (const w of ['привет', 'обстановка', 'доложи', 'погода', 'наступать', 'карта', 'танковый', 'в', ''])
      expect(findPlace(w, P), w).toEqual({ options: [] });
  });
});

describe('«N километров <сторона> от …»', () => {
  it('разбор фразы', () => {
    expect(parseRelative('восемь километров северо-восточнее Зелова')).toEqual({ km: 8, dir: 'СВ', ref: 'зелова' });
    expect(parseRelative('в 5 км к западу от Кюстрина')).toEqual({ km: 5, dir: 'З', ref: 'кюстрина' });
    expect(parseRelative('в пяти километрах к юго-западу от Зеловских высот')).toEqual({ km: 5, dir: 'ЮЗ', ref: 'зеловских высот' });
    expect(parseRelative('двадцать километров южнее Франкфурта')).toEqual({ km: 20, dir: 'Ю', ref: 'франкфурта' });
    expect(parseRelative('10 км к СВ от Зелова')).toEqual({ km: 10, dir: 'СВ', ref: 'зелова' });
  });
  it('не похоже на такую фразу — null', () => {
    for (const t of ['Зелов', 'восьмая гвардейская', 'восемь километров', 'доложи обстановку', 'пять километров от Зелова']) expect(parseRelative(t), t).toBeNull();
  });
  it('nearestPlace: точка названного пункта — он сам', () => {
    const z = P.find((p) => p.id === 'Seelow')!;
    expect(nearestPlace(z.at, P).id).toBe('Seelow');
  });
  it('«восемь километров северо-восточнее Зелова» — пункт к северо-востоку от Зелова на расстоянии порядка восьми км', () => {
    const z = P.find((p) => p.id === 'Seelow')!;
    const r = resolveRelative('восемь километров северо-восточнее Зелова', P);
    expect(r.from?.id).toBe('Seelow');
    expect(r.place).toBeDefined();
    const target = offsetPoint(z.at, 8, 'СВ');
    expect(nearestPlace(target, P).id).toBe(r.place!.id);
    // найденный пункт ближе к расчётной точке, чем сам Зелов, и не далее двух шагов сетки
    const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110.574);
    expect(km(r.place!.at as [number, number], target as [number, number])).toBeLessThan(km(z.at as [number, number], target as [number, number]));
    const d = km(r.place!.at as [number, number], z.at as [number, number]);
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(16);
    expect(r.place!.at[0]).toBeGreaterThan(z.at[0]);
    expect(r.place!.at[1]).toBeGreaterThan(z.at[1]);
  });
  it('опорное место неясно — варианты; не та фраза — пусто', () => {
    const r = resolveRelative('пять километров севернее Гросса', P);
    expect(r.place).toBeUndefined();
    expect(r.options.length).toBeGreaterThanOrEqual(2);
    expect(resolveRelative('открой приказы', P)).toEqual({ options: [] });
  });
});

describe('соединения по названию', () => {
  const name = (q: string, us = U) => findUnit(q, us).unit?.name;
  it('порядковые словами и цифрами', () => {
    expect(name('восьмая гвардейская')).toBe('8-я гвардейская армия');
    expect(name('восьмая гвардейская армия')).toBe('8-я гвардейская армия');
    expect(name('8 гв. А')).toBe('8-я гвардейская армия');
    expect(name('8-я гвардейская')).toBe('8-я гвардейская армия');
    expect(name('восьмой гвардейской армии')).toBe('8-я гвардейская армия');
    expect(name('первый гвардейский танковый')).toBe('1-я гвардейская танковая армия');
    expect(name('первая гвардейская танковая армия')).toBe('1-я гвардейская танковая армия');
    expect(name('пятая ударная')).toBe('5-я ударная армия');
    expect(name('третья гвардейская')).toBe('3-я гвардейская армия');
    expect(name('третья гвардейская танковая')).toBe('3-я гвардейская танковая армия');
  });
  it('корпуса и дивизии: цифры, сокращения, составные числа', () => {
    const V = names(vistulaScenario);
    expect(name('двадцать девятый гвардейский стрелковый корпус', V)).toBe('29-й гвардейский стрелковый корпус (8 гв. А)');
    expect(name('29-й ск', V)).toBe('29-й гвардейский стрелковый корпус (8 гв. А)');
    expect(name('двадцать девятый корпус', names(cityScenario))).toBe('29-й гвардейский стрелковый корпус');
    expect(name('двести девяносто первая дивизия', V)).toBe('291-я пехотная дивизия');
    expect(name('пятая егерская')).toBe('5-я егерская дивизия');
  });
  it('римские номера и имена собственные', () => {
    expect(name('пятьдесят шестой танковый корпус')).toBe('LVI танковый корпус');
    expect(name('сорок шестой танковый корпус')).toBe('XXXXVI танковый корпус');
    expect(name('Нордланд')).toBe('11-я добровольческая танко-гренадерская дивизия СС «Нордланд»');
    expect(name('первый белорусский фронт')).toBe('1-й Белорусский фронт');
  });
  it('синтетические сокращённые имена', () => {
    const S = [{ id: 'a', name: '8 гв. А' }, { id: 'b', name: '29-й ск' }, { id: 'c', name: '1 гв. ТА' }];
    expect(name('восьмая гвардейская', S)).toBe('8 гв. А');
    expect(name('29-й стрелковый корпус', S)).toBe('29-й ск');
    expect(name('первая гвардейская танковая', S)).toBe('1 гв. ТА');
  });
  it('неоднозначность → варианты; обычные слова → пусто', () => {
    const r = findUnit('гвардейская армия', U);
    expect(r.unit).toBeUndefined();
    expect(r.options.length).toBeGreaterThanOrEqual(2);
    expect(r.options.length).toBeLessThanOrEqual(3);
    for (const w of ['доложи обстановку', 'погода', 'армия', 'танковый', '']) expect(findUnit(w, U), w).toEqual({ options: [] });
    expect(findUnit('сто пятая гвардейская', U)).toEqual({ options: [] });
  });
});
