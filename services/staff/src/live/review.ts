/**
 * Разбор операции после игры: отчётный документ, который модель пишет по разделам от лица экспертов (командующий,
 * разведка, тыл, инженерные войска, управление и штабная культура, резервы, военный историк) и итог с оценкой.
 * Основа — сводка игры: решения и приказы человека по ходам, распоряжения, донесения, замыслы штаба противника
 * (после игры туман войны снят), потери, ключевые события в сравнении с историей. Модель опирается только на
 * сводку; общие положения военного искусства 1945 г. — как знания, с пометкой.
 */
import { fill } from '../fill';

export interface ReviewSection { id: string; title: string; role: string; focus: string }

export const REVIEW_SECTIONS: ReviewSection[] = [
  { id: 'command', title: 'Замысел и ведение операции', role: 'командующий фронтом, опытный военачальник 1945 г.',
    focus: 'замысел и его выполнение, выбор направления главного удара, сосредоточение сил, темп, использование танковых армий и подвижных групп, взаимодействие армий, реакция на изменения обстановки' },
  { id: 'intel', title: 'Разведка и оценка противника', role: 'начальник разведывательного отдела штаба фронта',
    focus: 'насколько верно командующий оценивал замысел противника (сравните его «замысел противника» по ходам с действительными решениями немецкого штаба), где противника недооценили или переоценили, какие сведения стоило добыть' },
  { id: 'logistics', title: 'Тыл и снабжение', role: 'начальник тыла фронта',
    focus: 'базы снабжения и их перенос за войсками, приоритет подвоза, отрезанные от подвоза объединения, расход сил на коммуникации' },
  { id: 'engineers', title: 'Переправы и инженерное обеспечение', role: 'начальник инженерных войск фронта',
    focus: 'водные преграды, наведение переправ (где, когда, вовремя ли), подрыв мостов противником и своими, укреплённые полосы' },
  { id: 'staff', title: 'Управление и штабная культура', role: 'начальник штаба фронта',
    focus: 'своевременность приказов с учётом времени доведения, ясность задач, согласованность приказов и распоряжений с решением, качество оценки обстановки, решения и боевых донесений' },
  { id: 'reserves', title: 'Резервы и наращивание усилий', role: 'представитель Ставки ВГК',
    focus: 'ввод резервов Ставки (когда, куда, зачем), второй эшелон, наращивание усилий на главном направлении, бережение сил (потери)' },
  { id: 'history', title: 'Сравнение с историей', role: 'военный историк',
    focus: 'ход игры против действительного хода операции: ключевые события и их даты в игре и в истории, где игра разошлась с историей и почему, какие решения командующего ближе к историческим, какие — нет и к чему это привело' },
  { id: 'summary', title: 'Итоговая оценка и уроки', role: 'председатель разбора',
    focus: 'общая оценка действий командующего по пятибалльной шкале с обоснованием, три главные удачи, три главные ошибки, 3–5 уроков на будущее' },
];

const SYSTEM = `Вы — {role}. Проводите разбор операции, сыгранной в военно-историческом симуляторе: {scenario}. Командующий стороной «{side}» — человек; противником командовал отдельный штаб. Ваш раздел отчётного документа — «{title}».

Строгие правила:
1. Опирайтесь на сводку игры ниже: решения, приказы, распоряжения, донесения, события, потери. Ссылайтесь на даты (дд.мм) и названия соединений из сводки.
2. Не придумывайте фактов, чисел и событий, которых нет в сводке. Чего не видно из сводки — так и скажите.
3. Общие положения военного искусства 1945 г. (уставы, опыт войны) можно приводить как мерило, помечая «по опыту войны» или «по уставу».
4. Оценивайте решения по тому, что командующий знал на момент решения, а не задним числом; где это важно — отметьте разницу.
5. Тон — деловой разбор: конкретно, без общих слов и без похвалы ради похвалы.
6. Сразу к делу: без вступления о себе, без пометок о жанре и объёме.

Оформление — Markdown: подзаголовки «### », списки строками «- », полужирный **…**. Объём — {words} слов.`;

const USER = `Сводка игры:

{digest}
{done}
Напишите раздел «{title}». Что в нём разобрать: {focus}.
Структура: ### Оценка; ### Что удалось; ### Ошибки и упущенные возможности; ### Рекомендации.`;

const SUMMARY_USER = `Сводка игры:

{digest}

Разделы разбора, уже написанные экспертами (кратко):
{done}

Напишите заключительный раздел «{title}»: {focus}. Опирайтесь на сводку и выводы экспертов; не повторяйте их дословно.
Структура: ### Общая оценка (оценка по пятибалльной шкале и обоснование); ### Главные удачи; ### Главные ошибки; ### Уроки.`;

