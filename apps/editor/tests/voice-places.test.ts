import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { places as simPlaces, Theatre, type Scenario, type TheatreData } from '@def-ops/sim';
import type { Place } from '../src/sim/game-protocol';
import { findPlace, findUnit, nearestPlace, offsetPoint, parseRelative, resolveRelative } from '../src/voice/places';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945-tasks.json';
import vistulaFile from '../../../packages/sim/data/theatres/vistula-oder-1945.json';
import cityFile from '../../../packages/sim/data/theatres/berlin-city-1945.json';
import cityScenario from '../../../packages/sim/data/scenarios/berlin-city-1945.json';
import vistulaScenario from '../../../packages/sim/data/scenarios/vistula-oder-1945.json';

const T = new Theatre(theatreFile as unknown as TheatreData);
/** То же, что game-worker.ts кладёт в TurnView.places. */
const P: Place[] = simPlaces(T).map((p) => ({ id: p.id, title: p.title, at: p.at }));
const placesOf = (f: unknown): Place[] => simPlaces(new Theatre(f as TheatreData)).map((p) => ({ id: p.id, title: p.title, at: p.at }));
const PV = placesOf(vistulaFile);
const PC = placesOf(cityFile);
const names = (s: unknown) => (s as Scenario).formations.map((f) => ({ id: f.id, name: f.name, side: f.side as string }));
const U = names(scenarioFile);
const name = (q: string, us: { id: string; name: string; side?: string }[] = U) => findUnit(q, us).unit?.name;

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
      expect(findPlace(w, P), w).toEqual({ options: [], labels: [] });
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
    expect(resolveRelative('открой приказы', P)).toEqual({ options: [], labels: [] });
  });
});

describe('раунд 1: точные совпадения, дубли, написания', () => {
  const id = (q: string, ps = P) => findPlace(q, ps).place?.id;
  it('точное слово побеждает однокоренное длинное (Люббен ↔ Люббенау)', () => {
    expect(id('Люббен')).toBe('Luebben');
    expect(id('Люббенау')).toBe('Luebbenau');
    expect(id('в Люббене')).toBe('Luebben');
  });
  it('«Берлин, X» и «X» — один пункт: переспроса нет', () => {
    expect(id('Britz', PC)).toBe('Britz');
    expect(id('Reichskanzlei', PC)).toBe('Reichskanzlei');
    expect(id('Берлин Рейхсканцелярия', PC)).toBeDefined();
    expect(findPlace('Siemensstadt', PC).options).toEqual([]);
  });
  it('подписи вариантов различимы', () => {
    const r = findPlace('Гросс', P);
    expect(new Set(r.labels).size).toBe(r.options.length);
  });
  it('буквы секторов', () => {
    expect(findPlace('сектор обороны А', PC).place?.title).toBe('Сектор обороны «A»');
    expect(findPlace('сектор обороны бэ', PC).place?.title).toBe('Сектор обороны «B»');
    expect(findPlace('сектор обороны зет', PC).place?.title).toBe('Сектор обороны «Z»');
    expect(findPlace('сектор обороны цэ', PC).place?.title).toBe('Сектор обороны «C»');
  });
  it('разные написания: двойные согласные, е/и, синонимы', () => {
    expect(id('Коттбус')).toBe('Cottbus');
    expect(id('Леччин')).toBe('Letschin');
    expect(id('Зеелов')).toBe('Seelow');
    expect(id('Зелоу')).toBe('Seelow');
    expect(id('Губин')).toBe('Gubin');
    expect(id('Губен')).toBe('Guben');
    expect(id('Щецин')).toBe('Szczecin');
    expect(id('Вроцлав', PV)).toBe('Wroclaw');
    expect(id('Бреслау', PV)).toBe('Wroclaw');
    expect(id('Пила', PV)).toBe('Pila');
    expect(id('Бромберг', PV)).toBe('Bydgoszcz');
    expect(id('Гожув', PV)).toBe('Gorzow');
    expect(findPlace('танковый', P)).toEqual({ options: [], labels: [] });
  });
  it('parseRelative: дроби и «полтора»', () => {
    expect(parseRelative('1,5 км севернее Зелова')).toEqual({ km: 1.5, dir: 'С', ref: 'зелова' });
    expect(parseRelative('полтора километра к западу от Зелова')).toEqual({ km: 1.5, dir: 'З', ref: 'зелова' });
    expect(parseRelative('два с половиной километра южнее Зелова')).toEqual({ km: 2.5, dir: 'Ю', ref: 'зелова' });
  });
  const V = names(vistulaScenario);
  const C = names(cityScenario);
  it('номер без типа при нескольких армиях — переспрос', () => {
    for (const q of ['третья', 'третья гвардейская', '3-я']) {
      const r = findUnit(q, U);
      expect(r.unit, q).toBeUndefined();
      expect(r.options.length, q).toBeGreaterThanOrEqual(2);
      expect(r.options.length, q).toBeLessThanOrEqual(3);
    }
    expect(findUnit('третья гвардейская', U).options.map((u) => u.name)).toEqual(expect.arrayContaining(['3-я гвардейская армия', '3-я гвардейская танковая армия']));
    expect(name('третья гвардейская армия')).toBe('3-я гвардейская армия');
    expect(name('третья армия')).toBe('3-я армия');
    const S = [{ id: 'a', name: '8-я армия' }, { id: 'b', name: '8-я гвардейская армия' }];
    expect(findUnit('восьмая', S).unit).toBeUndefined();
    expect(findUnit('восьмая', S).options).toHaveLength(2);
    expect(name('восьмая гвардейская', S)).toBe('8-я гвардейская армия');
    expect(name('восьмая гвардейская')).toBe('8-я гвардейская армия');
  });
  it('сторона: одно имя у обеих сторон', () => {
    const q = 'четвёртая танковая армия';
    const both = findUnit(q, V);
    expect(both.unit).toBeUndefined();
    expect(both.options).toHaveLength(2);
    expect(new Set(both.labels).size).toBe(2);
    expect(both.labels.join(' ')).toMatch(/СССР|сов|Красн/i);
    expect(findUnit(q, V, { side: 'de' }).unit?.side).toBe('de');
    expect(findUnit(q, V, { side: 'su' }).unit?.side).toBe('su');
  });
  it('названия в скобках: позывные групп', () => {
    expect(name('армия Венка')).toBe('12-я армия («армия Венка»)');
    expect(name('группа Неринга', V)).toBe('XXIV танковый корпус (группа Неринга)');
    expect(name('группа Заукена', V)).toBe('Танковый корпус «Великая Германия» (группа Заукена)');
    expect(name('Герман Геринг', V)).toMatch(/Группа у Гурау/);
    expect(name('восьмая гвардейская', V)).toBe('8-я гвардейская армия');
  });
  it('буквы секторов и групп армий', () => {
    expect(name('сектор А', C)).toBe('Гарнизон сектора обороны «A»');
    expect(name('сектор зет', C)).toBe('Гарнизон сектора обороны «Z»');
    expect(name('гарнизон сектора эф', C)).toBe('Гарнизон сектора обороны «F»');
    expect(name('группа армий А', V)).toMatch(/^Группа армий «А»/);
  });
});

