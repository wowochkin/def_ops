/**
 * Положения дивизий и корпусов из выписок ЖБД ЦАМО (docs/sources/berlin-1945-tsamo/positions.json): в поле place
 * записей уровня армий текстом перечислены корпуса и дивизии с пунктами («77 ск — 260 сд Хайнрихсдорф, вост. окр.
 * Борегард; 125 ск — 60 и 175 сд взяли Ной-Левин, бой за Терингсвердер»). Инструмент разбирает эти фрагменты,
 * сопоставляет обозначения с реестром дивизий и геокодирует пункты: сначала по газеттирам репозитория
 * (docs/sources/berlin-1945-*.json, vistula-oder-1945*.json), затем через Nominatim (OSM) по немецкой транскрипции
 * русского названия. Результаты геокодирования кэшируются в docs/sources/berlin-1945-tsamo/gazetteer.json
 * (ключ — название как в документе; ненайденное тоже записывается с null, чтобы не запрашивать повторно;
 * найденное руками вносится туда же с source: "manual").
 *
 *   npm run sim:geocode-tsamo -- [--no-net] [--max-requests 600] [--retry] [--out docs/sources/berlin-1945-tsamo/division-positions.json]
 *
 * --no-net — без обращений к Nominatim (только газеттиры и кэш); --max-requests — предел запросов за прогон
 * (не чаще одного в секунду; очередь — сначала пункты 1 БФ, затем 1 УФ); --retry — повторить запросы по пунктам,
 * которые раньше не нашлись.
 *
 * Выход docs/sources/berlin-1945-tsamo/division-positions.json: { meta, positions: [...] }, запись — формирование
 * (id реестра или нормализованный id стрелкового/кавалерийского корпуса: su_77sk, su_7gkk), день, действие, пункты
 * с координатами, центр и радиус; если ни один пункт не найден — координаты армии (fallback: "army", reliability C).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPS_TYPES, makeResolver, parseTokens, type Registry, type Rel, type Token, type Unit } from './designations';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const noNet = args.includes('--no-net');
const retry = args.includes('--retry');
const maxRequests = Number(opt('max-requests', '600'));
const outPath = resolve(ROOT, opt('out', 'docs/sources/berlin-1945-tsamo/division-positions.json')!);
const cachePath = resolve(ROOT, opt('gazetteer', 'docs/sources/berlin-1945-tsamo/gazetteer.json')!);
const registryPath = resolve(ROOT, opt('registry', 'docs/sources/berlin-1945-divisions.json')!);
const positionsPath = resolve(ROOT, 'docs/sources/berlin-1945-tsamo/positions.json');

// ---------- область операции и расстояния ----------
const BOX = { west: 11.5, east: 16.0, south: 50.8, north: 54.3 };
const MAX_KM_FROM_ARMY = 40;
const inBox = (lng: number, lat: number) => lng >= BOX.west && lng <= BOX.east && lat >= BOX.south && lat <= BOX.north;
function distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- типы ----------
interface TsamoPos {
  army: string; date: string; time: string | null; kind: string; unit: string; place: string;
  lat: number; lon: number; approxKm: number | null; action?: string; source: string; url?: string; note?: string | null;
}
type Action = 'взяла' | 'бой за' | 'на рубеже' | 'сосредоточена' | 'второй эшелон' | 'форсирование' | 'марш' | 'оборона';
interface PlaceRef { name: string; approxKm: number; gramCase?: 'gen' | 'prep' }
interface Frag {
  rec: TsamoPos; units: Unit[]; echelon: 'division' | 'corps'; action: Action | null; places: PlaceRef[]; text: string;
  attachedTo?: Frag; parentCorps?: Frag;
}
interface CacheEntry {
  query: string | null; lng: number | null; lat: number | null; osm_display_name: string | null; variant: string | null;
  source: 'gazetteer' | 'nominatim' | 'manual' | null; reliability?: Rel; note?: string; tried?: string[];
}
interface OutPlace { name: string; lng: number | null; lat: number | null; approxKm: number; reliability?: Rel; source?: string }
interface OutPos {
  formation: string; abbr: string; echelon: 'division' | 'corps'; army: string; date: string; time: string | null; action: Action;
  places: OutPlace[]; lng: number; lat: number; approxKm: number; fallback?: 'army'; source: string; url?: string; note: string; reliability: Rel;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const reg = readJson<Registry>(registryPath);
const resolveUnit = makeResolver(reg);
const divById = new Map(reg.divisions.map((d) => [d.id, d]));
const recs = readJson<TsamoPos[]>(positionsPath);

// ---------- 1. разбор текста place ----------
const ACTIONS: [RegExp, Action][] = [
  [/второй эшелон|второго эшелона|резерв/i, 'второй эшелон'],
  [/форсиров|переправ/i, 'форсирование'],
  [/на марше|марш|выдвига|выступил|колонн|вводится|введ[её]н/i, 'марш'],
  [/сосредоточ|в районе|в лесах у|в лесу у/i, 'сосредоточена'],
  [/оборон|прежн(ий|ем|ее|их) (рубеж|положени)|прежнее/i, 'оборона'],
  [/бо[йи] (за|у|в|на) |ведут бо|вед[её]т бо|отража|контратак|бои\b|бой\b/i, 'бой за'],
  [/взял|овладел|очистил|ворвал|захват|заня[лт]/i, 'взяла'],
  [/рубеж|вышл[аи]|вышел|достигл/i, 'на рубеже'],
];
const actionOf = (text: string): Action | null => { for (const [re, a] of ACTIONS) if (re.test(text)) return a; return null; };

/** Названия, которые не пункты (реки, каналы, направления). */
const NOT_PLACE = /^(Одер|Одера|Альте Одер|Альте|Шпрее|Нейсе|Нейссе|Флисс|Эльба|Эльбы|Эльбе|Хавель|Гавель|Даме|Нуте|Бобер|Квейс|Эльстер|Шварце Эльстер|Лоссовер|Фридландерштром|Берлина|Одер-Шпрее|Гогенцоллерн|Тельтов-канал|Рейх)$/;
const NOT_PLACE_RE = /^(Одеру|Одере|Шпрею|Эльбу|Хавеле|Хафеле|Хафель)$|(ский|ского|ская|ской|ному|ного|ный|ная|ное|ных)$/;
const NAME = /[А-ЯЁ][а-яё]+(?:(?:-|\s)(?!и\s)[А-ЯЁ][а-яё]+)*/g;

