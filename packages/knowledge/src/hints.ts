/**
 * Подсказки, что искать, — по дефицитам полноты: по каждой группе и недостающему сведению — что найти, зачем это
 * модели (на что влияет в расчёте или в игре), где обычно есть такие сведения (типы источников и известные
 * издания), готовые поисковые запросы и элементы, у которых этого нет. Порядок — по пользе для модели: вес
 * группы × важность сведения для расчёта × доля, которой не хватает.
 */
import type { Coverage, CoverageGroup, CoverageItem } from './coverage';

export interface SearchHint {
  id: string;
  group: string;
  /** Что найти: «Численность — у 52 из 66 формирований». */
  title: string;
  missing: number; total: number;
  /** Зачем: на что влияет в модели. */
  why: string;
  /** Где искать: типы источников и издания. */
  where: string[];
  /** Готовые запросы (по-русски, по-немецки/английски) — для первых элементов. */
  queries: string[];
  /** Элементы, у которых этого нет (первые). */
  items: string[];
  priority: number;
}

/** Важность сведения для модели (0…1) и что оно меняет. */
const IMPACT: Record<string, Record<string, [number, string]>> = {
  formations: {
    personnel: [1, 'боевой потенциал формирования: соотношение сил в бою, потери, темп'],
    tanks: [1, 'вес танков и САУ в потенциале; прорыв укреплённых полос'],
    guns: [0.9, 'вес артиллерии в потенциале; артиллерийская подготовка'],
    composition: [0.7, 'тип формирования (пехотное, танковое) — подвижность, качество'],
    parent: [0.6, 'подчинённость: доведение приказов, оперативный и стратегический уровни карты'],
    commander: [0.3, 'справка штабу и советнику, разбор'],
    path: [0.8, 'где и когда формирование было — проверка расчёта, исторические приказы'],
  },
  commanders: { rank: [0.2, 'справка'], post: [0.3, 'кто кому подчинён — для штаба модели'], decisions: [0.6, 'исторические решения — роль и ограничения штаба модели'] },
  positions: { days: [1, 'с чем сравнивается расчёт: калибровка правил и «положений в допуске»'] },
  places: { kind: [0.3, 'справка'], location: [0.3, 'справка'], features: [0.5, 'местность пункта для посредника'], defense: [1, 'укреплённость района и гарнизон — сила обороны в бою'], significance: [0.4, 'цели штаба модели'] },
  lines: { location: [0.7, 'где проходит полоса — её линия в театре'], features: [0.6, 'глубина и устройство полосы'], defense: [1, 'уровень укреплённости и кто оборонял — сила обороны'], significance: [0.3, 'справка'] },
  rivers: { features: [0.5, 'ширина, берега — задержка форсирования'], crossings: [0.9, 'где можно переправиться — маршруты техники'], significance: [0.3, 'справка'] },
  bridges: { state: [1, 'мост действует или нет и с какого дня — маршруты техники, окружения'] },
  operation: { dates: [0.5, ''], theatre: [0.3, ''], sides: [0.5, ''], command: [0.3, ''], goal: [0.6, 'замысел — задачи сторон, условия победы'], forces: [0.8, 'общие силы — проверка состава сценария'], outcome: [0.5, 'итог — события для сравнения'], losses: [0.8, 'потери — нормативы потерь, проверка расчёта'] },
  battles: { dates: [0.6, ''], place: [0.4, ''], attacker: [0.5, ''], defender: [0.5, ''], forces: [0.8, 'силы на участке — соотношение'], course: [0.7, 'ход боя — события и темп для сравнения'], outcome: [0.6, ''], losses: [0.8, 'потери на участке — нормативы'] },
  events: { event: [0.8, 'ключевые события — даты для сравнения расчёта с историей'] },
  weather: { weather: [0.6, 'распутица, ледостав, видимость — темп марша, авиация'] },
  doctrine: { principles: [0.6, 'как сторона воюет — штаб модели и советник'], numbers: [0.8, 'нормативы (темпы, плотности, фронт обороны) — правила арбитра'] },
  equipment: { type: [0.3, ''], armament: [0.5, 'огневая мощь — вес техники'], armor: [0.5, 'защищённость — вес техники'], weight: [0.2, ''], speed: [0.4, 'темп подвижных частей'], crew: [0.2, ''], range: [0.4, 'запас хода — подвоз горючего'] },
  norms: { kb: [0.5, 'обоснование норматива в базе'], source: [0.6, 'проверяемость'], reliable: [0.6, 'надёжность норматива'] },
  sources: { have: [0.7, 'достоверность всего остального'] },
};

