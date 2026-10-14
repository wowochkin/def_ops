/**
 * Задание для внешнего агента (с браузером и скиллом «Память народа»): чего базе знаний не хватает для операции
 * и в каком виде вернуть ответ. Пробелы — из compileOperation: входы-допущения (численность, подчинённость) и
 * соединения без фактов положения и потерь; подсказки «где искать» — из coverageHints. Ответ — пакет фактов
 * def-ops-facts (столбцы — TEMPLATE_COLUMNS, см. docs/facts-template.md).
 */
import type { Claim } from './schema';
import type { CompileResult } from './compile';
import { TEMPLATE_COLUMNS } from './tables';
import { hintsMarkdown, type SearchHint } from './hints';

export interface OperationGap { formation: string; name: string; kinds: Claim['kind'][] }

const KIND_ORDER: Claim['kind'][] = ['strength', 'parent', 'position', 'losses'];
const KIND_LABEL: Partial<Record<Claim['kind'], string>> = { strength: 'численность', parent: 'подчинённость', position: 'положение', losses: 'потери' };

/**
 * Что у соединения операции держится на допущении или отсутствует в базе.
 * names — id → название соединений операции; вызывающий выбирает их сам (армии, корпуса): пробелы положения
 * и потерь считаются для каждого переданного id. */
export function operationGaps(compiled: Pick<CompileResult, 'provenance'>, names: Map<string, string>): OperationGap[] {
  const kinds = new Map<string, Set<Claim['kind']>>();
  const add = (id: string, k: Claim['kind']) => { if (names.has(id)) (kinds.get(id) ?? kinds.set(id, new Set()).get(id)!).add(k); };
  // у кого в выбранных фактах уже есть положение или потери
  const has = { position: new Set<string>(), losses: new Set<string>() };
  for (const p of compiled.provenance) {
    const c = p.fact?.fact.claim;
    if (c && (c.kind === 'position' || c.kind === 'losses')) has[c.kind].add(c.subject);
    const m = /^(.+)\.(personnel|tanks|guns|parent)$/.exec(p.input);
    if (m && !p.fact) add(m[1], m[2] === 'parent' ? 'parent' : 'strength');
  }
  for (const id of names.keys()) {
    if (!has.position.has(id)) add(id, 'position');
    if (!has.losses.has(id)) add(id, 'losses');
  }
  return [...kinds].map(([formation, ks]) => ({ formation, name: names.get(formation)!, kinds: KIND_ORDER.filter((k) => ks.has(k)) }))
    .sort((a, b) => b.kinds.length - a.kinds.length || a.name.localeCompare(b.name, 'ru'));
}

const EXAMPLE = {
  format: 'def-ops-facts', version: 1,
  source: { title: 'Журнал боевых действий (вымышленный пример)', ref: 'Условный фонд, оп. 1, д. 1', reliability: 'A' },
  facts: [
    { kind: 'strength', subject: 'Условная 1-я армия', date: '1945-04-16', personnel: 52000, tanks: 310, guns: 640, ref: 'Условный фонд, оп. 1, д. 1, л. 12', pages: 'л. 12', quote: 'в армии 52000 человек, 310 танков' },
    { kind: 'position', subject: 'Условная 1-я армия', date: '1945-04-17', place: 'Условные Холмы', lat: 52.45, lon: 14.6, approx_km: 12.5, ref: 'Условный фонд, оп. 1, д. 1, л. 15' },
  ],
};

const ru = (d: string) => d.split('-').reverse().join('.');