/** Пункты из фрагмента: «вост. окр. Борегард, лес 1,5 км зап. Фридерсдорф, Дольгелин» → Борегард, Фридерсдорф, Дольгелин. */
function extractPlaces(frag: string): PlaceRef[] {
  let t = frag.replace(/\((?=[а-яё])[^)]*\)/g, ' ') // (пригород Берлина), (сев.) — пояснения
    .replace(/«[^»]*»/g, ' ') // «Бекман», «Курмарк» — названия в кавычках: заводы, полки
    .replace(/[()]/g, ', ')
    .replace(/([А-ЯЁ][а-яё]+)-\s*и\s+([А-ЯЁ][а-яё]+)-([А-ЯЁ][а-яё]+)/g, '$1-$3, $2-$3'); // Клейн- и Гросс-Деберн
  const out: PlaceRef[] = [];
  const seen = new Set<string>();
  for (const m of t.matchAll(NAME)) {
    let name = m[0].replace(/\s+/g, ' ').trim();
    if (NOT_PLACE.test(name) || NOT_PLACE_RE.test(name) || name.length < 3) continue;
    // «Ной Карлсхоф» — составное; «Альте Одер у Кваппендорфер» — отсечь реку в начале
    name = name.replace(/^(Альте Одер|Одер|Шпрее|Нейсе)\s+/, '');
    if (NOT_PLACE.test(name) || seen.has(name)) continue;
    seen.add(name);
    // оценка радиуса: пункт назван с уточнением (окраина, лес у, N км от) — 3 км, иначе 2
    const before = t.slice(Math.max(0, m.index! - 40), m.index!);
    const qualified = /км|окр\.|берег|лес|роща|опушк|шоссе|выс\.|отм\.|скат|дамб|мост|ж\.\s*д|изгиб|перекр|юж|сев|зап|вост/.test(before);
    // падеж по контексту: «юго-зап. Потсдама», «часть Потсдама» — родительный; «в Бауцене» — предложный
    const gramCase = /(сев|южн|зап|вост|окр|часть|части|района|у|до|от|из|подступах к)\.?\s*$/.test(before) && /а$/.test(name) ? 'gen'
      : /(^|\s)(в|на)\s*$/.test(before) && /е$/.test(name) ? 'prep' : undefined;
    out.push({ name, approxKm: qualified ? 3 : 2, ...(gramCase ? { gramCase } : {}) });
  }
  return out;
}

const SUBJECT_BEFORE = /(^|[,—:(;]|частями|частью сил|силами|главными силами|дивизиями|корпусами|составе|с утра|к исходу дня|днём|ночью|в ночь|[вк] \d{1,2}\.\d\d|с \d{1,2}\.\d\d)$/;
const ATTACHED_BEFORE = /(^|\s)(с|со|и)$/;
const isCorps = (u: Unit) => CORPS_TYPES.has(u.type) || u.type === 'тк' || u.type === 'мк';

/** Фрагменты «<соединение> — <пункты>» одной записи. */
function parseRecord(rec: TsamoPos): Frag[] {
  const out: Frag[] = [];
  // запись уровня корпуса («34 гв. ск», «4 гв. тк»): весь текст — его фрагмент
  const prefix = /^(армия|фронт|корпус|распоряжение)/.test(rec.unit) ? '' : `${rec.unit} — `;
  const text = prefix + rec.place;
  for (const segRaw of text.split(';')) {
    const seg = segRaw.trim();
    if (!seg || /^противник/i.test(seg)) continue;
    const toks = parseTokens(seg).filter((t) => t.units.every((u) => resolveUnit(u).side !== 'de'));
    const kind = toks.map((t) => {
      const before = seg.slice(0, t.index).trimEnd();
      return SUBJECT_BEFORE.test(before) ? 'subject' : ATTACHED_BEFORE.test(before) ? 'attached' : 'ref';
    });
    const subjects = toks.map((t, i) => [t, i] as [Token, number]).filter(([, i]) => kind[i] === 'subject');
    const frags: Frag[] = [];
    let corps: Frag | undefined;
    let pending: Unit[] = []; // «254 сд и 7 гв. мк … оставили Бауцен» — общий фрагмент
    for (let s = 0; s < subjects.length; s++) {
      const [tok, i] = subjects[s];
      const nextIdx = (k: number) => (k + 1 < subjects.length ? subjects[k + 1][0].index : seg.length);
      const raw = seg.slice(tok.end, nextIdx(s));
      if (/^\s*(и|,)\s*$/.test(raw) && s + 1 < subjects.length) { pending.push(...tok.units); continue; }
      let fragStart = tok.end, fragEnd = nextIdx(s);
      // «35 ск (250, 290, 348 сд) — Заппиг, Геритц» — состав корпуса в скобках: дивизии получают пункты корпуса
      const members: Token[] = [];
      if (/^\s*\(/.test(raw)) {
        const close = seg.indexOf(')', tok.end);
        if (close > 0) {
          while (s + 1 < subjects.length && subjects[s + 1][0].index < close) { s++; members.push(subjects[s][0]); }
          fragStart = close + 1; fragEnd = nextIdx(s);
        }
      }
      let fragText = seg.slice(fragStart, fragEnd).replace(/^\s*[—:-]\s*/, '').replace(/[,;\s]+$/, '');
      const before = seg.slice(0, tok.index).trimEnd();
      // «Позедин (9 гв. тк), Вульков (12 гв. тк)» — соединение в скобках после пункта
      if (before.endsWith('(') && /^\s*\)/.test(seg.slice(tok.end))) {
        const chunks = before.slice(0, -1).split(/[,:;—]|\)\s*/);
        fragText = chunks[chunks.length - 1].trim();
      }
      const units = [...pending, ...tok.units]; pending = [];
      const echelon = units.some(isCorps) ? 'corps' : 'division';
      const f: Frag = { rec, units, echelon, action: actionOf(fragText), places: extractPlaces(fragText), text: fragText };
      if (echelon === 'corps') corps = f; else if (corps) f.parentCorps = corps;
      frags.push(f);
      for (const m of members) frags.push({ rec, units: m.units, echelon: 'division', action: f.action, places: f.places, text: fragText, parentCorps: f });
      // приданные («с 44 тбр», «с 397 сд») внутри фрагмента — те же пункты
      for (let j = i + 1; j < toks.length && toks[j].index < fragEnd; j++) {
        if (kind[j] === 'attached') frags.push({ rec, units: toks[j].units, echelon: toks[j].units.some(isCorps) ? 'corps' : 'division', action: null, places: [], text: fragText, attachedTo: f });
      }
    }
    // корпус без своих пунктов — объединение пунктов его дивизий в сегменте; дивизия без действия — действие корпуса
    for (const f of frags) {
      if (f.attachedTo) { f.places = f.attachedTo.places; f.action = f.attachedTo.action; continue; }
      if (f.echelon === 'corps' && !f.places.length) {
        const seen = new Set<string>();
        const subs = frags.filter((d) => d.parentCorps === f);
        for (const d of subs) for (const p of d.places) if (!seen.has(p.name)) { seen.add(p.name); f.places.push(p); }
        if (seen.size) f.text = `по пунктам дивизий корпуса (${subs.map((d) => d.units.map((u) => u.label).join(', ')).join('; ')})`;
      }
    }
    for (const f of frags) if (!f.action && f.parentCorps?.action) f.action = f.parentCorps.action;
    out.push(...frags);
  }
  return out;
}