/** Где искать — по группе (и сведению). Известные издания и архивы — ориентиры, не исчерпывающий список. */
const WHERE: Record<string, string[]> = {
  formations: ['журналы боевых действий и донесения о боевом и численном составе (ЦАМО; «Память народа» — pamyat-naroda.ru)', '«Боевой состав Советской армии» (сб. Генштаба, ч. V — 1945)', 'германская сторона: Tessin «Verbände und Truppen der deutschen Wehrmacht und Waffen-SS»; lexikon-der-wehrmacht.de; KTB OKW', 'исследования: Le Tissier («Zhukov at the Oder», «Race for the Reichstag»), Лаковски «Seelower Höhen», Исаев «Берлин 45-го»'],
  formations_path: ['журналы боевых действий армий и корпусов по дням', 'оперативные карты и схемы в исследованиях (Le Tissier, Исаев, Ziemke «Stalingrad to Berlin»)', 'мемуары командующих (Жуков, Чуйков, Конев, Катуков)'],
  commanders: ['биографические справочники: «Великая Отечественная. Командармы», «Комкоры»', 'германская сторона: lexikon-der-wehrmacht.de (Personenregister), ritterkreuztraeger-1939-45.de', 'мемуары и исследования операции'],
  positions: ['журналы боевых действий и оперативные сводки по дням (ЦАМО, «Память народа»)', 'карты-схемы положения войск на каждый день в исследованиях (Le Tissier, Ziemke, Исаев)', 'германская сторона: Lagekarten OKH (NARA, микрофильмы T-78), KTB групп армий'],
  places: ['планы обороны городов (Berlin: Kampfabschnitte, Verteidigungsbereich Berlin)', 'исследования боёв за пункт; Le Tissier «The Battle of Berlin 1945»', 'местные краеведческие издания, de-wiki о населённом пункте (Kriegsende 1945)'],
  lines: ['схемы оборонительных полос в исследованиях (Лаковски, Le Tissier «Zhukov at the Oder»)', 'разведсводки фронта о системе обороны противника', 'немецкие документы о строительстве позиций (Wotan-Stellung, Hardenberg-Stellung)'],
  rivers: ['справочники и карты 1940-х (Messtischblatt 1:25 000, карты РККА); описание театра в исследованиях', 'инженерные отчёты о форсировании (отчёты инженерных войск фронта)'],
  bridges: ['отчёты инженерных войск фронта о переправах (ЦАМО)', 'журналы боевых действий: подрывы мостов, захват целыми', 'исследования по участкам; de-wiki о мостах (Brückensprengungen 1945)'],
  operation: ['«Берлинская операция 1945 года» (Русский архив. Великая Отечественная, т. 15 (4-5)) — сборник документов', 'Кривошеев «Россия и СССР в войнах XX века» — потери', 'Ziemke «Stalingrad to Berlin»; «История Второй мировой войны 1939–1945», т. 10'],
  battles: ['исследования по участкам (Лаковски — Зееловские высоты; Le Tissier — Берлин, Хальбе)', 'журналы боевых действий армий за дни боя', 'de-wiki/ru-wiki о сражении — как отправная точка к источникам'],
  events: ['хроники операции (сборники документов, хронология в исследованиях)', 'журналы боевых действий за дату события'],
  weather: ['журналы боевых действий (графа о погоде и состоянии дорог)', 'метеоархив DWD (Deutscher Wetterdienst), климатические сводки апреля 1945', 'мемуары: распутица, дым, видимость'],
  doctrine: ['уставы и наставления: Полевой устав 1944 (ПУ-43), «Наставление по прорыву позиционной обороны» (1944), Боевой устав пехоты', 'германская сторона: H.Dv. 300 «Truppenführung»; US War Dept. TM-E 30-451 «Handbook on German Military Forces» (1945)', 'сборники «Опыт войны» / «Сборник материалов по изучению опыта войны»'],
  equipment: ['справочники: Солянкин и др. «Отечественные бронированные машины»; Chamberlain & Doyle «Encyclopedia of German Tanks of WWII»; Jentz «Panzer Tracts»', 'ТТХ из наставлений по материальной части', 'Широкорад — артиллерия'],
  norms: ['сборники опыта войны, исследования по темпам и потерям (Кривошеев; Исаев)', 'отчёты фронтов по итогам операции'],
  sources: ['загрузите в операцию официальные документы (A): сборники документов, отчёты фронтов, журналы боевых действий', 'проверенные исследования (B) — с указанием страниц'],
};

