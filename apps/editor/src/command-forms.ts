/**
 * Командование по ступеням в игре на агентной модели: как называется документ игрока (верхней инстанции) по
 * ступени получателя и форме, пометки управления штабов, режимы игры. Без React — проверяется в node.
 */
import type { CommandOp, GameMode } from '@def-ops/sim';
import type { EnemyMode, TurnView } from './sim/game-protocol';

export type { CommandOp };

export type Form = 'order' | 'instruction';

/** Получатель ниже фронта (группы армий) — приказ через голову (ПУ-39 ст. 93): пропущенные штабы получают извещение. */
export const overHead = (echelon: string): boolean => echelon !== 'front';

/**
 * Документ верхней инстанции: директива (приказ — подготовленный, сутки на ступень) или боевое распоряжение
 * (быстро, 1–3 ч на ступень, слаженность ниже); немецкая сторона — Weisung / Einzelbefehl ОКХ.
 */
export function formTitle(side: 'su' | 'de' | string, echelon: string, form: Form): string {
  const head = side === 'de'
    ? (form === 'order' ? 'Weisung (директива ОКХ)' : 'Einzelbefehl (частный приказ ОКХ)')
    : (form === 'order' ? 'директива Ставки' : 'боевое распоряжение Ставки');
  return overHead(echelon) ? `${head} — через голову${side === 'de' ? '' : ' (ПУ-39 ст. 93)'}` : head;
}

/** Пометка штаба или дивизии: взят игроком, ведёт Ставка (через голову; в «истории как замысле» — ведёт игрок
 *  директивами), по сценарию («гибрид»); у агента — нет. */
export function controlMark(c: { control: string; led: boolean } | undefined, mode?: string): { text: string; cls: string } | null {
  if (!c) return null;
  if (c.control === 'player') return { text: 'взят под управление', cls: 'ctl-player' };
  if (c.led) return { text: mode === 'intent' ? 'ведёте директивами' : 'ведёт Ставка', cls: 'ctl-led' };
  if (c.control === 'script') return { text: 'по сценарию (гибрид)', cls: 'ctl-script' };
  return null;
}

/**
 * Кнопка «вернуть» штаба во вкладке «Штабы»: взятый — агенту, изъятый через голову — в замысел старшего; в «истории как
 * замысле» оба (и взятый директивой игрока) — истории: штаб с подчинёнными снова идёт по историческому замыслу.
 */
export function releaseAction(h: { control: string; led: boolean }, mode: string): { text: string; title: string } | null {
  if (h.control !== 'player' && !h.led) return null;
  if (mode === 'intent') return { text: 'вернуть истории', title: 'Штаб с подчинёнными снова пойдёт по историческому замыслу' };
  return h.control === 'player' ? { text: 'вернуть агенту', title: 'Агент продолжит с текущего состояния' } : { text: 'вернуть в замысел старшего', title: 'Старший снова включит его в свой замысел' };
}

/** Штаб можно взять и вернуть во вкладке «Штабы»: верхняя инстанция — только в «истории как замысле» (в прочих режимах
 *  она и так у игрока). */
export function staffListed(echelon: string, mode: string): boolean {
  return echelon !== 'high_command' || mode === 'intent';
}

/** Окно «Принять командование»: можно ли вернуть командование истории — только в «истории как замысле» (штаб, не всю сторону). */
export function historyBackText(agents: boolean, mode: GameMode): string {
  return agents && mode === 'intent'
    ? 'Взятый штаб можно вернуть истории (вкладка «Штабы», «вернуть истории»): он с подчинёнными снова пойдёт по историческому замыслу.'
    : 'Вернуть командование историческому плану нельзя.';
}

/** Режимы игры на агентной модели. */
export const MODE_TITLE: Record<GameMode, { title: string; hint: string }> = {
  legacy: { title: 'Как сейчас', hint: 'приказ штабу доходит до каждой его дивизии; собственные штабы стороны не решают' },
  agents: { title: 'Штабы-агенты', hint: 'вы — Ставка: директивы фронтам, ниже решают штабы-агенты по уставам; можно приказать через голову и взять штаб под управление' },
  commanders: { title: 'Командующие', hint: 'вы занимаете место командующего (фронта или верхней инстанции) — штаб, которого вы берёте; остальные командующие решают сами по своему характеру, мотивам и уставу, ниже — штабы-агенты' },
  hybrid: { title: 'Гибрид', hint: 'как «штабы-агенты», но поданные без изменений исторические директивы ведут приказы сценария — ближе к истории' },
  intent: { title: 'История как замысел', hint: 'обе стороны идут по замыслу истории, пока обстановка позволяет; взятый вами штаб с подчинёнными уходит с истории' },
};