// порядок: сначала 1 БФ, затем 1 УФ, затем армейские ЖБД
const prio = (r: TsamoPos) => (/ЖБД 1 БФ/.test(r.note ?? '') ? 0 : /ЖБД 1 УФ/.test(r.note ?? '') ? 1 : 2);
const ordered = [...recs].sort((a, b) => prio(a) - prio(b) || a.date.localeCompare(b.date));
const frags: Frag[] = [];
const unparsed: { rec: TsamoPos; why: string }[] = [];
for (const r of ordered) {
  const fs = parseRecord(r);
  if (!fs.length) { if (parseTokens(r.place).length) unparsed.push({ rec: r, why: 'обозначения есть, но фрагменты не выделены' }); continue; }
  frags.push(...fs);
}

// ---------- 2. транскрипция русское → немецкое ----------
/** Пункты, у которых современное (польское) или нерегулярное название известно: запрос к Nominatim идёт с него. */
const QUERY_HINTS: Record<string, string> = {
  'Цэкерик': 'Siekierki, Cedynia', 'Гюстебизе': 'Gozdowice', 'Кюстрин': 'Kostrzyn nad Odrą', 'Бреслау': 'Wrocław', 'Герлиц': 'Görlitz', 'Гёрлиц': 'Görlitz',
  'Губен': 'Guben', 'Бэрвальде': 'Mieszkowice', 'Бервальде': 'Mieszkowice', 'Циленциг': 'Sulęcin', 'Дроссен': 'Ośno Lubuskie', 'Реппен': 'Rzepin',
  'Зоненбург': 'Słońsk', 'Зонненбург': 'Słońsk', 'Швибус': 'Świebodzin', 'Кроссен': 'Krosno Odrzańskie', 'Зорау': 'Żary', 'Заган': 'Żagań', 'Шпроттау': 'Szprotawa',
  'Бунцлау': 'Bolesławiec', 'Гайнау': 'Chojnów', 'Лигниц': 'Legnica', 'Яуэр': 'Jawor', 'Нойдамм': 'Dębno', 'Зольдин': 'Myślibórz', 'Ландсберг': 'Gorzów Wielkopolski',
  'Пириц': 'Pyrzyce', 'Штеттин': 'Szczecin', 'Фридеберг': 'Strzelce Krajeńskie', 'Мезериц': 'Międzyrzecz', 'Гойерсверда': 'Hoyerswerda', 'Кёнигсберг': 'Chojna',
  'Нойлитцегерике': 'Neulietzegöricke', 'Цолльбрюкке': 'Zollbrücke', 'Хоэн-Вутцов': 'Hohenwutzen', 'Хоэн Вутцов': 'Hohenwutzen', 'Ванддлитц': 'Wandlitz',
  'Нойенхаген': 'Neuenhagen', 'Ной-Левин': 'Neulewin', 'Ной Левин': 'Neulewin', 'Ратенов': 'Rathenow', 'Науэн': 'Nauen', 'Ютербог': 'Jüterbog', 'Торгау': 'Torgau',
  'Бауцен': 'Bautzen', 'Каменц': 'Kamenz', 'Мускау': 'Bad Muskau', 'Форст': 'Forst (Lausitz)', 'Шпремберг': 'Spremberg', 'Котбус': 'Cottbus', 'Коттбус': 'Cottbus',
  'Люббен': 'Lübben', 'Любенау': 'Lübbenau', 'Любен': 'Lübben', 'Тельтов': 'Teltow', 'Ландвер': 'Landwehrkanal, Berlin', 'Ванзее': 'Wannsee, Berlin', 'Моабит': 'Moabit, Berlin',
  'Шарлоттенбург': 'Charlottenburg, Berlin', 'Тиргартен': 'Tiergarten, Berlin', 'Кёпеник': 'Köpenick, Berlin', 'Кепеник': 'Köpenick, Berlin', 'Панков': 'Pankow, Berlin',
  'Вайсензее': 'Weißensee, Berlin', 'Лихтенберг': 'Lichtenberg, Berlin', 'Темпельхоф': 'Tempelhof, Berlin', 'Шпандау': 'Spandau, Berlin', 'Нойкельн': 'Neukölln, Berlin',
  'Нойкёльн': 'Neukölln, Berlin', 'Целендорф': 'Zehlendorf, Berlin', 'Штеглиц': 'Steglitz, Berlin', 'Веддинг': 'Wedding, Berlin', 'Сименсштадт': 'Siemensstadt, Berlin',
  'Шёнеберг': 'Schöneberg, Berlin', 'Шенеберг': 'Schöneberg, Berlin', 'Вильмерсдорф': 'Wilmersdorf, Berlin', 'Фридрихсхайн': 'Friedrichshain, Berlin', 'Трептов': 'Treptow, Berlin',
  'Бесков': 'Beeskow', 'Бизенталь': 'Biesenthal', 'Врицен': 'Wriezen', 'Марцан': 'Marzahn', 'Вельтен': 'Velten', 'Гранзее': 'Gransee', 'Геннигсдорф': 'Hennigsdorf',
  'Шёневайде': 'Schöneweide, Berlin', 'Альт-Розенталь': 'Alt Rosenthal', 'Альт-Глитцен': 'Altglietzen', 'Ной-Глитцен': 'Neuglietzen', 'Хайлигензе': 'Heiligensee, Berlin',
  'Штайнхёфель': 'Steinhöfel', 'Фридрихсталь': 'Friedrichsthal', 'Юнгфернхайде': 'Jungfernheide, Berlin', 'Вульхайде': 'Wuhlheide, Berlin', 'Вуле': 'Wuhle',
  'Цигенхальс': 'Ziegenhals, Königs Wusterhausen', 'Вильгельмштадт': 'Wilhelmstadt, Berlin', 'Вильгельмсхаген': 'Wilhelmshagen, Berlin', 'Кёльнише Хайде': 'Köllnische Heide, Berlin',
  'Зефельд': 'Seefeld, Werneuchen', 'Рибек': 'Ribbeck', 'Якобсдорф': 'Jacobsdorf', 'Буххольц': 'Buchholz', 'Хоэнштейн': 'Hohenstein', 'Хоэн-Нойендорф': 'Hohen Neuendorf',
  'Дальгов': 'Dallgow', 'Заров': 'Bad Saarow', 'Бонсдорф': 'Bohnsdorf, Berlin', 'Мальсдорф': 'Mahlsdorf, Berlin', 'Бисдорф': 'Biesdorf, Berlin', 'Альт-Глинике': 'Altglienicke, Berlin',
  'Шпренхаген': 'Spreenhagen', 'Бризеланг': 'Brieselang', 'Фройденберг': 'Freudenberg, Falkenberg', 'Шлаубехаммер': 'Schlaubehammer', 'Пульверкруг': 'Pulverkrug', 'Хельзе': 'Hälse',
  'Терингсвердер': 'Thöringswerder', 'Херренхоф': 'Herrenhof', 'Борегард': 'Beauregard', 'Альтвритцен': 'Altwriezen', 'Кинвердер': 'Kienwerder', 'Кваппендорфер': 'Quappendorf',
  'Нидеркрениг': 'Krajnik Dolny', 'Нидер Заатен': 'Zatoń Dolna', 'Меглин': 'Möglin', 'Везендаль': 'Wesendahl', 'Герльсдорф': 'Görlsdorf', 'Янсфельде': 'Jahnsfelde',
  'Васмансдорф': 'Waßmannsdorf', 'Ранцдорф': 'Rangsdorf', 'Рульсдорф': 'Ruhlsdorf', 'Дамсдорф': 'Dahmsdorf', 'Венденшлос': 'Wendenschloß, Berlin', 'Вендиш-Риц': 'Wendisch Rietz',
  'Лицен': 'Lietzen', 'Катариненхоф': 'Katharinenhof', 'Гросс-Глинике': 'Groß Glienicke', 'Гросс-Ритц': 'Groß Rietz', 'Гросс Бениц': 'Groß Behnitz', 'Гакенберг': 'Hakenberg',
  'Цезен': 'Zeesen', 'Зиферсдорф': 'Sieversdorf', 'Вальд-Зиферсдорф': 'Waldsieversdorf', 'Альт-Малиш': 'Alt Mahlisch', 'Ней-Малиш': 'Neu Mahlisch', 'Альт-Штансдорф': 'Alt Stahnsdorf',
  'Альт-Гартмансдорф': 'Alt Hartmannsdorf', 'Ной-Гартмансдорф': 'Neu Hartmannsdorf', 'Нидерлеме': 'Niederlehme', 'Ниппервизе': 'Ognica, Widuchowa', 'Кайзермюль': 'Kaisermühl',
  'Марквардт': 'Marquardt, Potsdam', 'Вельзикендорф': 'Wölsickendorf', 'Вензикендорф': 'Wensickendorf', 'Верноихен': 'Werneuchen', 'Витенау': 'Wittenau, Berlin', 'Кабиов': 'Kablow',
  'Хоэнвальде': 'Hohenwalde', 'Енниккендорф': 'Jänickendorf', 'Герциг': 'Görzig', 'Бигген': 'Biegen', 'Берневе': 'Bernöwe', 'Бришт': 'Briest', 'Крейцбрух': 'Kreuzbruch',
  'Штайнбек': 'Steinbeck', 'Купферсхаммер': 'Kupferhammer', 'Лангеваль': 'Langewahl', 'Уленхорст': 'Uhlenhorst', 'Ферлоренорт': 'Verlorenort', 'Филиппиненхоф': 'Philippinenhof',
  'Груббе': 'Grube', 'Газельберг': 'Haselberg', 'Нойхаус': 'Neuhaus', 'Ной-Фарланд': 'Neu Fahrland', 'Нидер-Вутцов': 'Niederwutzen', 'Нидер-Езар': 'Niederjesar', 'Геритц': 'Górzyca',
  'Штаф-Зее': 'Staffsee', 'Дольген-Зее': 'Dolgensee', 'Клостер-Зее': 'Klostersee', 'Шармютцель-Зее': 'Scharmützelsee', 'Шермютцель-Зее': 'Scharmützelsee', 'Фолькспарк': 'Volkspark, Berlin',
  'Рейнике': 'Reinickendorf, Berlin', 'Рейникендорф': 'Reinickendorf, Berlin', 'Гартенштадт': 'Gartenstadt Staaken, Berlin', 'Штакен': 'Staaken, Berlin',
};
/** Правила: подстрока → варианты (первый — основной). Длинные подстроки раньше коротких. */
const RULES: [string, string[]][] = [
  ['Нойен', ['Neuen']], ['Ной-', ['Neu', 'Neu ']], ['Ной ', ['Neu', 'Neu ']], ['Ной', ['Neu']], ['Ней-', ['Neu', 'Neu ']], ['Ней ', ['Neu', 'Neu ']], ['Ней', ['Neu', 'Nei']],
  ['Альт-', ['Alt ', 'Alt']], ['Альт ', ['Alt ', 'Alt']], ['Гросс-', ['Groß ', 'Groß']], ['Гросс ', ['Groß ', 'Groß']], ['Грос-', ['Groß ', 'Groß']],
  ['Кляйн-', ['Klein ', 'Klein']], ['Клейн-', ['Klein ', 'Klein']], ['Кляйн ', ['Klein ', 'Klein']], ['Клейн ', ['Klein ', 'Klein']],
  ['Нидер-', ['Nieder ', 'Nieder']], ['Нидер ', ['Nieder ', 'Nieder']], ['Обер-', ['Ober ', 'Ober']], ['Обер ', ['Ober ', 'Ober']],
  ['Хоэн-', ['Hohen']], ['Хоен-', ['Hohen']], ['Хоэн ', ['Hohen']], ['Адлиг ', ['Adlig ']], ['Адлиг-', ['Adlig ']], ['Вюсте-', ['Wüste ', 'Wüste']], ['Вюсте ', ['Wüste ']],
  ['Хоэн', ['Hohen']], ['Нидер', ['Nieder']], ['Вильгельм', ['Wilhelm']], ['Фридрих', ['Friedrich']], ['Кляйне', ['Kleine']], ['Клейне', ['Kleine']],
  ['хёэ', ['höhe']], ['оэ', ['ohe', 'oe']], ['цан', ['zahn', 'zan']], ['вайде', ['weide']], ['вейде', ['weide']], ['хх', ['chh']], ['шх', ['schh']], ['-Зее', ['see', 'er See', '-See']], ['ля', ['la', 'lja']],
  ['Шен', ['Schön', 'Schen']], ['Шён', ['Schön']], ['Кён', ['Kön']], ['Кен', ['Ken', 'Kön']], ['Гёр', ['Gör']],
  ['дорф', ['dorf']], ['вердер', ['werder']], ['хаген', ['hagen']], ['хаузен', ['hausen']], ['хайзен', ['heisen']], ['брюкке', ['brücke']], ['брюк', ['brück']],
  ['вальде', ['walde']], ['вальд', ['wald']], ['фельде', ['felde']], ['фельд', ['feld']], ['мюле', ['mühle']], ['мюль', ['mühl']], ['вассер', ['wasser']],
  ['хайн', ['hain', 'hein']], ['хейн', ['hain', 'hein']], ['хайм', ['heim']], ['хейм', ['heim']], ['хайде', ['heide']], ['хейде', ['heide']], ['хоф', ['hof']], ['берг', ['berg']], ['бург', ['burg']],
  ['флис', ['fließ', 'flies']], ['вайс', ['weiß', 'weis']], ['вейс', ['weiß', 'weis']], ['гольц', ['holz']], ['хольц', ['holz']], ['кирх', ['kirch']], ['мюнх', ['münch']],
  ['бах', ['bach']], ['таль', ['tal', 'thal']], ['грюн', ['grün']], ['шварц', ['schwarz']], ['штайн', ['stein']], ['штейн', ['stein']], ['зее', ['see']], ['хг', ['chh']],
  ['штадт', ['stadt']], ['шт', ['st', 'scht']], ['шп', ['sp']], ['ш', ['sch']], ['щ', ['sch']], ['чш', ['tsch']], ['тш', ['tsch']], ['тч', ['tsch']], ['ч', ['tsch']],
  ['цш', ['zsch']], ['тц', ['tz']], ['иц', ['iz', 'itz']], ['ц', ['z', 'tz', 'c']], ['кс', ['x', 'ks']], ['кк', ['ck']], ['к', ['k', 'ck', 'c']],
  ['ай', ['ei', 'ai']], ['ей', ['ei', 'ey']], ['ой', ['eu', 'oi', 'oy']], ['эй', ['ei']], ['ау', ['au']], ['еу', ['eu']], ['ью', ['ü']], ['ие', ['ie']],
  ['ий', ['i']], ['ль', ['l', 'll']], ['ы', ['y']], ['я', ['ja', 'ia']], ['ю', ['ü', 'u']], ['ё', ['ö']], ['э', ['ö', 'ä', 'e']], ['е', ['e', 'ä']], ['й', ['i', 'j']],
  ['а', ['a']], ['б', ['b']], ['в', ['w', 'v']], ['г', ['g']], ['д', ['d']], ['ж', ['sch']], ['з', ['s', 'z']], ['и', ['i', 'ie']], ['л', ['l']], ['м', ['m']],
  ['н', ['n']], ['о', ['o']], ['п', ['p']], ['р', ['r']], ['с', ['s', 'ss', 'z']], ['т', ['t']], ['у', ['u']], ['ф', ['f', 'v']], ['х', ['h', 'ch']],
  ['ъ', ['']], ['ь', ['']], ['-', ['-', ' ', '']], [' ', [' ', '']],
].map(([k, v]) => [k, v] as [string, string[]]).sort((a, b) => b[0].length - a[0].length);
/** Вес отклонения от основного варианта (больше — вероятнее): «и→ie», «ц→tz», «е→ä» частые, «ф→v», «к→c» редкие. */
const DEV_W: Record<string, number> = {
  'и:ie': 3, 'ц:tz': 3, 'ц:c': 0.3, 'е:ä': 2, 'с:ss': 2, 'с:z': 0.7, 'к:ck': 2, 'к:c': 0.3, 'в:v': 0.5, 'ф:v': 0.3, 'з:z': 0.8, 'й:j': 0.4,
  'ай:ai': 1, 'ой:oi': 0.5, 'ой:oy': 0.3, 'ей:ey': 0.5, 'э:ä': 2, 'э:e': 2, 'ю:u': 1, 'я:ia': 0.5, 'хайн:hein': 4, 'хейн:hein': 4, 'шт:scht': 0.2,
  'Ней:Nei': 0.3, 'Шен:Schen': 1, 'Кен:Kön': 1, 'таль:thal': 1, 'иц:itz': 2, 'ль:ll': 2.5, '-: ': 5, '-:': 4.5, ' :': 5, 'Ной-:Neu ': 1, 'Ной :Neu ': 1, 'Ней-:Neu ': 1,
};

