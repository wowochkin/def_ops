/**
 * Ввод в обстановку стенда — доклад начальника штаба по пунктам: `npm run expo:briefing` →
 * apps/editor/src/expo/bank-data/berlin-1945.briefing.json. Пункты: задача по директиве Ставки, свои силы, противник
 * и его полосы обороны, местность, соседи и разграничение, соотношение сил. Цифры — из базы знаний (каждая проверяется:
 * число должно стоять в факте записи с этим источником) или посчитаны по сценарию модели; рубежи, разграничительные
 * линии и пункты — из театра и директив сценария. Фраза голоса пункта — в lines.json (`brief-<фронт>-<номер>`);
 * проверка (`expo-briefing.test.ts`) сверяет пункты с фразами и источниками.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANK } from '../apps/editor/src/expo/bank';
import type { Briefing, BriefFact, BriefPoint } from '../apps/editor/src/expo/briefing';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
type LL = [number, number];
const theatre = read('packages/sim/data/theatres/oder-berlin-1945.json') as { lines: { id: string; line: LL[] }[]; areas: { id: string; ring: LL[] }[] };
const scenario = read(BANK.scenario) as {
  hqs: { id: string; echelon: string; parent: string | null }[];
  divisions: { hq: string; personnel?: number; tanks?: number; guns?: number }[];
  directives: { id: string; boundaries?: { with: string; line: LL[] }[] }[];
};
const kb = read('packages/knowledge/data/seed.json') as { entries: { id: string; facts: { value: string; source?: string | null }[] }[] };
/** Источник на экране — коротко (полное описание — в базе знаний под тем же ключом). */
const SHORT: Record<string, string> = {
  'src:OOB': 'Кривошеев; Боевой состав Советской армии',
  'src:KRIV2001': 'Кривошеев, «Россия и СССР в войнах XX века»',
  'src:DRZW': 'Лаковски, «Германия во Второй мировой войне», т. 10',
  'src:RA15': 'Русский архив, т. 15',
  'src:RA_15': 'Русский архив, т. 15',
  'src:Z': 'Зимке, «От Сталинграда до Берлина»',
  'src:RW_BNO': 'Википедия, «Берлинская операция»',
  'src:KONEV': 'Конев, «Записки командующего фронтом»',
};
const sources = new Map(kb.entries.filter((e) => e.id.startsWith('src:')).map((e) => [e.id, SHORT[e.id] ?? (e as unknown as { title: string }).title]));

/** Факт базы знаний: в записи `entry` есть факт источника `src` с числом `num` — иначе сборка падает. */
function fromKb(entry: string, src: string, num: string, value: string, label: string): BriefFact {
  const e = kb.entries.find((x) => x.id === entry);
  const digits = (s: string) => s.replace(/[\s\u00a0]/g, '');
  if (!e?.facts.some((f) => f.source === src && digits(f.value).includes(digits(num)))) throw new Error(`в базе знаний нет «${num}» (${entry}, ${src})`);
  return { value, label, source: sources.get(src) ?? src };
}

/** Сумма численности дивизий в подчинении штаба (по цепочке) — сценарий модели на 16 апреля. */
function strength(hq: string) {
  const up = new Map(scenario.hqs.map((h) => [h.id, h.parent]));
  const under = (h: string | null | undefined): boolean => (h === hq ? true : h ? under(up.get(h)) : false);
  const ds = scenario.divisions.filter((d) => under(d.hq));
  return { divisions: ds.length, personnel: ds.reduce((s, d) => s + (d.personnel ?? 0), 0), tanks: ds.reduce((s, d) => s + (d.tanks ?? 0), 0) };
}
const MODEL = 'сценарий модели, 16 апреля';
const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
const thousands = (n: number) => `${Math.round(n / 1000)} тыс.`;

