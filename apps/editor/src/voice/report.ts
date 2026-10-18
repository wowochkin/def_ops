/**
 * Доклады штаба голосом — без модели, по обстановке хода (TurnView): обстановка коротко (5–7 фраз), разведсводка,
 * доклад объединения и противника, где находится, день журнала. Чистый модуль (без React); тексты уже готовы к
 * озвучке (speakable: числа словами).
 */
import type { IntelReport, UnitReport } from '@def-ops/sim';
import type { JournalDay, TurnView } from '../sim/game-protocol';
import { plural, speakable } from './speech';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «16 апреля» (озвучка — «шестнадцатого апреля»). */
export const dayMonth = (t: string) => `${+t.slice(8, 10)} ${MONTHS[+t.slice(5, 7) - 1]}`;
/** «6 часов» / «6:30». */
const hour = (t: string) => (t.slice(14, 16) === '00' ? `${+t.slice(11, 13)} ${plural(+t.slice(11, 13), ['час', 'часа', 'часов'])}` : t.slice(11, 16));
const pct = (x: number) => `${Math.round(x * 100)} %`;
/** Название без пояснений в скобках. */
export const short = (n: string) => n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
/** Первое предложение текста, с точкой. */
function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  // конец предложения — знак и заглавная буква после; точка сокращения («гв. А», «8 км. Дальше») не в счёт
  for (const m of t.matchAll(/[.!?…](?=\s+[А-ЯЁA-Z«"]|$)/gu)) {
    const word = /([\p{L}\d]+)$/u.exec(t.slice(0, m.index))?.[1] ?? '';
    if (m[0] === '.' && word.length <= 3 && m.index! < t.length - 1) continue;
    return t.slice(0, m.index! + 1);
  }
  return `${t.replace(/[\s,;:—–-]+$/, '')}.`;
}
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);
const say = (parts: string[]) => speakable(parts.filter(Boolean).join(' '), { full: true });
/** Десятичное словами: «1,5». */
const dec = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',');

/** Сколько донесений называть в кратком докладе. */
const MAIN_EVENTS = 2;
/** Предел фраз краткого доклада. */
export const REPORT_MAX_SENTENCES = 7;

/**
 * Доклад обстановки коротко: дата и ход, цель и срок, укомплектованность, отрезанные от подвоза, главное из донесений
 * за ход, достигнутое. 5–7 фраз. more — остальные донесения (по «подробнее»).
 */
export function situationReport(v: TurnView): { text: string; more: string[] } {
  const active = v.own.filter((u) => u.status === 'active');
  const avg = active.length ? active.reduce((s, u) => s + u.strength, 0) / active.length : 0;
  const cut = active.filter((u) => u.cutOff).map((u) => short(u.name));
  const head = [
    `Обстановка на ${hour(v.time)} ${dayMonth(v.time)}, ход ${v.turn}.`,
    `Цель — ${v.victory.replace(/[.]+$/, '')}; срок — ${dayMonth(v.deadline)}.`,
    `В строю ${active.length} ${plural(active.length, ['объединение', 'объединения', 'объединений'])}, средняя укомплектованность ${pct(avg)}; всего войск — ${pct(v.strength)} исходной численности.`,
    cut.length ? `Отрезаны от подвоза: ${list(cut.slice(0, 3))}${cut.length > 3 ? ` и ещё ${cut.length - 3}` : ''}.` : 'Отрезанных от подвоза нет.',
  ];
  const events = v.turn > 1 ? v.events.map(sentence) : [];
  const reached = v.goals.filter((g) => g.simulated).map((g) => g.title.split(':')[0]);
  const tail: string[] = [];
  if (v.turn <= 1) tail.push('Командование только что принято: войска выполняют прежние задачи, донесений за ход ещё нет.');
  else if (!events.length) tail.push('За ход существенных событий нет.');
  const room = REPORT_MAX_SENTENCES - head.length - tail.length - (reached.length ? 1 : 0);
  // донесения: главное — первые; остальные — по «подробнее» (о них — одна фраза, если есть место)
  let n = Math.min(events.length, MAIN_EVENTS, room);
  if (events.length > n && n + 1 > room) n = Math.max(1, room - 1);
  const main = events.slice(0, n);
  const more = events.slice(n);
  if (main.length) tail.push(`Главное за ход: ${main[0]}`, ...main.slice(1));
  if (reached.length) tail.push(`Достигнуто: ${list(reached)}.`);
  if (more.length) tail.push(`Ещё ${more.length} ${plural(more.length, ['донесение', 'донесения', 'донесений'])} — скажите «подробнее».`);
  return { text: say([...head, ...tail]), more };
}

/** Остальные донесения подряд (для чтения по частям). */
export const moreText = (more: string[]) => say(more);

