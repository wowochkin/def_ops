/**
 * Каркас базы знаний: категории (с подкатегориями) и поля, которые ожидаются у записи каждой
 * категории. Запись — краткое описание, разделы текста, факты (каждый — с источником и
 * достоверностью), связи с другими записями, статус проверки. Одно устройство служит и модели
 * (справка для штаба и советника), и обучению (раздел «Знания»).
 */

export type CategoryId = 'operations' | 'battles' | 'formations' | 'commanders' | 'organization' | 'equipment' | 'terrain' | 'chronology' | 'sources';

/** Поле записи категории: ключ факта, подпись, подсказка (для извлечения из документов). */
export interface FieldDef { key: string; title: string; hint?: string }

export interface CategoryDef {
  id: CategoryId;
  title: string;
  description: string;
  /** Подкатегории: значение поля group записи. */
  groups: { id: string; title: string }[];
  /** Ожидаемые факты записи — «каркас» для изучения и для извлечения из документов. */
  fields: FieldDef[];
  /** Можно ли подавать модели в игре как справку без пометки «история» (доктрина, техника, местность — да; ход боёв — нет). */
  gameSafe: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'operations', title: 'Операции', description: 'Стратегические и фронтовые операции: замысел, силы сторон, ход, итоги.', gameSafe: false,
    groups: [{ id: 'strategic', title: 'Стратегические' }, { id: 'front', title: 'Фронтовые и армейские' }],
    fields: [{ key: 'dates', title: 'Даты' }, { key: 'theatre', title: 'Театр' }, { key: 'sides', title: 'Стороны и объединения' }, { key: 'command', title: 'Командование' }, { key: 'goal', title: 'Замысел и задачи' }, { key: 'forces', title: 'Силы сторон' }, { key: 'outcome', title: 'Итог' }, { key: 'losses', title: 'Потери' }] },
  { id: 'battles', title: 'Сражения и бои', description: 'Отдельные сражения и бои внутри операций: место, участники, ход, исход.', gameSafe: false,
    groups: [{ id: 'breakthrough', title: 'Прорыв обороны' }, { id: 'encirclement', title: 'Окружение и котлы' }, { id: 'city', title: 'Бои в городе' }, { id: 'crossing', title: 'Форсирование рек' }, { id: 'other', title: 'Прочие' }],
    fields: [{ key: 'operation', title: 'Операция' }, { key: 'dates', title: 'Даты' }, { key: 'place', title: 'Место' }, { key: 'attacker', title: 'Наступающие' }, { key: 'defender', title: 'Обороняющиеся' }, { key: 'forces', title: 'Силы' }, { key: 'course', title: 'Ход' }, { key: 'outcome', title: 'Исход' }, { key: 'losses', title: 'Потери' }] },
  { id: 'formations', title: 'Формирования', description: 'Фронты, армии, корпуса, дивизии: подчинённость, состав, численность, командиры, боевой путь.', gameSafe: false,
    groups: [{ id: 'su', title: 'Красная армия и Войско Польское' }, { id: 'de', title: 'Вермахт и войска СС' }],
    fields: [{ key: 'side', title: 'Сторона' }, { key: 'echelon', title: 'Ступень' }, { key: 'parent', title: 'Подчинённость' }, { key: 'commander', title: 'Командир' }, { key: 'composition', title: 'Состав' }, { key: 'personnel', title: 'Численность' }, { key: 'tanks', title: 'Танки и САУ' }, { key: 'guns', title: 'Орудия и миномёты' }, { key: 'path', title: 'Боевой путь в операции' }] },
  { id: 'commanders', title: 'Командование', description: 'Командующие и начальники штабов: должность, звание, решения в операции.', gameSafe: false,
    groups: [{ id: 'su', title: 'Советские и польские' }, { id: 'de', title: 'Германские' }],
    fields: [{ key: 'side', title: 'Сторона' }, { key: 'rank', title: 'Звание' }, { key: 'post', title: 'Должность в операции' }, { key: 'years', title: 'Годы жизни' }, { key: 'decisions', title: 'Ключевые решения' }] },
  { id: 'organization', title: 'Организация и доктрина', description: 'Оргштатная структура, тактика и оперативное искусство сторон, управление, тыл.', gameSafe: true,
    groups: [{ id: 'su', title: 'Красная армия' }, { id: 'de', title: 'Вермахт' }, { id: 'model', title: 'Как это устроено в модели' }],
    fields: [{ key: 'side', title: 'Сторона' }, { key: 'topic', title: 'Тема' }, { key: 'principles', title: 'Положения' }, { key: 'numbers', title: 'Нормативы и числа' }] },
  { id: 'equipment', title: 'Вооружение и техника', description: 'Танки, САУ, артиллерия, стрелковое и противотанковое оружие: назначение и характеристики.', gameSafe: true,
    groups: [{ id: 'armor', title: 'Танки и САУ' }, { id: 'artillery', title: 'Артиллерия и реактивные системы' }, { id: 'infantry', title: 'Пехотное и противотанковое оружие' }, { id: 'air', title: 'Авиация' }],
    fields: [{ key: 'side', title: 'Сторона' }, { key: 'type', title: 'Тип' }, { key: 'armament', title: 'Вооружение' }, { key: 'armor', title: 'Броня' }, { key: 'weight', title: 'Масса' }, { key: 'speed', title: 'Скорость' }, { key: 'crew', title: 'Экипаж (расчёт)' }, { key: 'range', title: 'Дальность' }, { key: 'produced', title: 'Выпуск' }] },
  { id: 'terrain', title: 'Театр', description: 'Реки, высоты, леса, города, укреплённые рубежи: их значение для операций.', gameSafe: false,
    groups: [{ id: 'rivers', title: 'Реки и каналы' }, { id: 'lines', title: 'Рубежи и укрепления' }, { id: 'cities', title: 'Города и узлы' }, { id: 'areas', title: 'Районы местности' }],
    fields: [{ key: 'kind', title: 'Что это' }, { key: 'location', title: 'Где' }, { key: 'features', title: 'Особенности' }, { key: 'significance', title: 'Значение для операций' }] },
  { id: 'chronology', title: 'Хронология', description: 'События по датам.', gameSafe: false,
    groups: [{ id: 'berlin', title: 'Берлинская операция' }, { id: 'vistula', title: 'Висло-Одерская операция' }, { id: 'other', title: 'Прочее' }],
    fields: [{ key: 'date', title: 'Дата' }, { key: 'event', title: 'Событие' }, { key: 'place', title: 'Место' }] },
  { id: 'sources', title: 'Источники', description: 'Книги, документы, справочники, загруженные материалы — с оценкой достоверности.', gameSafe: true,
    groups: [{ id: 'books', title: 'Книги и справочники' }, { id: 'web', title: 'Интернет-источники' }, { id: 'uploaded', title: 'Загруженные документы' }],
    fields: [{ key: 'ref', title: 'Библиографическая запись' }, { key: 'reliability', title: 'Достоверность' }, { key: 'covers', title: 'О чём' }] },
];