const at = (id: string): LL => {
  const a = theatre.areas.find((x) => x.id === id);
  if (!a) throw new Error(`нет пункта ${id}`);
  const c = a.ring.reduce((s, p) => [s[0] + p[0] / a.ring.length, s[1] + p[1] / a.ring.length], [0, 0]);
  return [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000];
};
const line = (id: string): LL[] => {
  const l = theatre.lines.find((x) => x.id === id);
  if (!l) throw new Error(`нет рубежа ${id}`);
  return l.line;
};
const bound = (dir: string, withFront: string): LL[] => {
  const b = scenario.directives.find((x) => x.id === dir)?.boundaries?.find((x) => x.with === withFront);
  if (!b) throw new Error(`нет разграничительной линии ${dir}/${withFront}`);
  return b.line;
};

const KUESTRIN: LL = [14.64, 52.58];
const BERLIN = at('berlin');
const ELBE_1BF: LL = [11.97, 52.55];
const bf9 = strength('de_9a'), uf4 = strength('de_4pza'), bf = strength('su_1bf'), uf = strength('su_1uf');

const su1bf: BriefPoint[] = [
  {
    title: 'Задача фронта',
    lines: ['Директива Ставки № 11059 от 2 апреля 1945 года', 'Главный удар — с Кюстринского плацдарма на Берлин', 'Затем — на запад, к Эльбе'],
    facts: [
      { value: 'Берлин', label: 'овладеть столицей Германии', source: 'директива Ставки № 11059' },
      { value: '12–15', label: 'дней до выхода на Эльбу', source: 'директива Ставки № 11059' },
    ],
    map: { bbox: [11.9, 51.95, 15.1, 53.0], level: 'front', arrows: [{ points: [KUESTRIN, [14.0, 52.6], BERLIN], preset: 'atlas.p1' }, { points: [BERLIN, [12.7, 52.62], ELBE_1BF], preset: 'atlas.p2' }], labels: [{ text: 'Эльба', at: [12.05, 52.3], preset: 'atlas.water' }] },
  },
  {
    title: 'Свои силы',
    lines: ['Девять общевойсковых и две танковые армии', 'На плацдарме — 47-я, 3-я и 5-я ударные, 8-я гвардейская, 1-я и 2-я гвардейские танковые'],
    facts: [
      fromKb('op:berlin', 'src:KRIV2001', '908 500', '908 500', 'человек'),
      fromKb('f:su_1bf', 'src:OOB', '3 155', '3 155', 'танков и САУ'),
      fromKb('f:su_1bf', 'src:OOB', '16 934', '16 934', 'орудий и миномётов'),
    ],
    map: { bbox: [13.9, 52.05, 15.45, 53.05], level: 'front' },
  },
  {
    title: 'Противник',
    lines: ['9-я армия группы армий «Висла» (Буссе)', 'Главная полоса — по Одеру, за ней позиции «Харденберг» и «Штайн» на высотах, дальше — «Вотан»', 'Вокруг Берлина — три обвода'],
    facts: [
      fromKb('op:berlin', 'src:DRZW', '512', '512', 'танков и штурмовых орудий 9-й армии'),
      { value: thousands(bf9.personnel), label: `человек в 9-й армии (дивизий в модели: ${bf9.divisions})`, source: MODEL },
      { value: '3 + 3', label: 'позиции до Берлина и обвода вокруг него', source: 'театр модели' },
    ],
    map: { bbox: [13.2, 52.2, 14.85, 52.95], level: 'front', defense: [line('de_oder_hkl'), line('de_hardenberg'), line('de_stein'), line('de_wotan')] },
  },
  {
    title: 'Местность',
    lines: ['Одербрух — заболоченная пойма между Одером и Зееловскими высотами', 'Высоты господствуют над плацдармом', 'Немцы спустили воду из водохранилища — пойма стала болотом'],
    facts: [
      fromKb('battle:seelow', 'src:RA15', '315', '315 км²', 'Кюстринский плацдарм'),
      fromKb('op:berlin', 'src:DRZW', '12–15', '12–15 км', 'ширина Одербруха'),
      fromKb('battle:seelow', 'src:RA15', '1 282', '1 282', 'человека на квадратный километр плацдарма'),
    ],
    map: { bbox: [14.15, 52.42, 14.8, 52.72], level: 'corps', labels: [{ text: 'Зееловские высоты', at: [14.42, 52.49], preset: 'atlas.region' }, { text: 'Одербрух', at: [14.52, 52.7], preset: 'atlas.region' }, { text: 'Одер', at: [14.66, 52.47], preset: 'atlas.water' }] },
  },
  {
    title: 'Соседи и разграничение',
    lines: ['Справа — 2-й Белорусский фронт Рокоссовского: удар на Штеттин с 20 апреля', 'Слева — 1-й Украинский фронт Конева', 'Разграничительная линия доведена только до Люббена'],
    facts: [
      fromKb('bnd:1bf-1uf-15apr', 'src:RA_15', '11059', 'Люббен', 'здесь линия с 1-м Украинским обрывается'),
      fromKb('op:berlin', 'src:Z', '20 апреля 1945: 2 гв. ТА у Бернау', '20 апреля', '2-й Белорусский форсирует Одер'),
    ],
    map: { bbox: [12.9, 51.55, 15.6, 53.55], level: 'front', bounds: [bound('stavka-11059', 'su_1uf'), bound('stavka-11059', 'su_2bf')], labels: [{ text: 'Люббен', at: at('Luebben'), preset: 'atlas.town' }] },
  },
  {
    title: 'Соотношение сил',
    lines: ['Перевес — многократный, но оборона глубокая и заранее подготовлена', 'Решающее — темп: высоты нужно взять за сутки-двое'],
    facts: [
      { ...fromKb('f:de_9a', 'src:OOB', '112 143', '8 : 1', 'по людям: 908 500 против 112 143 в 9-й армии') },
      { value: '6 : 1', label: 'по танкам: 3 155 против 512', source: 'Кривошеев; Лаковски' },
      { value: `${(bf.personnel / bf9.personnel).toFixed(1).replace('.', ',')} : 1`, label: `в модели: ${thousands(bf.personnel)} против ${thousands(bf9.personnel)} в дивизиях`, source: MODEL },
    ],
    map: { bbox: [13.3, 52.15, 15.1, 52.95], level: 'front' },
  },
];

