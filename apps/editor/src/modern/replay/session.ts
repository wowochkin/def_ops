export type Side = 'a' | 'b';
type BySide<T> = Readonly<Record<Side, T>>;

export interface Material {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly category?: string;
  readonly summary?: string;
  readonly sourceUrl?: string;
}

export interface CountryDossier {
  readonly country: string;
  readonly materials?: readonly Material[];
}

export interface Profile extends CountryDossier {
  readonly objective: string;
  readonly alternatives?: readonly CountryDossier[];
}

export interface Choice {
  readonly id: string;
  readonly label: string;
}

export interface LoggedEvent {
  readonly at: string;
  readonly text: string;
  readonly audience: Side | 'both' | 'none';
  readonly announcement?: string;
  readonly ends?: boolean;
  readonly reportAt?: Partial<BySide<string>>;
}

export type ReceivedEvent = Omit<LoggedEvent, 'reportAt'> & { readonly receivedAt: string };

export interface ScenarioEvent extends LoggedEvent {
  readonly when?: Partial<BySide<string>>;
}

export interface Scenario {
  readonly title: string;
  readonly area: string;
  readonly areaKey?: string;
  readonly areaBounds?: readonly [number, number, number, number];
  readonly start: string;
  readonly end: string;
  readonly periodHours: 6 | 12;
  readonly disclosure: 'immediate' | 'mutual';
  readonly sides: BySide<Profile>;
  readonly choices: readonly Choice[];
  readonly events: readonly ScenarioEvent[];
}

export interface Decision {
  readonly choice: string | null;
  readonly note: string;
  readonly country?: string;
  readonly format?: 'directive' | 'separate';
  readonly materialIds?: readonly string[];
}

type DecisionInput = Omit<Decision, 'note'> & { readonly note?: string };

export interface Period {
  readonly start: string;
  readonly end: string;
  readonly decisions: BySide<Decision>;
  readonly effectiveChoices: BySide<string | null>;
  readonly events: readonly LoggedEvent[];
}

export interface Session {
  readonly scenario: Scenario;
  readonly now: string;
  readonly status: 'active' | 'finished';
  readonly reason: 'deadline' | 'event' | 'agreement' | null;
  readonly pending: Partial<BySide<Decision>>;
  readonly periods: readonly Period[];
  readonly finishVotes: readonly Side[];
  readonly unlockVotes: readonly Side[];
  readonly initialMaterials?: Partial<BySide<readonly string[]>>;
  readonly initialCountries?: Partial<BySide<string>>;
}

const sides: readonly Side[] = ['a', 'b'];

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function instant(value: string): string {
  const date = new Date(value);
  requireThat(
    typeof value === 'string' && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(date.valueOf()), 'Укажите дату и время с часовым поясом.',
  );
  const day = value.slice(0, 10);
  requireThat(new Date(`${day}T00:00Z`).toISOString().startsWith(day), 'Указан несуществующий день.');
  return date.toISOString();
}

function validateCatalog(items: readonly Choice[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    requireThat(hasText(item.id) && hasText(item.label), 'Укажите название каждой позиции.');
    requireThat(!ids.has(item.id), 'Идентификаторы позиций должны различаться.');
    ids.add(item.id);
  }
}

export function countryOptions(profile: Profile): readonly CountryDossier[] {
  const { country, materials } = profile;
  return [{ country, materials }, ...(profile.alternatives ?? [])];
}

export function countryDossier(profile: Profile, country: string): CountryDossier {
  const dossier = countryOptions(profile).find(option => option.country === country);
  requireThat(dossier, 'Выберите страну из списка своей стороны.');
  return dossier;
}

function validateProfile(profile: Profile): void {
  requireThat(profile && hasText(profile.objective), 'Укажите задачу каждой стороны.');
  const countries = new Set<string>();
  for (const dossier of countryOptions(profile)) {
    requireThat(hasText(dossier.country), 'Укажите страну каждой подборки.');
    const key = dossier.country.trim().toLocaleLowerCase('ru');
    requireThat(!countries.has(key), 'В списке одной стороны страна может встречаться только один раз.');
    countries.add(key);
    const materials = dossier.materials ?? [];
    validateCatalog(materials);
    for (const material of materials) {
      requireThat(typeof material.required === 'boolean', 'Проверьте обязательность материала.');
      if (material.sourceUrl !== undefined) {
        requireThat(URL.canParse(material.sourceUrl) && new URL(material.sourceUrl).protocol === 'https:', 'Укажите HTTPS-ссылку на источник.');
      }
    }
  }
}