const OP_WORDS: Record<string, string> = { formations: 'апрель 1945', positions: '1945 журнал боевых действий', places: 'оборона 1945', lines: 'оборонительная полоса 1945', rivers: 'форсирование 1945', bridges: 'мост 1945 взорван', battles: '1945 бой', events: '1945', weather: 'погода апрель 1945', doctrine: '1945', equipment: 'ТТХ' };
const KEY_WORDS: Record<string, string> = { personnel: 'численность', tanks: 'танки САУ', guns: 'орудия миномёты', composition: 'состав', parent: 'подчинение', commander: 'командир', path: 'боевой путь', defense: 'оборона гарнизон', crossings: 'переправы мосты', losses: 'потери', forces: 'силы сторон', numbers: 'нормативы' };
const EN_WORDS: Record<string, string> = { personnel: 'strength', tanks: 'tanks', guns: 'artillery', composition: 'order of battle', parent: 'subordinated', commander: 'commander', path: 'operations', days: 'positions', state: 'bridge destroyed' };
const DE_WORDS: Record<string, string> = { personnel: 'Stärke', tanks: 'Panzer Bestand', guns: 'Artillerie', composition: 'Gliederung', parent: 'Unterstellung', commander: 'Kommandeur', path: 'Einsatz', defense: 'Verteidigung', crossings: 'Brücken', days: 'Lage', state: 'Brücke gesprengt' };

/** Оригинальное название из «Русское (Original)» или из записи. */
const orig = (t: string) => /\(([^)]*[A-Za-zÄÖÜäöüß][^)]*)\)/.exec(t)?.[1];

function queriesFor(g: CoverageGroup, key: string, items: CoverageItem[], period: string): string[] {
  const out: string[] = [];
  for (const it of items.slice(0, 3)) {
    const name = it.title.replace(/ — .*$/, '').replace(/^\d\d\.\d\d /, '').replace(/ \(.*$/, '');
    out.push(`${name} ${KEY_WORDS[key] ?? ''} ${OP_WORDS[g.id] ?? period}`.replace(/\s+/g, ' ').trim());
    const o = it.alt ?? orig(it.title);
    // запрос в оригинале: германская сторона — по-немецки, советская — по-английски (в западной литературе)
    if (o || it.side === 'de') out.push(`${o ?? name} ${(it.side === 'de' ? DE_WORDS : EN_WORDS)[key] ?? ''} ${it.side === 'de' ? 'April 1945' : '1945'}`.replace(/\s+/g, ' ').trim());
  }
  return [...new Set(out)].slice(0, 5);
}

const UNIT: Record<string, string> = { formations: 'формирований', commanders: 'командующих', positions: 'формирований', places: 'пунктов', lines: 'рубежей', rivers: 'рек', bridges: 'мостов', battles: 'участков', events: 'событий', doctrine: 'тем', equipment: 'образцов', norms: 'нормативов', operation: '', weather: '', sources: '' };

const sorted = (xs: CoverageItem[]) => [...xs].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.score - b.score || a.title.localeCompare(b.title, 'ru'));

export function coverageHints(c: Coverage, period = '1945'): SearchHint[] {
  const out: SearchHint[] = [];
  for (const g of c.groups) {
    const keys = [...new Set(g.items.flatMap((i) => i.need))];
    for (const k of keys) {
      const need = g.items.filter((i) => i.need.includes(k));
      // положения по дням — недостаёт, если меньше половины дней
      const miss = need.filter((i) => (g.id === 'positions' ? i.score < 0.5 : !i.filled.includes(k)));
      if (!miss.length) continue;
      const [imp, why] = IMPACT[g.id]?.[k] ?? [0.4, ''];
      const share = miss.length / need.length;
      const label = g.labels[k] ?? k;
      const one = need.length === 1;
      const title = g.id === 'sources' ? miss.map((i) => i.title).join('; ')
        : one ? `${g.title}: ${label.toLowerCase()}`
        : `${label} — нет у ${miss.length} из ${need.length} ${UNIT[g.id] ?? ''}`.trim();
      out.push({
        id: `${g.id}:${k}`, group: g.id, title, missing: miss.length, total: need.length,
        why: why || `полнота группы «${g.title}»`,
        where: WHERE[g.id === 'formations' && k === 'path' ? 'formations_path' : g.id] ?? [],
        // сначала значимые (армии, корпуса), среди равных — с наименьшей полнотой
        queries: g.id === 'sources' ? [] : queriesFor(g, k, sorted(miss), period),
        items: sorted(miss).map((i) => i.title),
        priority: g.weight * imp * share * (g.id === 'positions' ? 1.5 : 1),
      });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** Подсказки списком (markdown). */
export function hintsMarkdown(h: SearchHint[], limit = 20): string {
  return h.slice(0, limit).map((x, i) => [
    `### ${i + 1}. ${x.title}`, '', `Зачем: ${x.why}.`, '',
    ...(x.where.length ? ['Где искать:', ...x.where.map((w) => `- ${w}`), ''] : []),
    ...(x.queries.length ? ['Запросы:', ...x.queries.map((q) => `- \`${q}\``), ''] : []),
    `Нет у: ${x.items.slice(0, 12).join('; ')}${x.items.length > 12 ? ` и ещё ${x.items.length - 12}` : ''}.`, '',
  ].join('\n')).join('\n');
}