export function agentTask(op: { id: string; title: string; start: string; end: string }, gaps: OperationGap[], hints: SearchHint[]): string {
  const day = (s: string) => ru(s.slice(0, 10));
  const rows = gaps.map((g) => `| ${g.name} | ${g.kinds.map((k) => KIND_LABEL[k] ?? k).join(', ')} |`);
  return [
    `# Задание: данные для операции «${op.title}»`,
    '',
    `Задание для агента с браузером и скиллом \`/pamyat-naroda\` (портал «Память народа» открывается только в браузере, капчу проходит пользователь). Операция: «${op.title}», ${day(op.start)} — ${day(op.end)}.`,
    '',
    '## Зачем',
    '',
    'База знаний питает модель переигровки: начальные численности, подчинённость, положения по дням и потери берутся из фактов базы. Где факта нет, модель опирается на допущение и хуже сходится с историей. Ваши находки загружаются в базу как факты с шифром документа и заменяют допущения.',
    '',
    '## Что найти',
    '',
    gaps.length ? `Соединения, по которым в базе нет фактов (${gaps.length}); по убыванию числа пробелов.` : 'Пробелов по соединениям не найдено — ищите по подсказкам ниже.',
    '',
    ...(gaps.length ? ['| Соединение | Чего не хватает |', '|---|---|', ...rows, ''] : []),
    '## Где искать',
    '',
    hints.length ? hintsMarkdown(hints, 12) : 'Подсказок нет: ищите журналы боевых действий, оперативные сводки и отчёты по операции в разделе «Документы» портала.',
    '',
    '## Общие правила',
    '',
    '- **Источник — только документ.** Каждый факт — из конкретного документа: фонд, опись, дело, лист, ссылка на карточку. Книги и справочники сюда не вносить.',
    '- **Тексты не переписывать.** Пересказ своими словами — не длиннее 300 знаков. Цитата (`quote`) — не длиннее 25 слов, только если без неё теряется смысл.',
    '- **Скачивание.** Сканы скачивать только после согласия пользователя: перечислить документ, шифр и число листов. В репозиторий сканы не попадают.',
    '- **Неторопливо.** Один запрос за раз. Капчу проходит пользователь, агент её не обходит.',
    '- **Координаты.** WGS84, `lat` и `lon` с 2–4 знаками. `approx_km` — радиус неопределённости: пункт найден точно — 2–3 км; рубеж из нескольких пунктов — половина его длины; район — его радиус. Не нашли пункт на карте — `lat` и `lon` пустые, а в `place` — название так, как оно написано в документе; пояснения — в `note`. Немецкие названия давать вместе с польскими.',
    '- **Время.** Дата — `ГГГГ-ММ-ДД`. Время суток, если важно, — как в документе («19.00», «к исходу дня») — в `quote` (для события — в `title`, для переправы — рядом со словом состояния в `state`). Если документ изложен по периодам, написать об этом в `quote` или `title`. Поле `note` занято: у переправы (`crossing`) в нём состояние, у события (`event`) — название.',
    '- **Числа не пересчитывать.** Что сказано («до 4000», «около полка»), то и вносить; своя оценка — только в `quote` или `note` (кроме переправ и событий) с пометкой «оценка агента».',
    '- **Пустой результат — тоже результат.** Перечислите просмотренные документы (шифр, листы) и что в них не нашлось.',
    '',
    '## Формат ответа',
    '',
    `Один JSON-файл в кодировке UTF-8 — пакет фактов \`def-ops-facts\` версии 1: \`source\` с ключами \`title\` (название документа), \`ref\` (шифр: фонд, опись, дело) и \`reliability\` (A, B или C) и список \`facts\`. Поля факта — столбцы шаблона: ${TEMPLATE_COLUMNS.map((c) => `\`${c}\``).join(', ')}. Вместо \`subject\`, \`place\` и \`note\` допустимы естественные ключи: \`between\` и \`points\` (разграничительная линия), \`state\` (состояние переправы), \`title\` (название события). Виды (\`kind\`): \`strength\`, \`reinforce\`, \`losses\`, \`parent\`, \`enter\`, \`position\`, \`boundary\`, \`crossing\`, \`event\`. Что обязательно по видам — в \`docs/facts-template.md\`. \`ref\` — ключ факта вне столбцов шаблона: шифр документа с листом; указывайте его у каждого факта.`,
    '',
    'Пример (значения вымышленные):',
    '',
    '```json',
    JSON.stringify(EXAMPLE, null, 2),
    '```',
    '',
    'Отдельным файлом (он в базу не загружается) — перечень просмотренных документов и непокрытых соединений.',
    '',
  ].join('\n');
}