export function createSession(input: Scenario): Session {
  const scenario = structuredClone(input);
  const start = instant(scenario.start);
  const end = instant(scenario.end);
  requireThat(start < end, 'Окончание должно следовать за началом.');
  requireThat(hasText(scenario.title) && hasText(scenario.area), 'Укажите название и область.');
  requireThat([6, 12].includes(scenario.periodHours), 'Допустим период в 6 или 12 часов.');
  requireThat(['immediate', 'mutual'].includes(scenario.disclosure), 'Выберите порядок раскрытия записей.');
  if (scenario.areaBounds !== undefined) {
    requireThat(scenario.areaBounds.length === 4 && scenario.areaBounds.every(Number.isFinite), 'Проверьте границы области.');
  }
  requireThat(scenario.choices.length > 0, 'Добавьте вариант решения.');
  validateCatalog(scenario.choices);
  for (const side of sides) validateProfile(scenario.sides[side]);
  const events = scenario.events.map(event => {
    const at = instant(event.at);
    requireThat(at >= start && at <= end, 'Событие должно попадать в сроки сессии.');
    requireThat(hasText(event.text) && ['a', 'b', 'both', 'none'].includes(event.audience), 'Введите текст события и укажите адресата.');
    for (const [side, id] of Object.entries(event.when ?? {})) {
      requireThat(sides.some(s => s === side) && scenario.choices.some(c => c.id === id), 'Неизвестная сторона или вариант в условии события.');
    }
    if (event.reportAt === undefined) return { ...event, at };
    const reportAt: Partial<Record<Side, string>> = {};
    for (const [side, time] of Object.entries(event.reportAt)) {
      requireThat((side === 'a' || side === 'b') && (event.audience === 'both' || event.audience === side), 'Укажите срок сообщения только для его адресата.');
      const receivedAt = instant(time);
      requireThat(receivedAt >= at, 'Сообщение не может предшествовать событию.');
      reportAt[side] = receivedAt;
    }
    return { ...event, at, reportAt };
  });
  return {
    scenario: { ...scenario, start, end, events }, now: start, status: 'active', reason: null,
    pending: {}, periods: [], finishVotes: [], unlockVotes: [],
  };
}

function openingProfile(session: Session, side: Side) {
  const config = session.scenario.sides[side];
  const first = session.periods[0]?.decisions[side] ?? session.pending[side];
  const initialCountry = session.initialCountries?.[side] ?? null;
  const selected = countryDossier(config, first?.country ?? initialCountry ?? config.country);
  const profile = { ...selected, objective: config.objective };
  return { profile, first, initialCountry, confirmed: first !== undefined || initialCountry !== null };
}

export function restartSession(session: Session): Session {
  const fresh = createSession(session.scenario);
  const initialMaterials: Partial<Record<Side, readonly string[]>> = {};
  const initialCountries: Partial<Record<Side, string>> = {};
  for (const side of sides) {
    const { profile, first, confirmed } = openingProfile(session, side);
    if (confirmed && fresh.scenario.sides[side].alternatives?.length) initialCountries[side] = profile.country;
    const ids = first?.materialIds ?? session.initialMaterials?.[side];
    if (ids !== undefined && profile.materials?.length) initialMaterials[side] = [...ids];
  }
  return {
    ...fresh, ...(Object.keys(initialCountries).length > 0 && { initialCountries }),
    ...(Object.keys(initialMaterials).length > 0 && { initialMaterials }),
  };
}

export function periodEnd(session: Session): string {
  if (session.status === 'finished') return session.now;
  const next = Date.parse(session.now) + session.scenario.periodHours * 3_600_000;
  return new Date(Math.min(next, Date.parse(session.scenario.end))).toISOString();
}

function checkSide(side: Side): void {
  requireThat(sides.includes(side), 'Неизвестная сторона.');
}

function recordDecision(session: Session, side: Side, input: DecisionInput): Decision {
  requireThat(input.choice === null || session.scenario.choices.some(c => c.id === input.choice), 'Выберите вариант из сценария.');
  requireThat(input.note === undefined || typeof input.note === 'string', 'Проверьте текст записи.');
  requireThat(input.format === undefined || ['directive', 'separate'].includes(input.format), 'Неизвестная форма записи.');
  const decision: Decision = { choice: input.choice, note: input.note ?? '', ...(input.format && { format: input.format }) };
  if (session.periods.length > 0) {
    requireThat(input.materialIds === undefined, 'Выбор материалов уже сохранён.');
    requireThat(input.country === undefined, 'Страна стороны уже выбрана.');
    return decision;
  }
  const profile = session.scenario.sides[side];
  const lockedCountry = session.initialCountries?.[side];
  const country = input.country ?? lockedCountry ?? profile.country;
  requireThat(lockedCountry === undefined || country === lockedCountry, 'Страна сохранена из исходного сеанса.');
  const catalog = countryDossier(profile, country).materials ?? [];
  const preset = session.initialMaterials?.[side];
  const ids = input.materialIds ?? preset ?? [];
  requireThat(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => catalog.some(m => m.id === id)), 'В подборке есть неизвестный или повторный материал.');
  requireThat(catalog.every(m => !m.required || ids.includes(m.id)), 'Включите все обязательные материалы.');
  if (preset) {
    requireThat(ids.length === preset.length && preset.every(id => ids.includes(id)), 'Подборка материалов сохранена из исходного сеанса.');
    return { ...decision, country, materialIds: [...preset] };
  }
  return { ...decision, country, materialIds: [...ids] };
}

