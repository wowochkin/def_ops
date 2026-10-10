/**
 * Подставная модель для проверки игры без LM Studio: сервер по протоколу OpenAI
 * (/v1/models, /v1/chat/completions, поток SSE), который читает обстановку из
 * промпта и отвечает простым, но правдоподобным решением: держать участок,
 * контратаковать ближайшего противника, отвести ослабленных, прорываться из
 * окружения. Только для проверки стенда — военной ценности не имеет.
 *
 *   npm run llm:mock            # http://localhost:1234/v1, как LM Studio
 */
import { createServer, type Server } from 'node:http';
import type { Decision, Order } from '../decision';

function section(text: string, head: RegExp): string[] {
  const i = text.search(head);
  if (i < 0) return [];
  const rest = text.slice(i).split('\n').slice(1);
  const out: string[] = [];
  for (const l of rest) { if (!l.trim()) break; if (l.startsWith('- ')) out.push(l.slice(2)); }
  return out;
}

export function mockDecision(prompt: string): Decision {
  const own = section(prompt, /^Свои силы/m).filter((l) => !/прибывает/.test(l));
  const areas = section(prompt, /^Пункты вблизи войск/m).map((l) => l.split(' — ')[0]);
  const enemy = section(prompt, /^Противник/m).filter((l) => !/не обнаружен/.test(l)).map((l) => l.split(' — ')[0]);
  const name = (l: string) => l.split(/ \[| — /)[0];
  const placeOf = (l: string) => {
    const m = / — (?:у (.+?)|[\d,]+ км к \S+ от (.+?));/.exec(l);
    const p = m?.[1] ?? m?.[2];
    return p && areas.includes(p) ? p : areas[0];
  };
  const rear = areas[areas.length - 1] ?? areas[0];
  const orders: Order[] = [];
  for (const l of own) {
    if (orders.length >= 4) break;
    const n = name(l), strength = Number(/состав (\d+) %/.exec(l)?.[1] ?? 100);
    if (/ОТРЕЗАНО/.test(l)) orders.push({ formation: n, task: 'breakout', area: placeOf(l), toArea: rear, deadline: 'в ночь', details: 'прорываться к своим, тяжёлое вооружение уничтожить' });
    else if (strength < 45) orders.push({ formation: n, task: 'withdraw', area: placeOf(l), toArea: rear, deadline: 'к утру', details: 'отойти, привести себя в порядок' });
    else if (/танк|панцер|Panzer|«Мюнхеберг»|«Курмарк»/i.test(n) && enemy.length && !orders.some((o) => o.task === 'counterattack')) orders.push({ formation: n, task: 'counterattack', area: enemy[0], toArea: null, deadline: 'с рассветом', details: 'контрудар во фланг вклинившемуся противнику' });
    else if (/обороняется/.test(l)) orders.push({ formation: n, task: 'hold', area: placeOf(l), toArea: null, deadline: 'до особого распоряжения', details: 'удерживать рубеж' });
  }
  if (!orders.length && own.length) orders.push({ formation: name(own[0]), task: 'defend', area: placeOf(own[0]), toArea: null, deadline: 'до особого распоряжения', details: 'оборонять занимаемый рубеж' });
  return {
    assessment: `Подставная модель (проверка стенда). Своих соединений в обстановке: ${own.length}, обнаружено соединений противника: ${enemy.length}. `
      + 'Противник продолжает наступление на главном направлении; наши войска ослаблены, подвоз нарушен. Решение — удерживать ключевые пункты, '
      + 'подвижными соединениями наносить контрудары по вклинившемуся противнику, отводить обескровленные части, окружённым — прорываться к своим.',
    enemyIntent: 'Прорвать оборону на главном направлении и обойти узлы сопротивления подвижными соединениями.',
    intent: 'Удерживать рубеж, контратаковать вклинившегося противника, сохранить боеспособность ослабленных частей.',
    orders,
    ...(/поле actions \(может быть пустым\)/.test(prompt) ? { actions: own.length >= 2 ? [{ kind: 'priority' as const, subject: null, area: null, formations: own.slice(0, 2).map(name) }] : [] } : { actions: [] }),
    requests: ['Прошу разрешения на отвод обескровленных частей на тыловой рубеж.'],
    risks: ['Контрудар без поддержки авиации может не достичь цели.', 'Отвод частей может открыть фланг соседа.'],
  };
}

/**
 * Ставка (проверка стенда): если есть образец — историческая директива — линия по её пунктам, которые есть в
 * списке пунктов; если образца нет, а есть ходатайство — линия по первым двум пунктам списка; иначе — оставить.
 */
export function mockStavka(prompt: string) {
  const places = section(prompt, /^Пункты \(в линиях/m);
  const fronts = section(prompt, /^Фронты и их войска/m).map((l) => l.split(' (')[0]);
  const pattern = section(prompt, /^Образец/m)[0];
  const request = section(prompt, /^Повод обратиться/m).find((l) => /^Ходатайство/.test(l));
  const lc = (x: string) => x.toLowerCase();
  if (pattern) {
    const [pairText, rest] = pattern.split(': ');
    const base = (x: string) => lc(x.replace(/\s*\(.*\)\s*$/, ''));
    const pts = (rest ?? '').replace(/ \(в истории.*$/, '').split(' — ').map((p) => places.find((q) => base(q) === base(p))).filter((x): x is string => !!x);
    const use = pts.length >= 2 ? pts : places.slice(0, 2);
    return { assessment: 'Подставная Ставка (проверка стенда): обстановка разошлась с историей.', decision: 'issue', lines: [{ between: pairText.split(' / '), points: use, delayHours: 6, reason: 'по образцу исторической директивы' }], reply: `Установить разграничительную линию: ${use.join(', ')}.` };
  }
  if (request && fronts.length >= 2 && places.length >= 2) return { assessment: 'Подставная Ставка: ходатайство рассмотрено.', decision: 'issue', lines: [{ between: fronts.slice(0, 2), points: places.slice(0, 2), delayHours: 6, reason: 'по ходатайству' }], reply: `По ходатайству: линия ${places.slice(0, 2).join(', ')}.` };
  return { assessment: 'Подставная Ставка: оснований менять линии нет.', decision: 'keep', lines: [], reply: 'Разграничительные линии оставить прежние.' };
}

/** Ответ советника (проверка стенда): эхо вопроса, сводка по обстановке, одно предложение приказа и следующие вопросы. */
export function mockAdvice(prompt: string) {
  const own = section(prompt, /^Свои силы/m).filter((l) => !/резерв Ставки|прибывает/.test(l));
  const areas = section(prompt, /^Пункты вблизи войск/m).map((l) => l.split(' — ')[0]);
  const enemy = section(prompt, /^Противник/m).filter((l) => !/не обнаружен/.test(l)).map((l) => l.split(' — ')[0]);
  const q = /Вопрос командующего: (.*)/.exec(prompt)?.[1] ?? '';
  const cat = /Категория вопроса: (.*)\./.exec(prompt)?.[1] ?? '';
  const name = (l: string) => l.split(/ \[| — /)[0];
  const weak = own.filter((l) => /ОТРЕЗАНО|состав [1-5]\d %/.test(l)).map(name);
  return {
    answer: `Подставной советник (проверка стенда). Категория: ${cat}. Вопрос: «${q}».\n\nВ строю ${own.length} объединений, противник обнаружен: ${enemy.length} соединений.${weak.length ? `\n\nТребуют внимания:\n${weak.map((w) => `- ${w}`).join('\n')}` : ''}\n\nРекомендую сосредоточить усилия на главном направлении и не растягивать коммуникации.`,
    basis: ['доклады', 'разведка'],
    unknowns: ['положение резервов противника за пределами разведки'],
    suggestions: own.length && areas.length ? [{ formation: name(own[0]), task: enemy.length ? 'attack' : 'regroup', area: enemy[0] ?? areas[0], toArea: enemy.length ? null : areas[0], why: 'поддержать главный удар' }] : [],
    followUps: ['Где противник может нанести контрудар?', 'Каким армиям не хватает подвоза?', 'Как быстрее выйти к цели операции?'],
  };
}

/** Варианты решения на ход (проверка стенда): решительный, осторожный, манёвренный — из обстановки в промпте. */
export function mockPlan(sys: string, prompt: string) {
  const own = section(prompt, /^Свои силы/m).filter((l) => !/резерв Ставки|прибывает/.test(l));
  const areas = section(prompt, /^Пункты вблизи войск/m).map((l) => l.split(' — ')[0]);
  const enemy = section(prompt, /^Противник/m).filter((l) => !/не обнаружен/.test(l)).map((l) => l.split(' — ')[0]);
  const name = (l: string) => l.split(/ \[| — /)[0];
  const n = /— один вариант/.test(sys) ? 1 : Number(/— (\d) заметно разных/.exec(sys)?.[1] ?? 2);
  const f = own.map(name), a0 = areas[0] ?? '', a1 = areas[1] ?? a0, e0 = enemy[0] ?? a0;
  const base = { assessment: `Подставной советник (проверка стенда). В строю ${own.length} объединений, обнаружено соединений противника: ${enemy.length}. Подвоз в целом обеспечен.`, enemyIntent: 'Предположение: противник удерживает рубежи и подтягивает резервы.', report: 'Войска фронта выполняют поставленную задачу. Противник оказывает упорное сопротивление. Подвоз обеспечен.' };
  const all = [
    { title: 'Решительный удар', idea: 'Все силы — на главное направление, темп важнее флангов.', ...base, intent: `Главный удар нанести на ${e0}; остальным — сковать противника на фронте.`, risks: 'Открытые фланги; отставание подвоза.',
      orders: f.slice(0, 3).map((x, i) => ({ formation: x, task: i === 0 ? 'attack' : 'attack', area: i === 0 ? e0 : a0, toArea: null, why: i === 0 ? 'главный удар' : 'поддержать главный удар' })),
      actions: f.length >= 2 ? [{ kind: 'priority', subject: null, area: null, formations: f.slice(0, 1) }] : [] },
    { title: 'Закрепиться и подтянуть тылы', idea: 'Пауза на сутки: закрепить достигнутое, подтянуть подвоз.', ...base, intent: `Закрепиться на достигнутых рубежах у ${a0}, привести войска в порядок.`, risks: 'Противник выиграет время на создание обороны.',
      orders: f.slice(0, 2).map((x) => ({ formation: x, task: 'defend', area: a0, toArea: null, why: 'закрепить достигнутое' })), actions: [] },
    { title: 'Обход узла обороны', idea: 'Не штурмовать в лоб — обойти и отрезать.', ...base, intent: `Сковать противника у ${a0}, подвижными соединениями выйти к ${a1}.`, risks: 'Растяжение коммуникаций.',
      orders: f.slice(0, 2).map((x, i) => ({ formation: x, task: i ? 'regroup' : 'attack', area: i ? a0 : e0, toArea: i ? a1 : null, why: i ? 'выйти во фланг' : 'сковать с фронта' })), actions: [] },
  ];
  return { variants: f.length ? all.slice(0, n) : [] };
}

/** Извлечение для базы знаний (проверка стенда): предложения с датами или числами — факты с дословной цитатой. */
export function mockExtract(prompt: string, infra = false) {
  const text = prompt.split(/Фрагмент:\n\n/)[1] ?? '';
  const out = mockExtractItems(text);
  return infra ? { ...out, infrastructure: mockInfra(text), positions: mockPositions(text), boundaries: mockBoundaries(text) } : out;
}

/** Положения формирований (проверка стенда): «… армия/корпус … вышла к/у/в … 22 апреля». */
export function mockPositions(text: string) {
  const months: Record<string, string> = { января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05' };
  const out = [];
  for (const q of text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 20 && x.length < 240)) {
    const f = /(\d+-(?:я|й) (?:гвардейск(?:ая|ий) |ударн(?:ая|ый) |танков(?:ая|ый) )*(?:армия|корпус|дивизия))/.exec(q)?.[1];
    const d = /(\d{1,2})\s+(января|февраля|марта|апреля|мая)/.exec(q);
    const place = /(?:вышл[аи]? к|у|в районе|в|достиг(?:ла|ли)?)\s+([А-ЯЁ][а-яё]+)/.exec(q)?.[1]?.replace(/(у|а|е)$/, '');
    if (!f || !d || !place) continue;
    out.push({ formation: f, date: `1945-${months[d[2]]}-${d[1].padStart(2, '0')}`, place, note: null, quote: q });
  }
  return out;
}

/** Разграничительные линии (проверка стенда): «… разграничительную линию … фронтами: до X прежняя и далее A, B, C». */
export function mockBoundaries(text: string) {
  const months: Record<string, string> = { января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05' };
  const out = [];
  for (const q of text.split(/(?<=[.!?])\s+(?=[А-ЯЁ0-9])/).map((x) => x.trim()).filter((x) => x.length > 30 && x.length < 400)) {
    if (!/разграничительн/i.test(q)) continue;
    const fronts = [...q.matchAll(/(\d+)-(?:м|го|й)\s+(Белорусск|Украинск)\S*/g)].map((m) => `${m[1]}-й ${m[2]}ий фронт`);
    if (fronts.length === 1) fronts.unshift('адресат директивы');
    const tail = /(?:далее|затем)\s+([^.]+)/.exec(q)?.[1] ?? '';
    const points = tail.split(/,\s*|\s+и\s+далее\s+/).map((x) => x.replace(/^(по железной дороге до)\s+/, '').trim()).filter((x) => /^[А-ЯЁ]|^(оз|ст)\./.test(x));
    const d = /(\d{1,2})[. ](\d{1,2}|января|февраля|марта|апреля|мая)/.exec(q);
    const date = d ? `1945-${(months[d[2]] ?? d[2]).padStart(2, '0')}-${d[1].padStart(2, '0')}` : null;
    if (fronts.length < 2 || points.length < 2) continue;
    out.push({ between: fronts.slice(0, 2), date, dateTo: null, points, inclusive: null, note: /прежняя/.test(q) ? 'начало линии — прежнее' : null, quote: q });
  }
  return out;
}

/** Сведения об инфраструктуре (проверка стенда): предложения о мостах, переправах, дорогах с глаголом состояния. */
export function mockInfra(text: string) {
  const months: Record<string, string> = { января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05' };
  const STATE: [RegExp, string][] = [[/взорван|разрушен|уничтожен/, 'destroyed'], [/наведен|навели|построен/, 'built'], [/восстановлен/, 'repaired'], [/заминирован/, 'mined'], [/завал|баррикад|перекрыт/, 'blocked'], [/захвачен цел|уцелел/, 'intact'], [/поврежд/, 'damaged']];
  const out = [];
  for (const q of text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 20 && x.length < 240)) {
    const kind = /переправ/i.test(q) ? 'crossing' : /мост/i.test(q) ? 'bridge' : /железн/i.test(q) ? 'rail' : /дорог|шоссе|улиц/i.test(q) ? 'road' : null;
    const st = STATE.find(([re]) => re.test(q.toLowerCase()));
    if (!kind || !st) continue;
    const place = /(?:у|под|в районе|в|около|близ)\s+([А-ЯЁ][а-яё]+)/.exec(q)?.[1]?.replace(/(а|ом|е|у)$/, '') ?? null;
    const river = /через\s+([А-ЯЁ][а-яё]+)/.exec(q)?.[1]?.replace(/у$/, 'а') ?? null;
    const d = /(\d{1,2})\s+(января|февраля|марта|апреля|мая)(?:\s+(1945))?/.exec(q);
    out.push({ kind, state: st[1], title: q.split(/[,.]/)[0].slice(0, 80), place, river, date: d ? `1945-${months[d[2]]}-${d[1].padStart(2, '0')}` : null, dateTo: null, side: null, note: null, quote: q });
  }
  return out;
}

function mockExtractItems(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 20 && x.length < 220);
  const pick = sentences.filter((x) => /\d/.test(x)).slice(0, 4);
  if (!pick.length) return { items: [] };
  const name = /([А-ЯЁ][а-яё]+(?:ая|ский|ое)? (?:операция|сражение|бой|армия|корпус|дивизия))/.exec(text)?.[1] ?? `Сведения: ${pick[0].split(/\s+/).slice(0, 4).join(' ')}`;
  const cat = /операци/.test(name) ? 'operations' : /сражени|бой/.test(name) ? 'battles' : /арми|корпус|дивизи/.test(name) ? 'formations' : 'chronology';
  const key = ({ operations: 'outcome', battles: 'course', formations: 'path' } as Record<string, string>)[cat] ?? 'event';
  const date = /(\d{1,2})\s+(января|февраля|марта|апреля|мая)\s+(1945)/.exec(text);
  const months: Record<string, string> = { января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05' };
  const iso = date ? `${date[3]}-${months[date[2]]}-${date[1].padStart(2, '0')}` : null;
  return { items: [{ category: cat, rubrics: [/Одер|Нейсе|Зеелов/.test(text) ? '1.2.2' : '1.2'], title: name, aliases: [], summary: pick[0], facts: pick.map((q) => ({ key, value: q.replace(/[.!?]$/, ''), quote: q })), relations: [], dateFrom: iso, dateTo: null }] };
}

/** Ответ по материалам базы знаний (проверка стенда): пересказ первых материалов со ссылками. */
export function mockKbAnswer(prompt: string): string {
  const mats = [...prompt.matchAll(/^\[(\d+)\] (.+)\n(.+)/gm)].slice(0, 3);
  const topic = /Расскажите по теме «(.+?)»/.exec(prompt)?.[1] ?? /Вопрос: (.*)/.exec(prompt)?.[1] ?? '';
  if (!mats.length) return `Подставная модель (проверка стенда). В базе знаний об этом нет сведений: «${topic}».`;
  return `Подставная модель (проверка стенда). По запросу «${topic}»:\n\n${mats.map(([, n, t, x]) => `- **${t}**: ${x.slice(0, 220)} [${n}]`).join('\n')}\n\nПодробнее — в материалах по ссылкам.`;
}

/**
 * Подставные эмбеддинги (проверка стенда): «мешок основ слов», разложенный хешем по 1024 числам. Близость —
 * по общим словам, без смысла; инструкция запроса и <|endoftext|> отбрасываются, как их «понимает» модель.
 */
export function mockEmbedding(text: string, dims = 1024): number[] {
  const t = text.replace(/^Instruct:[^\n]*\nQuery:/, '').replace(/<\|endoftext\|>/g, '');
  const v = new Array<number>(dims).fill(0);
  for (const w of t.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter((x) => x.length > 2)) {
    let h = 2166136261;
    for (const ch of w.slice(0, 5)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    v[h % dims] += 1;
  }
  return v;
}

/** Посредник (проверка стенда): в городе — темп ниже (по первой справке), в укреплённой полосе — оборона сильнее (обстановка). */
export function mockUmpire(prompt: string) {
  const mods: { engagement: number; factor: string; mult: number; reason: string; basis: string[] }[] = [];
  const hasRef = /\[R1\]/.test(prompt);
  for (const m of prompt.matchAll(/^Бой (\d+)\. ([^\n]*)/gm)) {
    const n = +m[1];
    if (/местность: город/.test(m[2]) && hasRef) mods.push({ engagement: n, factor: 'pace', mult: 0.9, reason: 'уличный бой: танки без пехоты под огнём фаустпатронов', basis: ['R1'] });
    else if (/укреплённая полоса/.test(m[2])) mods.push({ engagement: n, factor: 'defense', mult: 1.1, reason: 'заграждения и минные поля перед полосой', basis: ['обстановка'] });
  }
  return { assessment: `Подставной посредник (проверка стенда): боёв ${[...prompt.matchAll(/^Бой \d+\./gm)].length}, поправок ${mods.length}.`, mods: mods.slice(0, 6) };
}

/** Раздел разбора операции (проверка стенда): пересказ сводки по структуре раздела. */
export function mockReview(system: string, prompt: string): string {
  const title = /Ваш раздел отчётного документа — «(.+?)»/.exec(system)?.[1] ?? 'раздел';
  const turns = [...prompt.matchAll(/^### (\d\d\.\d\d)/gm)].map((m) => m[1]);
  const outcome = /^Итог: (.*)$/m.exec(prompt)?.[1] ?? '—';
  const intent = /^Решение: (.*)$/m.exec(prompt)?.[1] ?? '—';
  return `### Оценка\nПодставная модель (проверка стенда): раздел «${title}». Ходов в сводке: ${turns.length} (${turns.join(', ')}). ${outcome}\n\n### Что удалось\n- Решение на первый ход: **${intent.slice(0, 120)}**\n\n### Ошибки и упущенные возможности\n- По сводке не видно разведки флангов.\n\n### Рекомендации\n1. Уточнять замысел противника каждый ход.\n2. Переносить базы снабжения за войсками.`;
}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** Подставной сервер модели. delayMs — пауза между кусками ответа (имитация генерации). */
export function startMockServer(port = 1234, host = '127.0.0.1', delayMs = 15): Promise<Server> {
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    // собственный API LM Studio: модель с двумя вариантами (проверка выбора 4bit / 8bit)
    if (req.url?.endsWith('/api/v0/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'mock-staff', type: 'llm', quantization: '4bit', state: 'loaded', variants: ['mock-staff@4bit', 'mock-staff@8bit'] }, { id: 'text-embedding-qwen3-embedding-0.6b', type: 'embeddings', state: 'loaded' }] })); return; }
    if (req.url?.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'mock-staff' }, { id: 'text-embedding-qwen3-embedding-0.6b' }] })); return; }
    if (req.url?.endsWith('/embeddings')) {
      let eb = '';
      req.on('data', (c) => (eb += c));
      req.on('end', () => {
        const { input } = JSON.parse(eb || '{}') as { input?: string | string[] };
        const list = Array.isArray(input) ? input : [input ?? ''];
        res.setHeader('content-type', 'application/json');
        // порядок — обратный, как может прийти от сервера: клиент сортирует по index
        res.end(JSON.stringify({ object: 'list', data: list.map((t, index) => ({ object: 'embedding', index, embedding: mockEmbedding(t) })).reverse() }));
      });
      return;
    }
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b || '{}') as { messages?: { role: string; content: string }[] };
      const user = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
      const sys = (body.messages ?? []).find((m) => m.role === 'system')?.content ?? '';
      const answer = sys.includes('Вы — Ставка Верховного Главнокомандования') ? JSON.stringify(mockStavka(user))
        : sys.includes('Проводите разбор операции') ? mockReview(sys, user)
        : sys.includes('посредник военно-исторического симулятора') ? JSON.stringify(mockUmpire(user))
        : sys.includes('составитель военно-исторической базы') ? JSON.stringify(mockExtract(user, sys.includes('выпишите в infrastructure')))
        : sys.includes('преподаватель военной истории') ? mockKbAnswer(user)
        : sys.includes('готовые варианты решения на ход') ? JSON.stringify(mockPlan(sys, user))
        : JSON.stringify(sys.includes('Вы — советник') ? mockAdvice(user) : mockDecision(user));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const wait = () => new Promise((r) => setTimeout(r, delayMs));
      for (const w of 'Оцениваю обстановку по докладам и разведсводке. '.split(' ')) { res.write(sse({ choices: [{ delta: { reasoning_content: w + ' ' } }] })); await wait(); }
      for (const p of answer.match(/.{1,40}/gs) ?? []) { res.write(sse({ choices: [{ delta: { content: p } }] })); await wait(); }
      res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
      res.write(sse({ choices: [], usage: { prompt_tokens: Math.round(user.length / 3), completion_tokens: Math.round(answer.length / 3) } }));
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((r) => server.listen(port, host, () => r(server)));
}