export const category = (id: string) => CATEGORIES.find((c) => c.id === id);

/** Достоверность: A — официальные справочники и исследования; B — надёжные вторичные; C — оценка, черновик. */
export type Reliability = 'A' | 'B' | 'C';
export const RELIABILITY: Record<Reliability, string> = { A: 'официальный справочник, исследование', B: 'надёжный вторичный источник', C: 'оценка, черновик — требует проверки' };

export interface Fact {
  key: string;
  value: string;
  /** Источник: id записи-источника (категория sources) или документа; pages — страницы/место. */
  source?: string;
  pages?: string;
  reliability?: Reliability;
  /** Цитата из документа, на которой основан факт (для извлечённых). */
  quote?: string;
}

export type RelationType = 'part_of' | 'includes' | 'participant' | 'commanded_by' | 'commands' | 'located' | 'opponent' | 'related' | 'source';
export const RELATION_RU: Record<RelationType, string> = {
  part_of: 'входит в', includes: 'включает', participant: 'участники', commanded_by: 'командующий', commands: 'командовал',
  located: 'место', opponent: 'противник', related: 'см. также', source: 'источник',
};
export interface Relation { type: RelationType; target: string }

export type EntryStatus = 'checked' | 'draft' | 'extracted';
export const STATUS_RU: Record<EntryStatus, string> = { checked: 'проверено', draft: 'черновик — проверить', extracted: 'из документа — проверить' };