const MODE_KEY = 'def_ops.command.mode';
/** Режим игры, выбранный в окне передачи командования раньше; нет выбора — «История как замысел». */
export function savedGameMode(): GameMode {
  try { const v = localStorage.getItem(MODE_KEY); return v === 'legacy' || v === 'agents' || v === 'hybrid' || v === 'commanders' || v === 'intent' ? v : 'intent'; } catch { return 'intent'; }
}
export function saveGameMode(m: GameMode) { try { localStorage.setItem(MODE_KEY, m); } catch { /* */ } }
/**
 * Противник, допустимый при режиме своей стороны (ядро — game::enemy_for; недопустимое сочетание ядро отклоняет): в
 * «истории как замысле» противник — тоже история или штаб на модели; у «командующих» — командующие и штабы-агенты или
 * штаб на модели; в «как сейчас» истории у противника нет. Не агентная модель — штаб на модели или без штаба.
 */
export function enemyOptions(agents: boolean, mode: GameMode): EnemyMode[] {
  if (!agents) return ['llm', 'passive'];
  if (mode === 'intent') return ['intent', 'llm'];
  if (mode === 'commanders') return ['agents', 'llm'];
  if (mode === 'legacy') return ['llm', 'passive', 'agents'];
  return ['intent', 'llm', 'passive', 'agents'];
}
/** Варианты противника — как в окне «Принять командование». */
export const ENEMY_TITLE: Record<EnemyMode, string> = { intent: 'История как замысел', llm: 'Штаб на модели', passive: 'Без штаба', agents: 'Штабы-агенты' };
/** Противник по умолчанию при режиме: «История как замысел», где она допустима; у «командующих» — штабы-агенты; иначе штаб на модели (нет связи — без штаба). */
export function defaultEnemy(agents: boolean, llmDown: boolean, mode: GameMode = 'intent'): EnemyMode {
  const ok = enemyOptions(agents, mode);
  if (ok.includes('intent')) return 'intent';
  if (ok.includes('agents') && !ok.includes('passive')) return 'agents';
  return llmDown && ok.includes('passive') ? 'passive' : 'llm';
}
/** Выбор противника при режиме: допустимый остаётся, недопустимый — умолчание режима. */
export function fitEnemy(e: EnemyMode, agents: boolean, mode: GameMode, llmDown: boolean): EnemyMode {
  return enemyOptions(agents, mode).includes(e) ? e : defaultEnemy(agents, llmDown, mode);
}

/** Ответ на выбор режима (голос): режим и, если прежний противник при нём недопустим и заменён, — кто противник теперь. */
export function modeReply(mode: GameMode, before: EnemyMode, after: EnemyMode): string {
  const base = `Режим — «${MODE_TITLE[mode].title}»: ${MODE_TITLE[mode].hint}.`;
  return after === before ? base : `${base} Противник «${ENEMY_TITLE[before].toLowerCase()}» в этом режиме недопустим — противник: ${ENEMY_TITLE[after].toLowerCase()}.`;
}

/** Противник, которого можно сменить в ходе игры (Посредник, голос): допустимый при режиме штаб на модели или «без штаба». Штабы без модели выбираются при передаче командования. */
export function liveEnemyOptions(agents: boolean, mode: GameMode): EnemyMode[] {
  return enemyOptions(agents, mode).filter((e) => e === 'llm' || e === 'passive');
}
/** Названия противников через запятую — для ответов и сообщений. */
export function enemyNames(list: EnemyMode[]): string {
  return list.map((e) => ENEMY_TITLE[e].toLowerCase()).join(', ');
}
/**
 * Противник при продолжении сохранённой игры: допустимый при режиме остаётся; недопустимый (старая запись) заменяется
 * умолчанием режима, и в `note` — русское сообщение, что взято вместо него и почему.
 */