function closePeriod(session: Session, decisions: BySide<Decision>): Session {
  const previous = session.periods.at(-1)?.effectiveChoices;
  const effectiveChoices = {
    a: decisions.a.choice ?? previous?.a ?? null,
    b: decisions.b.choice ?? previous?.b ?? null,
  };
  const plannedEnd = periodEnd(session);
  // Граница принадлежит предыдущему периоду. Начальный момент входит только в первый период.
  const occurred = session.scenario.events.filter(event => (
    (event.at > session.now || (!previous && event.at === session.now)) && event.at <= plannedEnd
    && sides.every(side => !event.when?.[side] || event.when[side] === effectiveChoices[side])
  )).sort((a, b) => a.at.localeCompare(b.at));
  const ending = occurred.find(event => event.ends);
  const end = ending?.at ?? plannedEnd;
  const events: LoggedEvent[] = occurred.filter(event => event.at <= end).map(({ at, text, audience, announcement, ends, reportAt }) => (
    { at, text, audience, ...(announcement && { announcement }), ...(ends && { ends }), ...(reportAt && { reportAt }) }
  ));
  const reason = ending ? 'event' : end === session.scenario.end ? 'deadline' : null;
  return {
    ...session, now: end, status: reason ? 'finished' : 'active', reason, pending: {}, finishVotes: [],
    periods: [...session.periods, { start: session.now, end, decisions, effectiveChoices, events }],
  };
}

export function submitDecision(session: Session, side: Side, expectedStart: string, input: DecisionInput): Session {
  checkSide(side);
  requireThat(session.status === 'active' && session.now === expectedStart, 'Период уже закрыт.');
  requireThat(!session.pending[side], 'Сторона уже сдала запись.');
  const pending = { ...session.pending, [side]: recordDecision(session, side, input) };
  if (pending.a && pending.b) return closePeriod(session, { a: pending.a, b: pending.b });
  return { ...session, pending };
}

export function voteFinish(session: Session, side: Side): Session {
  checkSide(side);
  requireThat(session.status === 'active', 'Сессия уже завершена.');
  if (session.finishVotes.includes(side)) return session;
  const finishVotes = [...session.finishVotes, side];
  if (finishVotes.length === 1) return { ...session, finishVotes };
  return { ...session, status: 'finished', reason: 'agreement', finishVotes };
}

export function voteUnlock(session: Session, side: Side): Session {
  checkSide(side);
  requireThat(session.status === 'finished', 'Сначала завершите сессию.');
  if (canJointReview(session) || session.unlockVotes.includes(side)) return session;
  return { ...session, unlockVotes: [...session.unlockVotes, side] };
}

export function canJointReview(session: Session): boolean {
  return session.status === 'finished' && (session.scenario.disclosure === 'immediate' || sides.every(side => session.unlockVotes.includes(side)));
}

export function reportTime(event: LoggedEvent, side: Side): string | null {
  checkSide(side);
  if (event.audience !== 'both' && event.audience !== side) return null;
  return event.reportAt?.[side] ?? event.at;
}

export function sideReview(session: Session, side: Side) {
  checkSide(side);
  const pending = session.pending[side] ?? null;
  const { profile, first, initialCountry, confirmed } = openingProfile(session, side);
  const initialMaterialIds = session.initialMaterials?.[side] ?? null;
  const receipts: ReceivedEvent[] = [];
  for (const period of session.periods) {
    for (const event of period.events) {
      const receivedAt = reportTime(event, side);
      if (receivedAt === null || receivedAt > session.now) continue;
      const { at, text, announcement, ends } = event;
      receipts.push({ at, receivedAt, text, audience: side, ...(announcement && { announcement }), ...(ends && { ends }) });
    }
  }
  receipts.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  let next = 0;
  const periods = session.periods.map(period => {
    const first = next;
    while (next < receipts.length && receipts[next].receivedAt <= period.end) next++;
    return {
      start: period.start, end: period.end, decision: period.decisions[side], effectiveChoice: period.effectiveChoices[side],
      events: receipts.slice(first, next),
    };
  });
  return {
    profile, choices: session.scenario.choices, initialCountry,
    countryOptions: countryOptions(confirmed || session.status === 'finished' ? profile : session.scenario.sides[side]),
    initialMaterialIds, materialIds: first?.materialIds ?? initialMaterialIds ?? [], pending, periods,
  };
}

export function jointReview(session: Session) {
  requireThat(canJointReview(session), 'Совместный разбор пока закрыт.');
  const profiles = { a: openingProfile(session, 'a').profile, b: openingProfile(session, 'b').profile };
  return { sides: profiles, periods: session.periods, pending: session.pending };
}
