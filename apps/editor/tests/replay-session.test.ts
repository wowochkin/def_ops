import { describe, expect, it } from 'vitest';
import {
  canJointReview, createSession, jointReview, periodEnd, reportTime, restartSession, sideReview,
  submitDecision, voteFinish, voteUnlock, type Scenario, type Session,
} from '../src/modern/replay/session';

const at = (hour: number) => `2025-04-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
const scenario: Scenario = {
  title: 'Проверка архива', area: 'Архив', start: at(0), end: at(16), periodHours: 6, disclosure: 'mutual',
  sides: { a: { country: 'AA', objective: 'Проверить каталог' }, b: { country: 'BB', objective: 'Сопоставить источники' } },
  choices: [{ id: 'read', label: 'Читать' }, { id: 'check', label: 'Сверять' }], events: [],
};

function play(session: Session, a: string | null, b: string | null): Session {
  const first = submitDecision(session, 'b', session.now, { choice: b, note: 'Пометка Б' });
  return submitDecision(first, 'a', session.now, { choice: a, note: 'Пометка А' });
}

describe('локальная исследовательская сессия', () => {
  it('ждёт обе записи одного периода и защищает принятую запись от замены и повтора', () => {
    const start = createSession(scenario);
    const first = submitDecision(start, 'b', start.now, { choice: 'check', note: 'Скрытая пометка' });
    expect(start.pending).toEqual({});
    expect(first.now).toBe(start.now);
    expect(first.periods).toHaveLength(0);
    expect(JSON.stringify(sideReview(first, 'a'))).not.toContain('Скрытая пометка');
    expect(sideReview(first, 'b').pending?.note).toBe('Скрытая пометка');
    expect(() => submitDecision(first, 'b', first.now, { choice: 'read' })).toThrow();
    expect(() => submitDecision(first, 'a', at(6), { choice: null })).toThrow();
    const next = submitDecision(first, 'a', first.now, { choice: null });
    expect(next.now).toBe(at(6));
    expect(next.periods[0].effectiveChoices).toEqual({ a: null, b: 'check' });
    expect(next.pending).toEqual({});
    expect(() => submitDecision(next, 'a', start.now, { choice: null })).toThrow();
  });

  it('применяет оба условия к действующим вариантам, сохраняет границы и завершает по первому подходящему событию', () => {
    const start = createSession({
      ...scenario,
      events: [
        { at: at(11), text: 'После завершения', audience: 'both' },
        { at: at(8), text: 'Материалы получены', audience: 'a', announcement: 'Ваша подборка готова', when: { a: 'read', b: 'check' }, ends: true },
        { at: at(8), text: 'Одновременная запись', audience: 'both' },
        { at: at(5), text: 'Не подходит', audience: 'b', when: { a: 'read', b: 'read' }, ends: true },
        { at: at(6), text: 'Граница', audience: 'none' },
        { at: at(0), text: 'Открытие', audience: 'both' },
      ],
    });
    const middle = play(start, 'read', 'check');
    const end = play(middle, null, null);
    expect(end.status).toBe('finished');
    expect(end.reason).toBe('event');
    expect(end.now).toBe(at(8));
    expect(end.periods.map(p => p.events.map(e => e.text))).toEqual([
      ['Открытие', 'Граница'], ['Материалы получены', 'Одновременная запись'],
    ]);
    expect(end.periods[1].effectiveChoices).toEqual({ a: 'read', b: 'check' });
    const review = JSON.stringify(sideReview(end, 'b'));
    for (const privateText of ['Материалы получены', 'Ваша подборка готова', 'Граница', 'Проверить каталог', 'Пометка А']) {
      expect(review).not.toContain(privateText);
    }
    expect(sideReview(end, 'a').periods[1].events[0].announcement).toBe('Ваша подборка готова');
    expect(sideReview(end, 'a').periods[1].events[0]).not.toHaveProperty('when');
  });

  it('сокращает последний период у границы и открывает немедленный разбор только после окончания', () => {
    const start = createSession({ ...scenario, periodHours: 12, disclosure: 'immediate' });
    expect(canJointReview(start)).toBe(false);
    expect(() => jointReview(start)).toThrow();
    const middle = play(start, 'check', 'read');
    expect(periodEnd(middle)).toBe(at(16));
    const end = play(middle, null, null);
    expect(end.reason).toBe('deadline');
    expect(end.now).toBe(at(16));
    expect(canJointReview(end)).toBe(true);
    expect(jointReview(end).periods).toHaveLength(2);
    expect(() => submitDecision(end, 'a', end.now, { choice: null })).toThrow();
  });

  it('различает согласие на завершение и на раскрытие, сохраняет незавершённую запись и переигрывает с начала', () => {
    const start = createSession(scenario);
    const mid = submitDecision(start, 'a', start.now, { choice: 'read', note: 'Незавершённая запись' });
    const first = voteFinish(mid, 'a');
    expect(first.status).toBe('active');
    expect(voteFinish(first, 'a').status).toBe('active');
    expect(() => voteUnlock(first, 'a')).toThrow();
    const end = voteFinish(first, 'b');
    expect(end.reason).toBe('agreement');
    expect(end.periods).toHaveLength(0);
    const firstUnlock = voteUnlock(end, 'b');
    expect(canJointReview(voteUnlock(firstUnlock, 'b'))).toBe(false);
    expect(() => jointReview(firstUnlock)).toThrow();
    const unlocked = voteUnlock(firstUnlock, 'a');
    expect(jointReview(unlocked).pending.a?.note).toBe('Незавершённая запись');
    expect(restartSession(unlocked)).toEqual(start);
  });

  it('замораживает выбор личных материалов после первой записи, проверяет принадлежность и обязательные позиции', () => {
    const start = createSession({
      ...scenario,
      sides: { ...scenario.sides, a: { ...scenario.sides.a, materials: [
        { id: 'r', label: 'Обязательная выдержка', required: true }, { id: 's', label: 'Справка А', required: false },
      ] } },
    });
    expect(() => submitDecision(start, 'a', start.now, { choice: 'read', materialIds: ['s'] })).toThrow();
    expect(() => submitDecision(start, 'b', start.now, { choice: null, materialIds: ['r'] })).toThrow();
    const selection = ['r', 's'];
    const first = submitDecision(start, 'a', start.now, { choice: 'read', materialIds: selection, format: 'separate', note: 'Первая строка\nВторая строка' });
    selection.pop();
    expect(sideReview(first, 'a').materialIds).toEqual(['r', 's']);
    const next = submitDecision(first, 'b', first.now, { choice: null });
    expect(sideReview(next, 'a').periods[0].decision.format).toBe('separate');
    expect(sideReview(next, 'a').materialIds).toEqual(['r', 's']);
    expect(JSON.stringify(sideReview(next, 'b'))).not.toContain('Справка А');
    expect(() => submitDecision(next, 'a', next.now, { choice: null, materialIds: ['r'] })).toThrow();
    const repeat = restartSession(next);
    expect(sideReview(repeat, 'a').initialMaterialIds).toEqual(['r', 's']);
    expect(sideReview(repeat, 'a').profile.materials).toEqual(start.scenario.sides.a.materials);
    expect(() => submitDecision(repeat, 'a', repeat.now, { choice: null, materialIds: ['r'] })).toThrow();
    const resumed = submitDecision(repeat, 'a', repeat.now, { choice: null });
    expect(sideReview(resumed, 'a').pending?.materialIds).toEqual(['r', 's']);
  });

  it('отвергает неверные настройки, неизвестные варианты, события вне сессии и посторонние условия', () => {
    expect(() => createSession({ ...scenario, end: scenario.start })).toThrow();
    expect(() => createSession({ ...scenario, start: '2025-04-01T00:00' })).toThrow();
    expect(() => createSession({ ...scenario, choices: [...scenario.choices, scenario.choices[0]] })).toThrow();
    expect(() => createSession({ ...scenario, events: [{ at: at(17), text: 'Поздно', audience: 'both' }] })).toThrow();
    expect(() => createSession({ ...scenario, events: [{ at: at(4), text: 'Неизвестно', audience: 'a', when: { a: 'other' } }] })).toThrow();
    const start = createSession(scenario);
    expect(() => submitDecision(start, 'b', start.now, { choice: 'other' })).toThrow();
  });

  it('скрывает всё содержимое завершающего события до совместного раскрытия', () => {
    const start = createSession({ ...scenario, events: [
      { at: at(2), text: 'Закрытое описание', announcement: 'Закрытый заголовок', audience: 'none', ends: true, when: { b: 'read' } },
    ] });
    const end = play(start, 'check', 'read');
    expect(end.now).toBe(at(2));
    for (const side of ['a', 'b'] as const) expect(sideReview(end, side).periods[0].events).toEqual([]);
    expect(() => jointReview(end)).toThrow();
    const open = voteUnlock(voteUnlock(end, 'a'), 'b');
    expect(jointReview(open).periods[0].events[0]).toMatchObject({ text: 'Закрытое описание', announcement: 'Закрытый заголовок' });
  });

  it('сохраняет исходную область и сведения карточки независимо от внешнего справочника', () => {
    const card = { id: 'ref', label: 'Сводка', summary: 'Первое издание', required: false };
    const bounds: [number, number, number, number] = [0, 0, 1, 1];
    const start = createSession({
      ...scenario, areaBounds: bounds, sides: { ...scenario.sides, b: { ...scenario.sides.b, materials: [card] } },
    });
    card.summary = 'Позднее издание';
    bounds[0] = -10;
    expect(sideReview(start, 'b').profile.materials?.[0].summary).toBe('Первое издание');
    expect(restartSession(start).scenario.areaBounds).toEqual([0, 0, 1, 1]);
  });

  it('помещает сообщения в период получения в порядке доставки и скрывает расписание другой стороны', () => {
    const start = createSession({ ...scenario, disclosure: 'immediate', events: [
      { at: at(1), text: 'Ранняя запись', audience: 'both', reportAt: { b: '2025-04-01T11:00:00+02:00' } },
      { at: at(2), text: 'Поздняя запись', audience: 'b', reportAt: { b: at(8) } },
      { at: at(3), text: 'На границе', audience: 'b', reportAt: { b: at(6) } },
      { at: at(4), text: 'Не наступило', audience: 'both', when: { a: 'check' }, reportAt: { a: at(8) } },
    ] });
    const first = play(start, 'read', 'check');
    const a = sideReview(first, 'a');
    expect(a.periods[0].events).toMatchObject([{ at: at(1), receivedAt: at(1), text: 'Ранняя запись' }]);
    expect(a.periods[0].events[0]).not.toHaveProperty('reportAt');
    expect(sideReview(first, 'b').periods[0].events.map(e => e.text)).toEqual(['На границе']);
    const second = play(first, null, null);
    expect(sideReview(second, 'b').periods[1].events.map(e => [e.text, e.at, e.receivedAt])).toEqual([
      ['Поздняя запись', at(2), at(8)], ['Ранняя запись', at(1), at(9)],
    ]);
    expect(sideReview(second, 'a').periods[1].events).toEqual([]);
    const end = voteFinish(voteFinish(second, 'a'), 'b');
    const occurred = jointReview(end).periods[0].events;
    expect(occurred).toHaveLength(3);
    expect(reportTime(occurred[0], 'a')).toBe(at(1));
    expect(reportTime(occurred[0], 'b')).toBe(at(9));
    expect(reportTime(occurred[1], 'a')).toBeNull();
    expect(jointReview(end).periods[1].events).toEqual([]);
  });

  it('не доставляет не полученные до остановки сообщения даже после двустороннего раскрытия', () => {
    const start = createSession({ ...scenario, events: [
      { at: at(1), text: 'После дедлайна', audience: 'b', reportAt: { b: at(20) } },
      { at: at(3), text: 'Причина окончания', audience: 'both', reportAt: { a: at(3), b: at(4) }, ends: true },
    ] });
    const end = play(start, 'read', 'check');
    const open = voteUnlock(voteUnlock(end, 'a'), 'b');
    expect(end.now).toBe(at(3));
    expect(sideReview(open, 'a').periods[0].events.map(e => e.text)).toEqual(['Причина окончания']);
    expect(sideReview(open, 'b').periods[0].events).toEqual([]);
    expect(jointReview(open).periods[0].events.map(e => reportTime(e, 'b'))).toEqual([at(20), at(4)]);
  });

  it('проверяет время сообщения и его адресата при создании сценария', () => {
    const event = { at: at(3), text: 'Архив открыт', audience: 'a' } as const;
    expect(() => createSession({ ...scenario, events: [{ ...event, reportAt: { a: at(2) } }] })).toThrow();
    expect(() => createSession({ ...scenario, events: [{ ...event, reportAt: { b: at(3) } }] })).toThrow();
    expect(() => createSession({ ...scenario, events: [{ ...event, audience: 'none', reportAt: { a: at(4) } }] })).toThrow();
  });

  it('сохраняет пустую подтверждённую подборку и разрешает выбор стороне, которая не успела сделать первую запись', () => {
    const materials = [{ id: 'x', label: 'Справка', required: false }];
    const start = createSession({ ...scenario, sides: {
      a: { ...scenario.sides.a, materials }, b: { ...scenario.sides.b, materials },
    } });
    const pending = submitDecision(start, 'a', start.now, { choice: null, materialIds: [] });
    const repeat = restartSession(voteFinish(voteFinish(pending, 'a'), 'b'));
    expect(sideReview(repeat, 'a').initialMaterialIds).toEqual([]);
    expect(sideReview(repeat, 'b').initialMaterialIds).toBeNull();
    expect(sideReview(restartSession(repeat), 'a').initialMaterialIds).toEqual([]);
    expect(() => submitDecision(repeat, 'a', repeat.now, { choice: null, materialIds: ['x'] })).toThrow();
    const first = submitDecision(repeat, 'b', repeat.now, { choice: 'check', materialIds: ['x'] });
    expect(sideReview(first, 'b').materialIds).toEqual(['x']);
  });

  const options = {
    ...scenario.sides.a, materials: [{ id: 'orig', label: 'Основная подборка', required: true }],
    alternatives: [{ country: 'BB', materials: [{ id: 'alt', label: 'Дополнительный архив', required: true }] }],
  };

  it('закрепляет выбранную страну и проверяет материалы именно по её подборке', () => {
    const start = createSession({ ...scenario, sides: { a: options, b: scenario.sides.b } });
    expect(sideReview(start, 'a').countryOptions.map(d => d.country)).toEqual(['AA', 'BB']);
    expect(() => submitDecision(start, 'a', start.now, { choice: 'read', country: 'CC' })).toThrow();
    expect(() => submitDecision(start, 'a', start.now, { choice: 'read', country: 'BB', materialIds: ['orig'] })).toThrow();
    expect(() => submitDecision(start, 'a', start.now, { choice: 'read', country: 'BB', materialIds: [] })).toThrow();
    const pending = submitDecision(start, 'a', start.now, { choice: 'read', country: 'BB', materialIds: ['alt'] });
    const a = sideReview(pending, 'a');
    expect(a.profile).toMatchObject({ country: 'BB', objective: options.objective, materials: options.alternatives[0].materials });
    expect(a.profile).not.toHaveProperty('alternatives');
    expect(a.countryOptions.map(d => d.country)).toEqual(['BB']);
    expect(JSON.stringify(sideReview(pending, 'b'))).not.toContain('Дополнительный архив');
    const both = submitDecision(pending, 'b', start.now, { choice: null });
    expect(() => submitDecision(both, 'a', both.now, { choice: null, country: 'AA' })).toThrow();
    const end = voteFinish(voteFinish(both, 'a'), 'b');
    const open = voteUnlock(voteUnlock(end, 'b'), 'a');
    expect(jointReview(open).sides.a).toEqual(a.profile);
    expect(jointReview(open).sides.b.country).toBe('BB');
    expect(restartSession(open).scenario.sides.a.country).toBe('AA');
    const repeat = restartSession(open);
    expect(sideReview(repeat, 'a').initialCountry).toBe('BB');
    expect(sideReview(repeat, 'a').initialMaterialIds).toEqual(['alt']);
    expect(() => submitDecision(repeat, 'a', repeat.now, { choice: null, country: 'AA', materialIds: ['orig'] })).toThrow();
    expect(sideReview(submitDecision(repeat, 'a', repeat.now, { choice: null }), 'a').pending).toMatchObject({ country: 'BB', materialIds: ['alt'] });
  });

  it('проверяет уникальность стран внутри стороны и каждую подборку при создании', () => {
    const duplicate = { ...options, alternatives: [{ country: options.country }] };
    expect(() => createSession({ ...scenario, sides: { a: duplicate, b: scenario.sides.b } })).toThrow();
    const invalid = { ...options, alternatives: [{ country: 'CC', materials: [{ id: 'x', label: '', required: false }] }] };
    expect(() => createSession({ ...scenario, sides: { a: invalid, b: scenario.sides.b } })).toThrow();
  });

  it('повтор сохраняет выбор страны даже без карточек, неподтверждённые варианты остаются доступными', () => {
    const profile = { ...scenario.sides.a, alternatives: [{ country: 'DD' }] };
    const start = createSession({ ...scenario, sides: { a: profile, b: profile } });
    const pending = submitDecision(start, 'a', start.now, { choice: 'read', country: 'DD' });
    const repeat = restartSession(voteFinish(voteFinish(pending, 'a'), 'b'));
    const twice = restartSession(repeat);
    expect(sideReview(twice, 'a').profile.country).toBe('DD');
    expect(sideReview(twice, 'a').countryOptions.map(d => d.country)).toEqual(['DD']);
    expect(sideReview(twice, 'b').countryOptions.map(d => d.country)).toEqual(['AA', 'DD']);
  });

  it('читает прежнюю запись без поля страны как запись за авторскую страну', () => {
    const start = createSession(scenario);
    const legacy: Session = { ...start, pending: { a: { choice: 'read', note: 'Старая запись' } } };
    expect(sideReview(legacy, 'a').profile.country).toBe(scenario.sides.a.country);
    const end = voteFinish(voteFinish(legacy, 'a'), 'b');
    expect(jointReview(voteUnlock(voteUnlock(end, 'b'), 'a')).sides.a.country).toBe(scenario.sides.a.country);
  });
});