export interface Entry {
  id: string;
  category: CategoryId;
  group?: string;
  title: string;
  aliases?: string[];
  /** Краткое описание — 1–3 предложения. */
  summary: string;
  /** Разделы текста (markdown): заголовок и текст. */
  sections?: { title: string; text: string }[];
  facts?: Fact[];
  relations?: Relation[];
  /** Рубрики (коды рубрикатора, главная — первая); нет — вычисляются по категории (rubrics.ts). */
  rubrics?: string[];
  /** Период: даты ISO (для хронологии и фильтров). */
  period?: { from?: string; to?: string };
  /** Связь с переигровкой: сценарий и участок (для «показать на карте»). */
  scenario?: string;
  sector?: string;
  /** К каким операциям относится (id операций раздела «Моделирование»): материалы разбора их документов. Нет — по периоду и рубрикам (operations.ts). */
  operations?: string[];
  status: EntryStatus;
  /** Откуда запись: seed (начальная), user (добавлена/изменена человеком), document (из документа). */
  origin?: 'seed' | 'user' | 'document';
  updatedAt?: string;
}

/** Загруженный документ: текст, разбитый на части (для поиска и извлечения). */
export interface KbDocument {
  id: string;
  name: string;
  mime: string;
  size: number;
  addedAt: string;
  /** Достоверность, которую назначил человек при загрузке. */
  reliability: Reliability;
  note?: string;
  chunks: { i: number; text: string }[];
  status: 'new' | 'processing' | 'processed' | 'error';
  processed?: number;
  error?: string;
  /** Материал операции (id): разбор ищет и сведения об инфраструктуре, записи базы относятся к операции. */
  operation?: string;
  /** Итоги разбора: что извлечено (по частям — сумма). */
  extracted?: { entries: number; updates: number; infra: number; dropped: number };
}

/** Предложение изменить базу (из документа): новая запись или дополнение существующей. */
export interface Proposal {
  id: string;
  doc: string;
  chunk: number;
  kind: 'new' | 'update';
  /** Для update — id записи; для new — предлагаемая запись. */
  target?: string;
  entry: Entry;
  /** Новые факты и связи (для update — только они). */
  facts: Fact[];
  relations: Relation[];
  /** Новые рубрики (для update). */
  rubrics?: string[];
  /** Операция документа: принятая запись относится к ней. */
  operation?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

/** Сведение об инфраструктуре из документа (мост, переправа, дорога, железная дорога, рубеж) — с цитатой. */
export interface InfraItem {
  kind: 'bridge' | 'crossing' | 'road' | 'rail' | 'line' | 'other';
  state: 'destroyed' | 'damaged' | 'intact' | 'built' | 'repaired' | 'blocked' | 'mined' | 'impassable' | 'fortified';
  title: string;
  place: string | null;
  river: string | null;
  date: string | null;
  dateTo: string | null;
  side: string | null;
  note: string | null;
  quote: string;
}
/** Предложение добавить сведение об инфраструктуре в операцию (проверяет человек). */
export interface InfraProposal {
  id: string; doc: string; docName: string; chunk: number; operation: string; reliability: Reliability;
  item: InfraItem;
  status: 'pending' | 'accepted' | 'rejected';
}