const FORST = at('Forst'), SPREMBERG = at('Spremberg'), BELZIG = at('Belzig');
const su1uf: BriefPoint[] = [
  {
    title: 'Задача фронта',
    lines: ['Директива Ставки № 11060 от 3 апреля 1945 года', 'Разгромить группировку противника у Котбуса и южнее Берлина', 'Главный удар — с Нейсе на Шпремберг и Бельциг, затем к Эльбе'],
    facts: [
      fromKb('op:berlin', 'src:RA15', '24 км', '24 км', 'участок главного удара Форст — Мускау'),
      { value: 'Котбус', label: 'разгромить группировку противника', source: 'директива Ставки № 11060' },
    ],
    map: { bbox: [12.3, 51.25, 15.25, 52.6], level: 'front', arrows: [{ points: [FORST, SPREMBERG, [13.6, 51.85], BELZIG], preset: 'atlas.p1' }], labels: [{ text: 'Эльба', at: [12.45, 51.75], preset: 'atlas.water' }] },
  },
  {
    title: 'Свои силы',
    lines: ['Главный удар — 3-я гвардейская, 13-я и 5-я гвардейская армии', 'В прорыв — 3-я и 4-я гвардейские танковые армии', 'Вспомогательный — 2-я армия Войска Польского и 52-я на Дрезден'],
    facts: [
      fromKb('op:berlin', 'src:KRIV2001', '550 900', '550 900', 'человек'),
      fromKb('f:su_1uf', 'src:OOB', '2 055', '2 055', 'танков и САУ'),
      fromKb('f:su_1uf', 'src:OOB', '13 571', '13 571', 'орудий и миномётов'),
    ],
    map: { bbox: [14.0, 51.15, 15.35, 52.0], level: 'front' },
  },
  {
    title: 'Противник',
    lines: ['4-я танковая армия группы армий «Центр» (Грезер)', 'Оборона по Нейсе — три полосы', 'Резервы — танковые дивизии у Котбуса и южнее'],
    facts: [
      fromKb('battle:neisse', 'src:DRZW', '20–40', '20–40 км', 'глубина трёх полос обороны'),
      fromKb('op:berlin', 'src:RA15', '540', '≈ 540', 'танков и САУ перед фронтом (советская оценка)'),
      { value: thousands(uf4.personnel), label: `человек в 4-й танковой армии (дивизий в модели: ${uf4.divisions})`, source: MODEL },
    ],
    map: { bbox: [13.95, 51.15, 15.3, 52.05], level: 'front', defense: [line('de_neisse')] },
  },
  {
    title: 'Местность',
    lines: ['Нейсе — водная преграда перед всем участком прорыва', 'За ней — Шпрее у Шпремберга и лесистая местность', 'Переправы — под дымовой завесой'],
    facts: [
      fromKb('op:berlin', 'src:RW_BNO', '133', '133', 'переправы через Нейсе 16 апреля'),
      fromKb('chr:berlin-1945-weather', 'src:KONEV', '390', '390 км', 'дымовая завеса по фронту'),
    ],
    map: { bbox: [14.15, 51.45, 14.95, 51.85], level: 'corps', labels: [{ text: 'Нейсе', at: [14.69, 51.62], preset: 'atlas.water' }, { text: 'Шпрее', at: [14.33, 51.65], preset: 'atlas.water' }] },
  },
  {
    title: 'Соседи и разграничение',
    lines: ['Справа — 1-й Белорусский фронт Жукова', 'Разграничительная линия доведена только до Люббена', 'Дальше путь на Берлин с юга не закрыт'],
    facts: [fromKb('bnd:1bf-1uf-15apr', 'src:RA_15', '11060', 'Люббен', 'здесь линия с 1-м Белорусским обрывается')],
    map: { bbox: [12.9, 51.3, 15.3, 52.7], level: 'front', bounds: [bound('stavka-11060', 'su_1bf')], labels: [{ text: 'Люббен', at: at('Luebben'), preset: 'atlas.town' }] },
  },
  {
    title: 'Соотношение сил',
    lines: ['Перевес — в несколько раз', 'Решающее — быстро форсировать Нейсе и ввести танковые армии в прорыв'],
    facts: [
      { value: '4 : 1', label: 'по танкам: 2 055 против ≈ 540', source: 'Кривошеев; Русский архив, т. 15' },
      { ...fromKb('op:berlin', 'src:RA15', '2 500', '5 : 1', 'по орудиям: 13 571 против ≈ 2 500'), source: 'Кривошеев; Русский архив, т. 15' },
      { value: `${(uf.personnel / uf4.personnel).toFixed(1).replace('.', ',')} : 1`, label: `в модели: ${thousands(uf.personnel)} против ${thousands(uf4.personnel)} в дивизиях`, source: MODEL },
    ],
    map: { bbox: [13.95, 51.15, 15.3, 52.05], level: 'front' },
  },
];

const data: Briefing = { su_1bf: su1bf, su_1uf: su1uf };
writeFileSync(join(ROOT, 'apps/editor/src/expo/bank-data/berlin-1945.briefing.json'), JSON.stringify(data, null, 1) + '\n');
console.log(`пунктов: 1 БФ ${su1bf.length}, 1 УФ ${su1uf.length}; модель: 1 БФ ${fmt(bf.personnel)}, 9 А ${fmt(bf9.personnel)}, 1 УФ ${fmt(uf.personnel)}, 4 ТА ${fmt(uf4.personnel)}`);