/** Варианты латинского написания (первый — основной): отклонения от основного по убыванию веса, не более cap. */
function transliterate(name: string, cap = 24): string[] {
  const slots: { alts: string[]; key: string }[] = [];
  let i = 0;
  while (i < name.length) {
    let hit: [string, string[]] | undefined;
    for (const r of RULES) if (name.startsWith(r[0], i) || name.toLowerCase().startsWith(r[0], i)) { hit = r; break; }
    if (!hit) { slots.push({ alts: [name[i]], key: '' }); i++; continue; }
    const [key] = hit;
    let alts = [...hit[1]];
    const wordStart = i === 0 || /[-\s]/.test(name[i - 1]);
    const wordEnd = i + key.length >= name.length || /[-\s]/.test(name[i + key.length]);
    // позиционные правила: «х» внутри слова — чаще ch (Heinrichsdorf), «э» в начале — E (Eberswalde), «-иц» в конце — itz (Teupitz)
    if (key === 'х' && !wordStart) alts = ['ch', 'h'];
    if (key === 'э' && wordStart) alts = ['e', 'ö', 'ä'];
    if (key === 'иц' && wordEnd) alts = ['itz', 'iz'];
    const upper = name[i] === name[i].toUpperCase() && name[i] !== name[i].toLowerCase();
    slots.push({ alts: alts.map((v) => (upper && v ? v[0].toUpperCase() + v.slice(1) : v)), key });
    i += key.length;
  }
  const choices = slots.map(() => 0);
  const build = () => slots.map((s, k) => s.alts[choices[k]]).join('').replace(/\s+/g, ' ').trim();
  const out = [build()];
  // отклонения по одному (по убыванию веса), затем по два
  const devs: { k: number; c: number; w: number }[] = [];
  for (let k = 0; k < slots.length; k++) for (let c = 1; c < slots[k].alts.length; c++) {
    const alt = slots[k].alts[c].toLowerCase();
    // слитное/раздельное написание (Groß Barnim / Großbarnim) — самое вероятное отклонение
    const spacing = slots[k].alts[c].trim() === slots[k].alts[0].trim();
    devs.push({ k, c, w: spacing ? 5 : DEV_W[`${slots[k].key}:${alt}`] ?? DEV_W[`${slots[k].key}:${slots[k].alts[c]}`] ?? 1 });
  }
  devs.sort((a, b) => b.w - a.w);
  for (const d of devs) { if (out.length >= cap) break; choices[d.k] = d.c; out.push(build()); choices[d.k] = 0; }
  for (let a = 0; a < devs.length && out.length < cap; a++) for (let b = a + 1; b < devs.length && out.length < cap; b++) {
    if (devs[a].k === devs[b].k) continue;
    choices[devs[a].k] = devs[a].c; choices[devs[b].k] = devs[b].c; out.push(build()); choices[devs[a].k] = 0; choices[devs[b].k] = 0;
  }
  return [...new Set(out)];
}
/** Варианты латинского написания с учётом подсказок и падежа («юго-зап. Потсдама» → Potsdam, «в Бауцене» → Bautzen). */
function variantsOf(name: string, gramCase?: 'gen' | 'prep'): string[] {
  const out: string[] = [];
  if (QUERY_HINTS[name]) out.push(QUERY_HINTS[name]);
  const stem = name.slice(0, -1);
  const stemOk = stem.length >= 5 && /[мгтнвфдкцрхлбп]$/.test(stem) && !/ау$/.test(stem);
  const declined = stemOk && ((gramCase === 'gen' && /а$/.test(name)) || (gramCase === 'prep' && /е$/.test(name)));
  if (declined) out.push(...transliterate(stem));
  if (QUERY_HINTS[stem] && declined) out.unshift(QUERY_HINTS[stem]);
  out.push(...transliterate(name));
  return [...new Set(out)];
}
/** Нормализация для сравнения: строчные, без умляутов, ß→ss, только буквы. */
const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