/** Слова описания, дающие место не по названию пункта, а по близкому написанию — известные и допустимые. */
const KNOWN_NEAR: Record<string, string> = {
  ангермюнде: 'в данных нет Ангермюнде, близкое по написанию — Тангермюнде',
  зеелова: 'другое написание «Зелов»',
  коттбуса: 'другое написание «Котбус»',
  губин: 'польское название «Губен (восточная часть)»',
  бромберг: 'немецкое название Быдгощи (place-aliases.json)',
  глейвиц: 'другое написание «Гляйвиц»',
};
describe('обычные слова не дают мест', () => {
  it('ни одно слово docs/system.md не даёт место, если оно не похоже на слово его названия', () => {
    const text = readFileSync(new URL('../../../docs/system.md', import.meta.url), 'utf8').toLowerCase().replace(/ё/g, 'е');
    const words = [...new Set(text.match(/[а-я]{4,}/g) ?? [])];
    const wrong: string[] = [];
    for (const ps of [P, PV, PC]) for (const w of words) {
      const r = findPlace(w, ps);
      const hit = [...(r.place ? [r.place] : []), ...r.options];
      if (!hit.length || w in KNOWN_NEAR) continue;
      // законно, если начало слова совпадает с началом слова в названии (падежи, написание) — иначе это ложное место
      const ok = hit.every((h) => h.title.toLowerCase().replace(/ё/g, 'е').split(/[^а-я]+/).some((t) => t.length >= 4 && w.slice(0, 4) === t.slice(0, 4)));
      if (!ok) wrong.push(`${w} → ${hit.map((h) => h.title).join(' | ')}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);
  it('слова из рецензии: ни места, ни чужого пункта', () => {
    for (const w of ['временные', 'введённые', 'луга', 'лишний', 'вектора', 'зелёный', 'зелёная', 'лесенкой', 'радио', 'ради', 'дало', 'далее', 'озёра', 'новый', 'старый', 'часть', 'мост', 'район', 'высоты', 'плацдарм'])
      for (const ps of [P, PV, PC]) expect(findPlace(w, ps), w).toEqual({ options: [], labels: [] });
  });
  it('«хеннигсдорф» — Хеннигсдорф; где его нет, не Хеллерсдорф', () => {
    expect(findPlace('хеннигсдорф', P).place?.title).toMatch(/^Хеннигсдорф/);
    const r = findPlace('хеннигсдорф', PC);
    expect([...(r.place ? [r.place] : []), ...r.options].map((x) => x.title).join(' ')).not.toMatch(/Хеллерсдорф/);
  });
  it('«сектор А» / «сектор Z» для мест — короткая форма', () => {
    expect(findPlace('сектор А', PC).place?.title).toBe('Сектор обороны «A»');
    expect(findPlace('сектор зет', PC).place?.title).toBe('Сектор обороны «Z»');
  });
  it('«берлин» среди соединений — варианты, а не молча дивизия «Берлин»', () => {
    const r = findUnit('берлин', U);
    expect(r.unit).toBeUndefined();
    expect(r.options.length).toBeGreaterThanOrEqual(2);
    expect(r.options.map((u) => u.name).join(' ')).toMatch(/309-я пехотная дивизия «Берлин»/);
  });
});

describe('обычные слова не дают соединений', () => {
  /** Слова, которые законно дают соединение не по началу слова его названия. */
  const KNOWN_UNIT: Record<string, string> = {};
  it('ни одно слово docs/system.md не даёт unit, если не похоже на слово названия', () => {
    const text = readFileSync(new URL('../../../docs/system.md', import.meta.url), 'utf8').toLowerCase().replace(/ё/g, 'е');
    const words = [...new Set(text.match(/[а-я]{4,}/g) ?? [])];
    const wrong: string[] = [];
    for (const sc of [scenarioFile, vistulaScenario, cityScenario]) {
      const us = names(sc);
      for (const w of words) {
        const u = findUnit(w, us).unit;
        // порядковые («восьмая», «первый») законно называют армию по номеру
        if (!u || w in KNOWN_UNIT || /^(?:перв|втор|трет|четверт|пят|шест|седьм|восьм|девят|десят)/.test(w)) continue;
        const ok = u.name.toLowerCase().replace(/ё/g, 'е').split(/[^а-я]+/).some((x) => x.length >= 4 && x.slice(0, 4) === w.slice(0, 4));
        if (!ok) wrong.push(`${w} → ${u.name}`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  }, 120_000);
  it('слова приказов не дают соединение по описательным скобкам', () => {
    const V = names(vistulaScenario);
    for (const w of ['часть', 'части', 'командование', 'командовать', 'штурм', 'штурмовая', 'вермахт', 'гарнизон'])
      for (const us of [U, V, names(cityScenario)]) expect(findUnit(w, us).unit, w).toBeUndefined();
    expect(findUnit('штурмовая', V).unit).toBeUndefined();
  });
  it('составные скобки: «Герман Геринг» двумя словами, номер «603 пд»', () => {
    const V = names(vistulaScenario);
    expect(name('герман геринг', V)).toMatch(/Группа у Гурау/);
    expect(name('шестьсот третья пехотная дивизия', V)).toMatch(/Группа у Гурау/);
    expect(name('восьмая гвардейская', V)).toBe('8-я гвардейская армия');
  });
});

describe('самопроверка на всех данных', () => {
  it('каждый пункт трёх театров не находится как чужой по своему русскому и исходному названию', () => {
    const wrong: string[] = [];
    for (const ps of [P, PV, PC]) for (const p of ps) {
      const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(p.title);
      for (const q of m ? [m[1], m[2]] : [p.title]) {
        const r = findPlace(q, ps);
        const near = [...(r.place ? [r.place] : []), ...r.options];
        if (r.place ? r.place.id !== p.id && !(r.place.title.replace(/^Берлин, /, '') === p.title.replace(/^Берлин, /, '')) : !near.some((o) => o.id === p.id)) wrong.push(`${q} → ${near.map((o) => o.title).join(' | ')}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);
  it('каждое соединение находит себя или попадает в варианты', () => {
    const wrong: string[] = [];
    for (const sc of [scenarioFile, vistulaScenario, cityScenario]) {
      const us = names(sc);
      for (const u of us) {
        const r = findUnit(u.name, us);
        if (!(r.unit?.id === u.id || r.options.some((o) => o.id === u.id))) wrong.push(`${u.name} → ${r.unit?.name ?? r.options.map((o) => o.name).join(' | ')}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('соединения по названию', () => {
  it('порядковые словами и цифрами', () => {
    expect(name('восьмая гвардейская')).toBe('8-я гвардейская армия');
    expect(name('восьмая гвардейская армия')).toBe('8-я гвардейская армия');
    expect(name('8 гв. А')).toBe('8-я гвардейская армия');
    expect(name('8-я гвардейская')).toBe('8-я гвардейская армия');
    expect(name('восьмой гвардейской армии')).toBe('8-я гвардейская армия');
    expect(name('первый гвардейский танковый')).toBe('1-я гвардейская танковая армия');
    expect(name('первая гвардейская танковая армия')).toBe('1-я гвардейская танковая армия');
    expect(name('пятая ударная')).toBe('5-я ударная армия');
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
    for (const w of ['доложи обстановку', 'погода', 'армия', 'танковый', '']) expect(findUnit(w, U), w).toEqual({ options: [], labels: [] });
    expect(findUnit('сто пятая гвардейская', U)).toEqual({ options: [], labels: [] });
  });
});