export function resumeEnemy(stored: EnemyMode, agents: boolean, mode: GameMode, llmDown: boolean): { enemy: EnemyMode; note?: string } {
  const enemy = fitEnemy(stored, agents, mode, llmDown);
  if (enemy === stored) return { enemy };
  return { enemy, note: `В сохранённой игре противник «${ENEMY_TITLE[stored].toLowerCase()}», но в режиме «${MODE_TITLE[mode].title}» он недопустим (допустимы: ${enemyNames(enemyOptions(agents, mode))}). Игра продолжена с противником «${ENEMY_TITLE[enemy].toLowerCase()}».` };
}

const subject = (c: CommandOp) => (c.op === 'take' ? c.hq : c.op === 'release' ? c.id : c.op === 'permit' ? c.hq : c.op === 'directive' ? `dir:${c.directive.to}` : c.id);
/**
 * Команда в очередь хода: повтор не добавляется; «взять» и «вернуть» одного штаба в одном ходе гасят друг друга;
 * ответ на запросы штаба — последний.
 */
export function queueOp(q: CommandOp[], op: CommandOp): CommandOp[] {
  const same = (c: CommandOp) => c.op === op.op && subject(c) === subject(op);
  const opposite = (c: CommandOp) => subject(c) === subject(op) && ((c.op === 'take' && op.op === 'release') || (c.op === 'release' && op.op === 'take'));
  if (q.some(opposite)) return q.filter((c) => !opposite(c));
  // ответ на запрос и директива получателю — последние
  if (op.op === 'permit' || op.op === 'directive') return [...q.filter((c) => !same(c)), op];
  return q.some(same) ? q : [...q, op];
}

/** Слова названия: числа без окончаний («8-я» → «8»), слова — по первым четырём буквам. */
const words = (s: string) => s.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean).filter((w) => !/^(я|й|го|ая|ую)$/.test(w)).map((w) => (/^\d/.test(w) ? w.replace(/\D+$/, '') : w.slice(0, 4)));
/** Штаб по id или названию (все слова запроса есть в названии); нет — null. */
export function findHq(hqs: Record<string, { name: string }>, q: string): string | null {
  if (hqs[q]) return q;
  const want = words(q);
  if (!want.length) return null;
  return Object.entries(hqs).find(([, h]) => { const have = words(h.name); return want.every((w) => have.includes(w)); })?.[0] ?? null;
}

/**
 * Очередь команд на первый ход: в режиме «штабы-агенты» — исторические директивы, час которых уже наступил (при
 * передаче командования они уже действуют); в «гибриде» — все (подаются только до первого хода); в «истории как
 * замысле» историю ведёт ядро — только наступившие директивы получателям под игроком. Не первый ход — пусто.
 */
export function initialCmds(v: TurnView): CommandOp[] {
  const c = v.command;
  if (!c || c.mode === 'legacy' || v.turn !== 1) return [];
  const mine = (id: string) => { for (let x: string | null = id, n = 0; x && n < 8; x = c.hqs[x]?.parent ?? null, n++) if (c.hqs[x]?.control === 'player') return true; return false; };
  return c.historical.filter((h) => !h.issued && (c.mode === 'hybrid' || h.due) && (c.mode !== 'intent' || mine(h.to))).map((h) => ({ op: 'historical', id: h.id }));
}

/** Пометка своего штаба или дивизии в докладах; «как сейчас» (и старые записи игры) — без пометок. */
export function markFor(v: TurnView, id: string): { text: string; cls: string } | null {
  const c = v.command;
  if (!c || c.mode === 'legacy') return null;
  return controlMark(c.hqs[id] ?? (c.led.includes(id) ? { control: 'agent', led: true } : undefined), c.mode);
}

/** «широта, долгота» в тексте документа ядра — ближайшим пунктом театра (дальше 1 км — с расстоянием до него). */
export function placeText(text: string, places: { title: string; at: [number, number] }[]): string {
  if (!places.length) return text;
  return text.replace(/(\d{2}\.\d{2}), (\d{1,3}\.\d{2})/g, (_m, la: string, lo: string) => {
    const lat = +la, lng = +lo;
    const km = (p: [number, number]) => Math.hypot((p[0] - lng) * 111.32 * Math.cos((lat * Math.PI) / 180), (p[1] - lat) * 110.57);
    const best = places.reduce((a, p) => (km(p.at) < km(a.at) ? p : a));
    const d = Math.round(km(best.at));
    return d >= 1 ? `${best.title}, ${d} км` : best.title;
  });
}