if (opt('variants')) { // отладка транскрипции: --variants "Ной-Левин,Хайнрихсдорф"
  for (const n of opt('variants')!.split(',')) console.log(`${n}: ${variantsOf(n.trim()).join(' | ')}`);
  process.exit(0);
}

// ---------- 3. газеттиры репозитория ----------
interface GazHit { lng: number; lat: number; name: string; file: string }
const GAZ_FILES = [
  'docs/sources/berlin-1945-positions.json', 'docs/sources/berlin-1945-halbe.json', 'docs/sources/berlin-1945-conquest.json',
  'docs/sources/berlin-1945-seelow-divisions.json', 'docs/sources/vistula-oder-1945.json', 'docs/sources/vistula-oder-1945-divisions.json',
];
const gazIndex = new Map<string, GazHit[]>();
for (const file of GAZ_FILES) {
  const p = resolve(ROOT, file);
  if (!existsSync(p)) continue;
  const d = readJson<Record<string, unknown>>(p);
  const gaz = (d.gazetteer ?? d.new_gazetteer) as Record<string, { lng?: number; lat?: number; query?: string; osm_display_name?: string; note?: string }> | undefined;
  if (!gaz) continue;
  const short = file.replace(/^docs\/sources\/|\.json$/g, '');
  for (const [key, e] of Object.entries(gaz)) {
    if (typeof e.lng !== 'number' || typeof e.lat !== 'number') continue;
    const names = new Set<string>([key.replace(/_[A-Z]+$/, '')]);
    if (e.query) names.add(e.query.split(',')[0]);
    if (e.osm_display_name) names.add(e.osm_display_name.split(',')[0]);
    const nm = /Nominatim:\s*([^,]+)/.exec(e.note ?? '');
    if (nm) names.add(nm[1]);
    for (const n of names) {
      const k = norm(n);
      if (!k) continue;
      if (!gazIndex.has(k)) gazIndex.set(k, []);
      gazIndex.get(k)!.push({ lng: e.lng, lat: e.lat, name: n.trim(), file: short });
    }
  }
}