/** Разведсводка коротко: сколько противника в пределах разведки, новое, ближайшее к нашим войскам. */
export function intelReport(v: TurnView): string {
  if (!v.intel.length) return say([`Противник не обнаружен — разведка видит до ${v.detectKm} км от наших войск.`]);
  const fresh = v.intel.filter((e) => e.fresh).map((e) => short(e.name));
  const near = [...v.intel].filter((e) => e.nearest).sort((a, b) => a.nearest!.km - b.nearest!.km).slice(0, 3);
  return say([
    `Разведсводка: обнаружено ${v.intel.length} ${plural(v.intel.length, ['соединение', 'соединения', 'соединений'])} противника — разведка видит до ${v.detectKm} км от наших войск.`,
    fresh.length ? `Новые: ${list(fresh.slice(0, 3))}.` : 'Новых нет.',
    near.length ? `Ближе всего к нашим: ${near.map((e) => `${short(e.name)} — ${Math.round(e.nearest!.km)} км, рядом — ${short(e.nearest!.name)}`).join('; ')}.` : '',
    'Подробно — во вкладке «Разведка».',
  ]);
}

const STATE: Record<string, string> = { arriving: 'вводится в сражение', reserve: 'в резерве', destroyed: 'утратило боеспособность' };

/** Где объединение (своё) — одной фразой. */
export function whereText(u: UnitReport): string {
  if (u.status === 'active') return say([`${short(u.name)}: ${u.posture}, ${u.place}.`]);
  return say([`${short(u.name)} — ${STATE[u.status] ?? u.status}${u.status !== 'destroyed' ? `, ${u.place}` : ''}.`]);
}

/** Доклад своего объединения: положение, состав и запасы, задача, бой за ход. */
export function unitReport(u: UnitReport): string {
  const parts = [whereText(u)];
  if (u.status === 'destroyed') return say(parts);
  parts.push(`Укомплектованность ${pct(u.strength)}: ${u.personnel} ${plural(u.personnel, ['человек', 'человека', 'человек'])}, танков и САУ ${u.tanks}, орудий ${u.guns}.`);
  parts.push(`Боеприпасов ${dec(u.ammo)} боекомплекта, горючего ${dec(u.fuel)} заправки${u.cutOff ? '; подвоз прерван' : ''}.`);
  parts.push(u.task ? `Задача: ${u.task}${u.target ? ` — ${u.target}` : ''}.` : 'Задачи нет.');
  const c = u.combats[0];
  if (c) parts.push(`За ход: ${c.role === 'attack' ? 'наступление на' : 'оборона против'} ${list(c.against.slice(0, 2).map(short))} — ${c.outcome}${c.advanceKm >= 1 ? ` на ${Math.round(c.advanceKm)} км` : ''}, потери ${c.lossPct} %.`);
  if (u.pending.length) parts.push(`Приказ в пути: ${u.pending[0].task} — ${u.pending[0].target}.`);
  return say(parts);
}

/** Доклад о соединении противника (по разведке). */
export function enemyReport(e: IntelReport): string {
  return say([
    `Противник, ${short(e.name)}: ${e.posture}, ${e.place}.`,
    `Оценка сил: ${e.estimate}.`,
    e.nearest ? `Ближайшее наше — ${short(e.nearest.name)}, ${Math.round(e.nearest.km)} км.` : '',
  ]);
}

/** Доклад по фронту (группе армий): сколько в строю, средняя укомплектованность. */
export function groupReport(g: { id: string; name: string }, v: TurnView): string {
  const all = v.own.filter((u) => u.parent === g.id);
  const active = all.filter((u) => u.status === 'active');
  const avg = active.length ? active.reduce((s, u) => s + u.strength, 0) / active.length : 0;
  const cut = active.filter((u) => u.cutOff).length;
  return say([
    `${short(g.name)}: в строю ${active.length} из ${all.length}, средняя укомплектованность ${pct(avg)}.`,
    cut ? `Отрезано от подвоза: ${cut}.` : '',
    'Доклады объединений — во вкладке «Доклады».',
  ]);
}

/** День журнала боевых действий словами: решение, приказы, распоряжения, донесения. */
export function journalDayText(d: JournalDay): string {
  return say([
    `Журнал, ${dayMonth(d.time)}, ${hour(d.time)}.`,
    d.decision?.intent ? `Решение: ${sentence(d.decision.intent)}` : '',
    d.orders.length ? `Отдано приказов: ${d.orders.length}. ${d.orders.map(sentence).join(' ')}` : 'Новых приказов не было.',
    d.actions.length ? `Распоряжения: ${d.actions.map(sentence).join(' ')}` : '',
    d.events.length ? `Донесения: ${d.events.map(sentence).join(' ')}` : 'Существенных событий не было.',
  ]);
}