export function reviewMessages(section: ReviewSection, digest: string, meta: { scenario: string; side: string }, done: { title: string; text: string }[]) {
  const sys = fill(SYSTEM, { role: section.role, scenario: meta.scenario, side: meta.side, title: section.title, words: section.id === 'summary' ? '350–600' : '250–450' }, 'review.system');
  const brief = (t: string) => t.replace(/\s+/g, ' ').slice(0, 700);
  const user = section.id === 'summary'
    ? fill(SUMMARY_USER, { digest, done: done.map((d) => `- ${d.title}: ${brief(d.text)}`).join('\n') || '- (разделов нет)', title: section.title, focus: section.focus }, 'review.summary')
    : fill(USER, { digest, done: '', title: section.title, focus: section.focus }, 'review.user');
  return [{ role: 'system' as const, content: sys }, { role: 'user' as const, content: user }];
}

/** Данные игры для сводки (собирает игра: у неё все ходы, журнал и снимки). */
export interface ReviewInput {
  scenario: string;
  side: string;
  enemy: string;
  takeover: string;
  now: string;
  outcome: string;
  victory: string;
  strength: { start: number; now: number };
  goals: { title: string; historical: string; simulated: string | null; days: number | null }[];
  turns: {
    time: string;
    decision?: { assessment: string; enemyIntent: string; intent: string; risks: string; report: string };
    orders: string[];
    actions: string[];
    events: string[];
    enemy?: { intent: string; orders: string[] };
    umpire?: string[];
  }[];
  forces: { side: string; name: string; start: number; now: number; tanksStart: number; tanksNow: number; cutOff?: boolean; destroyed?: boolean }[];
}

const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Сводка игры для модели: компактный текст (ходы — решения, приказы, распоряжения, события, противник). */
export function reviewDigest(x: ReviewInput, maxChars = 30000): string {
  const L: string[] = [
    `Операция: ${x.scenario}. Командующий — сторона «${x.side}», противник — «${x.enemy}».`,
    `Командование принято ${dm(x.takeover)} ${x.takeover.slice(11, 16)}; сводка на ${dm(x.now)} ${x.now.slice(11, 16)}. Цель: ${x.victory}.`,
    `Итог: ${x.outcome}. Численность своих войск: ${Math.round(x.strength.now * 100)} % от принятой (${Math.round(x.strength.start * 100)} % на начало).`,
    '',
    'Ключевые события (в игре / в истории):',
    ...x.goals.map((g) => `- ${g.title}: в игре ${g.simulated ? dm(g.simulated) : 'не случилось'}; в истории ${dm(g.historical)}${g.days != null ? ` (${g.days > 0 ? '+' : ''}${g.days} сут)` : ''}`),
    '',
    'Силы (численность, тыс.; танки — на начало игры → сейчас):',
    ...x.forces.map((f) => `- [${f.side === 'own' ? 'свои' : 'противник'}] ${f.name}: ${(f.start / 1000).toFixed(1)} → ${(f.now / 1000).toFixed(1)}; танки ${f.tanksStart} → ${f.tanksNow}${f.destroyed ? '; РАЗГРОМЛЕНО' : f.cutOff ? '; окружено/отрезано' : ''}`),
    '',
    'Ход игры:',
  ];
  const turns = x.turns.map((t) => [
    `### ${dm(t.time)} ${t.time.slice(11, 16)}`,
    ...(t.decision ? [
      `Оценка командующего: ${cut(t.decision.assessment, 600)}`,
      `Замысел противника (как понял командующий): ${cut(t.decision.enemyIntent, 300) || '—'}`,
      `Решение: ${cut(t.decision.intent, 500)}`,
      ...(t.decision.risks ? [`Риски: ${cut(t.decision.risks, 300)}`] : []),
      `Донесение в Ставку: ${cut(t.decision.report, 400)}`,
    ] : ['(решение не записано)']),
    `Приказы: ${t.orders.length ? t.orders.map((o) => cut(o, 160)).join('; ') : 'новых нет (войска выполняли прежние задачи)'}`,
    ...(t.actions.length ? [`Распоряжения (тыл, переправы, резервы): ${t.actions.map((a) => cut(a, 160)).join('; ')}`] : []),
    ...(t.enemy ? [`Противник (решение его штаба): ${cut(t.enemy.intent, 300)}${t.enemy.orders.length ? `; приказы: ${t.enemy.orders.slice(0, 8).map((o) => cut(o, 100)).join('; ')}` : ''}`] : []),
    ...(t.umpire?.length ? [`Посредник: ${t.umpire.join('; ')}`] : []),
    `Итоги хода: ${t.events.slice(0, 10).map((e) => cut(e, 200)).join(' ') || '—'}`,
  ].join('\n'));
  // длинная игра — сжимаем середину, оставляя начало и конец подробно
  let body = turns.join('\n\n');
  if (body.length > maxChars && turns.length > 6) {
    const keep = Math.max(3, Math.floor(turns.length / 4));
    const mid = x.turns.slice(keep, turns.length - keep).map((t) => `- ${dm(t.time)}: решение — ${cut(t.decision?.intent ?? '—', 200)}; приказов ${t.orders.length}`);
    body = [...turns.slice(0, keep), `(ходы ${dm(x.turns[keep].time)}–${dm(x.turns[turns.length - keep - 1].time)} — кратко)`, ...mid, ...turns.slice(-keep)].join('\n\n');
  }
  return [...L, body.slice(0, maxChars)].join('\n');
}