// ---------- 4. кэш и Nominatim ----------
const cache: Record<string, CacheEntry> = existsSync(cachePath) ? readJson<Record<string, CacheEntry>>(cachePath) : {};
let requests = 0;
let lastReq = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface NomRes { lat: string; lon: string; display_name: string; name?: string; class: string; type: string }
/** Запрос с окном вокруг координат армии (~40 км): Nominatim отдаёт только три лучших результата, и у частых названий
 * (Heinrichsdorf, Eichwerder, Karlshof) нужный пункт иначе вытесняется одноимёнными. */
async function nominatim(q: string, armyLng: number, armyLat: number): Promise<NomRes[]> {
  const wait = 1100 - (Date.now() - lastReq);
  if (wait > 0) await sleep(wait);
  lastReq = Date.now(); requests++;
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q); u.searchParams.set('format', 'json'); u.searchParams.set('limit', '3');
  u.searchParams.set('countrycodes', 'de,pl'); u.searchParams.set('bounded', '1');
  const dLng = 0.6, dLat = 0.37; // ≈40 км на широте 52°
  const w = Math.max(BOX.west, armyLng - dLng), e = Math.min(BOX.east, armyLng + dLng), so = Math.max(BOX.south, armyLat - dLat), n = Math.min(BOX.north, armyLat + dLat);
  u.searchParams.set('viewbox', `${w},${n},${e},${so}`);
  const res = await fetch(u, { headers: { 'User-Agent': 'def_ops-geocode-tsamo/1.0 (wladimir.abramow@gmail.com)', 'Accept-Language': 'de' } });
  if (!res.ok) { console.error(`Nominatim ${res.status} для «${q}»`); return []; }
  return (await res.json()) as NomRes[];
}

