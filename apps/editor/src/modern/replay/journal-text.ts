import { saveFile } from '../../voice/files';
import { jointReview, reportTime, sideReview, type Decision, type LoggedEvent, type Scenario, type Session, type Side } from './session';

export const sideName = { a: 'Сторона А', b: 'Сторона Б' };
const clock = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });
const regions = new Intl.DisplayNames('ru', { type: 'region', style: 'short' });
export const stamp = (at: string) => clock.format(new Date(at));
export const countryName = (value: string) => /^[A-Z]{2}$/.test(value) ? regions.of(value) ?? value : value;

export function choiceLabel(decision: Decision, choices: Scenario['choices'], effective?: string | null) {
  const label = choices.find(item => item.id === (decision.choice ?? effective))?.label;
  if (decision.choice === null) return label ? 'Продолжение · ' + label : 'Без нового решения';
  return label ?? '';
}

type ReviewEvent = LoggedEvent & { receivedAt?: string };

export function deliveryLines(event: ReviewEvent, jointEnd?: string): string[] {
  if (!jointEnd) return event.receivedAt ? ['Получено · ' + stamp(event.receivedAt) + ' UTC'] : [];
  const lines: string[] = [];
  for (const side of ['a', 'b'] as const) {
    const received = reportTime(event, side);
    if (!received) continue;
    const status = received <= jointEnd ? 'получено' : 'к этому моменту не доставлено, назначено на';
    lines.push(sideName[side] + ' · ' + status + ' ' + stamp(received) + ' UTC');
  }
  return lines.length ? lines : ['Доступно только в общем разборе'];
}

function eventLines(events: readonly ReviewEvent[], jointEnd?: string) {
  return events.flatMap(event => [
    ['Событие · ' + stamp(event.at) + ' UTC', event.announcement, event.text].filter(Boolean).join(' · '),
    ...deliveryLines(event, jointEnd),
  ]);
}

function recordLines(decision: Decision, choices: Scenario['choices'], effective?: string | null) {
  return [
    choiceLabel(decision, choices, effective),
    decision.format === 'separate' ? 'Отдельные записи' : 'Единая директива',
    decision.note,
  ];
}

function profileLines(session: Session, side: Side) {
  const { profile, materialIds } = sideReview(session, side);
  const materials = (profile.materials ?? []).filter(item => materialIds.includes(item.id));
  return [
    sideName[side] + ' · ' + countryName(profile.country),
    'Задача стороны', profile.objective,
    ...(materials.length ? ['Материалы стороны'] : []),
    ...materials.flatMap(item => [item.label, item.category, item.summary, item.sourceUrl].filter((value): value is string => Boolean(value))),
  ];
}

export function journalText(session: Session, scope: Side | 'joint'): string {
  const lines = [session.scenario.title, session.scenario.area, 'Начало · ' + stamp(session.scenario.start) + ' UTC',
    'Время журнала · ' + stamp(session.now) + ' UTC', ''];
  const timeRange = (start: string, end: string) => stamp(start) + ' — ' + stamp(end) + ' UTC';
  const sides: Side[] = ['a', 'b'];
  if (scope === 'joint') {
    const review = jointReview(session);
    lines.push('Общий разбор');
    for (const side of sides) lines.push(...profileLines(session, side));
    for (const period of review.periods) {
      lines.push('', timeRange(period.start, period.end));
      for (const side of sides) lines.push(sideName[side], ...recordLines(period.decisions[side], session.scenario.choices, period.effectiveChoices[side]));
      lines.push(...eventLines(period.events, session.now));
    }
    for (const side of sides) {
      const pending = review.pending[side];
      if (pending) lines.push('', 'Незакрытый период · ' + sideName[side], ...recordLines(pending, session.scenario.choices));
    }
  } else {
    const review = sideReview(session, scope);
    lines.push('Личный разбор', ...profileLines(session, scope));
    for (const period of review.periods) {
      lines.push('', timeRange(period.start, period.end), ...recordLines(period.decision, review.choices, period.effectiveChoice), ...eventLines(period.events));
    }
    if (review.pending) lines.push('', 'Незакрытый период', ...recordLines(review.pending, review.choices));
  }
  return lines.join('\n');
}

export function downloadJournal(session: Session, scope: Side | 'joint') {
  const contents = new Blob(['\uFEFF', journalText(session, scope)], { type: 'text/plain;charset=utf-8' });
  const title = session.scenario.title.replace(/[\\/:*?"<>|]/g, '-');
  const cleanTitle = title.replace(/[.\s]+$/, '').replace(/\.{2,}/g, '…').trim();
  const owner = scope === 'joint' ? 'Общий разбор' : sideName[scope];
  const filename = 'Переигровка — ' + owner + (cleanTitle ? ' — ' + cleanTitle : '') + '.txt';
  return saveFile(filename, contents);
}
