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
    requests: ['Прошу разрешения на отвод обескровленных частей на тыловой рубеж.'],
    risks: ['Контрудар без поддержки авиации может не достичь цели.', 'Отвод частей может открыть фланг соседа.'],
  };
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
    suggestions: own.length && areas.length ? [{ formation: name(own[0]), task: enemy.length ? 'attack' : 'regroup', area: enemy[0] ?? areas[0], toArea: enemy.length ? null : areas[0], why: 'поддержать главный удар' }] : [],
    followUps: ['Где противник может нанести контрудар?', 'Каким армиям не хватает подвоза?', 'Как быстрее выйти к цели операции?'],
  };
}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** Подставной сервер модели. delayMs — пауза между кусками ответа (имитация генерации). */
export function startMockServer(port = 1234, host = '127.0.0.1', delayMs = 15): Promise<Server> {
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    if (req.url?.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'mock-staff' }] })); return; }
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b || '{}') as { messages?: { role: string; content: string }[] };
      const user = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
      const isAdvisor = (body.messages ?? []).some((m) => m.role === 'system' && m.content.includes('Вы — советник'));
      const answer = JSON.stringify(isAdvisor ? mockAdvice(user) : mockDecision(user));
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