interface Found { lng: number; lat: number; rel: Rel; src: string; note?: string }
const stats = { gazetteer: 0, nominatim: 0, cached: 0, notFound: 0, tooFar: 0, rejected: 0 };
/** Населённые пункты, границы, природные объекты (озёра, леса), станции — не магазины и не учреждения. */
const isPlace = (r: NomRes) => ['place', 'boundary', 'natural', 'landuse', 'waterway'].includes(r.class) || (r.class === 'railway' && /station|halt/.test(r.type));
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const similar = (osm: string, q: string) => osm.includes(q) || q.includes(osm) || levenshtein(osm, q) <= Math.max(1, Math.floor(q.length / 4));
const found = new Map<string, Found | null>();

/** Координаты пункта: кэш → газеттиры → Nominatim; принимается только пункт в области и не дальше 40 км от армии. */
async function geocode(name: string, armyLng: number, armyLat: number, gramCase?: 'gen' | 'prep'): Promise<Found | null> {
  const ok = (lng: number, lat: number) => inBox(lng, lat) && distKm(lng, lat, armyLng, armyLat) <= MAX_KM_FROM_ARMY;
  const c = cache[name];
  if (c && typeof c.lng === 'number' && typeof c.lat === 'number') {
    if (ok(c.lng, c.lat)) return { lng: c.lng, lat: c.lat, rel: c.reliability ?? (c.source === 'manual' ? 'A' : 'B'), src: c.source ?? 'cache' };
    stats.tooFar++;
    return null;
  }
  if (c && c.source === null && !retry) return null; // уже искали, не нашли
  const variants = variantsOf(name, gramCase);
  // газеттиры репозитория
  for (let vi = 0; vi < variants.length; vi++) {
    for (const h of gazIndex.get(norm(variants[vi])) ?? []) {
      if (!ok(h.lng, h.lat)) continue;
      const rel: Rel = vi === 0 ? 'A' : 'B';
      cache[name] = { query: h.name, lng: h.lng, lat: h.lat, osm_display_name: null, variant: variants[vi], source: 'gazetteer', reliability: rel, note: `газеттир ${h.file}` };
      stats.gazetteer++;
      return { lng: h.lng, lat: h.lat, rel, src: `gazetteer:${h.file}` };
    }
  }
  if (noNet || requests >= maxRequests) return null;
  // Nominatim: не больше двух вариантов на пункт (основной, затем с одним отклонением)
  const tried: string[] = c?.tried ?? [];
  for (const v of variants.slice(0, 2)) {
    if (tried.includes(v) && !retry) continue;
    if (requests >= maxRequests) break;
    tried.push(v);
    const res = await nominatim(v, armyLng, armyLat);
    const cands = res.filter(isPlace).map((r) => ({ r, lng: Number(r.lon), lat: Number(r.lat) })).filter((x) => ok(x.lng, x.lat))
      .sort((a, b) => distKm(a.lng, a.lat, armyLng, armyLat) - distKm(b.lng, b.lat, armyLng, armyLat));
    if (!cands.length) { if (res.length) stats.tooFar++; continue; }
    const best = cands[0];
    const nameOf = (r: NomRes) => norm(r.name ?? r.display_name.split(',')[0]);
    const hinted = v === QUERY_HINTS[name] || v === QUERY_HINTS[name.slice(0, -1)];
    const exact = hinted || nameOf(best.r) === norm(v);
    // имя в OSM должно быть похоже на запрос: «Briesen (Mark)» для Briesen — да, «Rahmer See» для Hafel-See — нет
    if (!exact && !similar(nameOf(best.r), norm(v))) { stats.rejected++; continue; }
    const sameSpot = cands.every((c2) => nameOf(c2.r) === nameOf(best.r)); // пункт и его улицы — один объект
    const rel: Rel = exact && (hinted || v === variants[0]) && sameSpot ? 'A' : 'B';
    cache[name] = { query: v, lng: best.lng, lat: best.lat, osm_display_name: best.r.display_name, variant: v, source: 'nominatim', reliability: rel,
      note: [exact ? undefined : 'имя в OSM отличается от запроса', sameSpot ? undefined : `разных пунктов в окне: ${new Set(cands.map((c2) => nameOf(c2.r))).size}`].filter(Boolean).join('; ') || undefined };
    stats.nominatim++;
    return { lng: best.lng, lat: best.lat, rel, src: 'nominatim' };
  }
  cache[name] = { query: null, lng: null, lat: null, osm_display_name: null, variant: null, source: null, tried, note: 'не найдено: по газеттирам и Nominatim (варианты в tried)' };
  stats.notFound++;
  return null;
}

// ---------- 5. сборка выхода ----------
const corpsAbbr = (u: Unit) => `${u.n} ${u.guards ? 'гв. ' : ''}${u.type}`;
const out: OutPos[] = [];
const unresolved = new Map<string, number>();
let fragsUsed = 0;
const saveCache = () => writeFileSync(cachePath, JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b, 'ru'))), null, 1) + '\n');

for (const f of frags) {
  const targets: { id: string; abbr: string }[] = [];
  for (const u of f.units) {
    const r = resolveUnit(u);
    if (r.id) targets.push({ id: r.id, abbr: divById.get(r.id)?.abbr[0] ?? u.label });
    else if (r.corps) targets.push({ id: r.corps, abbr: corpsAbbr(u) });
    else unresolved.set(u.label, (unresolved.get(u.label) ?? 0) + 1);
  }
  if (!targets.length) continue;
  fragsUsed++;
  const rec = f.rec;
  const places: OutPlace[] = [];
  for (const p of f.places) {
    const key = `${p.name}|${rec.lon}|${rec.lat}`;
    let g = found.get(key);
    if (g === undefined) { g = await geocode(p.name, rec.lon, rec.lat, p.gramCase); found.set(key, g); if (requests % 20 === 0) saveCache(); }
    places.push(g ? { name: p.name, lng: g.lng, lat: g.lat, approxKm: p.approxKm, reliability: g.rel, source: g.src } : { name: p.name, lng: null, lat: null, approxKm: p.approxKm });
  }
  const hit = places.filter((p) => p.lng != null && p.lat != null) as (OutPlace & { lng: number; lat: number })[];
  let lng: number, lat: number, approxKm: number, reliability: Rel, fallback: 'army' | undefined;
  if (hit.length) {
    lng = hit.reduce((s, p) => s + p.lng, 0) / hit.length; lat = hit.reduce((s, p) => s + p.lat, 0) / hit.length;
    let span = 0;
    for (const a of hit) for (const b of hit) span = Math.max(span, distKm(a.lng, a.lat, b.lng, b.lat));
    approxKm = hit.length === 1 ? hit[0].approxKm : Math.max(Math.max(...hit.map((p) => p.approxKm)), Math.round(span / 2 * 10) / 10);
    reliability = hit.every((p) => p.reliability === 'A') ? 'A' : 'B';
  } else {
    lng = rec.lon; lat = rec.lat; approxKm = 8; reliability = 'C'; fallback = 'army';
  }
  const excerpt = `${f.units.map((u) => u.label).join(', ')} — ${f.text}`.slice(0, 200);
  const noteParts = [excerpt];
  if (f.attachedTo) noteParts.push(`придана: пункты по ${f.attachedTo.units.map((u) => u.label).join(', ')}`);
  if (fallback) noteParts.push(f.places.length ? `пункты не найдены (${f.places.map((p) => p.name).join(', ')}); координаты армии` : 'пунктов в тексте нет; координаты армии');
  for (const t of targets) {
    out.push({
      formation: t.id, abbr: t.abbr, echelon: f.echelon, army: rec.army, date: rec.date, time: rec.time, action: f.action ?? 'на рубеже',
      places, lng: Math.round(lng * 1e4) / 1e4, lat: Math.round(lat * 1e4) / 1e4, approxKm, ...(fallback ? { fallback } : {}),
      source: rec.source, url: rec.url, note: noteParts.join('; '), reliability,
    });
  }
}
saveCache();

// ---------- 6. запись и сводка ----------
const divs = new Set(out.filter((o) => o.echelon === 'division' && divById.has(o.formation)).map((o) => o.formation));
const corpsIds = new Set(out.filter((o) => o.echelon === 'corps').map((o) => o.formation));
const placeNames = new Set(frags.flatMap((f) => f.places.map((p) => p.name)));
const cacheStat = { gazetteer: 0, nominatim: 0, manual: 0, notFound: 0 };
for (const n of placeNames) { const c = cache[n]; if (!c) continue; if (c.source === 'gazetteer') cacheStat.gazetteer++; else if (c.source === 'nominatim') cacheStat.nominatim++; else if (c.source === 'manual') cacheStat.manual++; else cacheStat.notFound++; }
const byRel = { A: 0, B: 0, C: 0 };
for (const o of out) byRel[o.reliability]++;
const meta = {
  description: 'Положения дивизий и корпусов, извлечённые из текста выписок ЖБД ЦАМО (positions.json, поле place) и геокодированные: '
    + 'газеттиры репозитория, затем Nominatim (OSM) по немецкой транскрипции; кэш — gazetteer.json. Собирается npm run sim:geocode-tsamo.',
  fields: {
    formation: 'id реестра дивизий (docs/sources/berlin-1945-divisions.json) либо нормализованный id корпуса (su_77sk, su_12gsk, su_7gkk)',
    echelon: 'division — дивизия/бригада/УР реестра; corps — ск, кк, тк, мк',
    action: 'взяла | бой за | на рубеже | сосредоточена | второй эшелон | форсирование | марш | оборона (по глаголу во фрагменте; без глагола — «на рубеже»)',
    places: 'пункты фрагмента с координатами (null — не найден); approxKm пункта: 2 — назван прямо, 3 — с уточнением (окраина, N км, лес у)',
    'lng, lat, approxKm': 'центр найденных пунктов и радиус (половина длины рубежа при нескольких пунктах); если пунктов нет — координаты армии, approxKm 8, fallback: "army"',
    reliability: 'A — все пункты найдены точно; B — хотя бы один по транскрипции с сомнением или неоднозначно; C — координаты армии',
    note: 'фрагмент текста ЖБД (до 200 знаков) и пояснения',
  },
  stats: {
    records: recs.length, fragments: frags.length, fragmentsUsed: fragsUsed, positions: out.length,
    divisions: divs.size, corps: corpsIds.size, byReliability: byRel,
    places: { distinct: placeNames.size, ...cacheStat }, unresolvedDesignations: Object.fromEntries([...unresolved].sort((a, b) => b[1] - a[1])),
    nominatimRequestsThisRun: requests,
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ meta, positions: out }, null, 1) + '\n');
console.log(`записей ${recs.length}, фрагментов ${frags.length} (использовано ${fragsUsed}), положений ${out.length}: дивизий ${divs.size}, корпусов ${corpsIds.size}; ` +
  `A ${byRel.A}, B ${byRel.B}, C ${byRel.C}`);
console.log(`пунктов ${placeNames.size}: газеттиры ${cacheStat.gazetteer}, Nominatim ${cacheStat.nominatim}, вручную ${cacheStat.manual}, не найдено ${cacheStat.notFound}; ` +
  `запросов за прогон ${requests}; за прогон: газеттир ${stats.gazetteer}, Nominatim ${stats.nominatim}, вне 40 км ${stats.tooFar}, отклонено по имени/типу ${stats.rejected}`);
if (unparsed.length) console.log(`записей с обозначениями без фрагментов: ${unparsed.length}`);
console.log(`не сопоставлены с реестром: ${[...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
console.log(`выход: ${outPath}`);
