/**
 * Пакет операции для переигровки: сценарий, театр, история (и по желанию — участки, настройки штаба модели,
 * запись каталога, свои правила и профили). Проверка перед переигровкой: что ссылки сходятся (стороны,
 * профили, правила, районы, формирования), что есть с чем сравнивать (положения, события), что задано
 * окончание игры; и заготовки по умолчанию для того, чего в пакете нет.
 */
import type { History } from './history';
import type { Rules, Scenario, SideProfile, TheatreData } from './types';
import { areaTitle } from './reports';
import type { InfraRecord } from './infrastructure';

/** Запись каталога переигровки: название, допуск сравнения, наборы правил, условия окончания игры. */
export interface CatalogEntry {
  id: string;
  title: string;
  detail: string;
  toleranceKm: number;
  rules: { id: string; title: string }[];
  game?: { victory: { event: string; title: string }; defeat: { strengthBelow: number; deadline: string; deadlineText: string } };
}

/** Настройки штаба на модели и советника (как services/staff/live/<сценарий>.json). */
export interface LiveSetup {
  scenario: string; side: string; sideName: string; profile: string; description: string; role: string; higher: string;
  constraints: string[]; anchor: string; anchorName: string;
  advisor?: { side: string; sideName: string; profile: string; role: string; anchor: string; anchorName: string };
}

export interface OperationPackage {
  scenario: Scenario;
  theatre: TheatreData;
  history: History;
  sectors?: { sectors: { id: string; title: string; bbox: [number, number, number, number] }[] };
  live?: LiveSetup;
  catalog?: CatalogEntry;
  rules?: Rules[];
  profiles?: SideProfile[];
  /** Сведения о состоянии инфраструктуры (мосты, переправы, дороги) — поверх театра. */
  infrastructure?: InfraRecord[];
}

export interface PackageIssue { level: 'error' | 'warning' | 'info'; part: 'сценарий' | 'театр' | 'история' | 'игра' | 'штаб'; text: string }

/** Какой это файл пакета — по полям. */
export function detectPart(j: unknown): keyof OperationPackage | 'bundle' | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.scenario && typeof o.scenario === 'object' && o.theatre && o.history) return 'bundle';
  if (Array.isArray(o.formations) && Array.isArray(o.sides)) return 'scenario';
  if (Array.isArray(o.areas) && o.bbox && o.cellKm) return 'theatre';
  if (Array.isArray(o.positions) && Array.isArray(o.frontline)) return 'history';
  if (Array.isArray(o.sectors)) return 'sectors';
  if (typeof o.side === 'string' && typeof o.role === 'string' && typeof o.anchor === 'string') return 'live';
  if (Array.isArray(o.advance) && Array.isArray(o.attackerLoss)) return 'rules';
  if (o.weights && o.unitTypes) return 'profiles';
  if (typeof o.toleranceKm === 'number' && Array.isArray(o.rules)) return 'catalog';
  return null;
}

const inBox = (b: [number, number, number, number], p: [number, number]) => p[0] >= b[0] - 0.05 && p[0] <= b[2] + 0.05 && p[1] >= b[1] - 0.05 && p[1] <= b[3] + 0.05;

/**
 * Проверить пакет. known — что уже есть в системе (id правил и профилей), чтобы ссылки на них не считать ошибкой.
 */
export function validateOperation(pkg: Partial<OperationPackage>, known: { rules: string[]; profiles: string[] }): PackageIssue[] {
  const I: PackageIssue[] = [];
  const err = (part: PackageIssue['part'], text: string) => I.push({ level: 'error', part, text });
  const warn = (part: PackageIssue['part'], text: string) => I.push({ level: 'warning', part, text });
  const info = (part: PackageIssue['part'], text: string) => I.push({ level: 'info', part, text });
  const { scenario: S, theatre: T, history: H } = pkg;
  if (!S) err('сценарий', 'нет файла сценария (стороны, формирования, приказы, сроки)');
  if (!T) err('театр', 'нет файла театра (местность, дороги, реки, районы)');
  if (!H) err('история', 'нет файла истории (положения по дням, линия фронта, ключевые события)');
  if (!S || !T || !H) return I;

  // сценарий
  if (!S.id || !/^[a-z0-9][a-z0-9-]*$/.test(S.id)) err('сценарий', `id «${S.id}» — нужны латинские строчные буквы, цифры и дефис`);
  if (!(Date.parse(S.start) < Date.parse(S.end))) err('сценарий', `сроки: начало ${S.start} должно быть раньше конца ${S.end}`);
  if (!(S.turnHours > 0)) err('сценарий', 'длительность хода (turnHours) должна быть больше нуля');
  if (S.theatre !== T.id) err('сценарий', `сценарий ссылается на театр «${S.theatre}», а загружен «${T.id}»`);
  if ((S.sides ?? []).length < 2) err('сценарий', 'сторон должно быть не меньше двух');
  const profiles = new Map((pkg.profiles ?? []).map((p) => [p.id, p]));
  for (const s of S.sides ?? []) if (!profiles.has(s.profile) && !known.profiles.includes(s.profile)) err('сценарий', `сторона «${s.name}»: нет профиля «${s.profile}» (есть: ${[...known.profiles, ...profiles.keys()].join(', ')})`);
  const ruleIds = [...known.rules, ...(pkg.rules ?? []).map((r) => r.id)];
  if (!ruleIds.includes(S.rules)) err('сценарий', `правила «${S.rules}» не найдены (есть: ${ruleIds.join(', ')})`);
  const areas = new Set(T.areas.map((a) => a.id));
  const sides = new Set((S.sides ?? []).map((s) => s.id));
  const ids = new Set<string>();
  let outside = 0, noType = 0;
  for (const f of S.formations ?? []) {
    if (ids.has(f.id)) err('сценарий', `формирование «${f.id}» встречается дважды`);
    ids.add(f.id);
    if (!sides.has(f.side)) err('сценарий', `${f.name}: сторона «${f.side}» не описана`);
    if (f.position && !inBox(T.bbox, f.position)) outside++;
    const prof = profiles.get(S.sides.find((s) => s.id === f.side)?.profile ?? '');
    if (f.type && prof && !prof.unitTypes[f.type]) noType++;
  }
  for (const f of S.formations ?? []) if (f.parent && !ids.has(f.parent)) warn('сценарий', `${f.name}: вышестоящий «${f.parent}» не найден`);
  // стратегический уровень карты собирает войска по фронтам (группам армий): без такого вышестоящего — отдельно
  const byIdF = new Map((S.formations ?? []).map((f) => [f.id, f]));
  const noFront = (S.formations ?? []).filter((f) => f.echelon !== 'front' && (f.type || f.echelon === 'army') && !f.parent).map((f) => f.name);
  const top = (S.formations ?? []).filter((f) => f.echelon === 'army' && (() => { let p = f.parent ? byIdF.get(f.parent) : undefined; for (let k = 0; p && k < 6; k++) { if (p.echelon === 'front') return false; p = p.parent ? byIdF.get(p.parent) : undefined; } return true; })()).map((f) => f.name);
  const loose = [...new Set([...noFront, ...top])];
  if (loose.length) warn('сценарий', `без вышестоящего фронта (группы армий): ${loose.slice(0, 6).join(', ')}${loose.length > 6 ? ` и ещё ${loose.length - 6}` : ''} — на стратегическом уровне карты покажутся отдельно; укажите parent (например, узел ОКВ или Ставки с echelon «front»)`);
  if (outside) warn('сценарий', `формирований вне театра: ${outside}`);
  if (noType) warn('сценарий', `формирований с типом, которого нет в профиле стороны: ${noType}`);
  const active = (S.formations ?? []).filter((f) => f.type && f.position);
  if (!active.length) err('сценарий', 'нет действующих формирований (с типом и положением)');
  let badOrders = 0;
  for (const o of S.orders ?? []) {
    if (!ids.has(o.formation)) badOrders++;
    else if (typeof o.target === 'string' && !areas.has(o.target)) badOrders++;
  }
  if (badOrders) warn('сценарий', `приказов с неизвестным формированием или районом: ${badOrders} (не будут исполнены)`);
  for (const [side, sp] of Object.entries(S.supply ?? {})) for (const src of sp.sources) if (typeof src === 'string' && !areas.has(src)) warn('сценарий', `снабжение стороны ${side}: район «${src}» не найден в театре`);
  if (!S.supply) info('сценарий', 'источники снабжения не заданы — снабжение без подвоза');

  // театр
  if (!(T.cellKm > 0)) err('театр', 'шаг сетки (cellKm) должен быть больше нуля');
  if (!(T.bbox[0] < T.bbox[2] && T.bbox[1] < T.bbox[3])) err('театр', 'границы (bbox) заданы неверно');
  if (!T.terrainGrid && !T.terrain?.length) warn('театр', 'нет растра местности — вся местность будет «по умолчанию»');
  if (!T.areas.length) err('театр', 'нет районов — приказам и событиям не на что ссылаться');
  if (!T.rivers?.length) info('театр', 'рек нет');
  if (!T.roads?.length && !T.roadGrid) warn('театр', 'дорог нет — марш только вне дорог');

  // история
  if (H.scenario && H.scenario !== S.id) warn('история', `история помечена для сценария «${H.scenario}»`);
  const inPeriod = H.positions.filter((p) => p.time > S.start && p.time <= S.end && ids.has(p.formation));
  if (!inPeriod.length) err('история', 'нет исторических положений формирований сценария в его сроки — сравнивать не с чем');
  else info('история', `положений для сравнения: ${inPeriod.length}, формирований: ${new Set(inPeriod.map((p) => p.formation)).size}`);
  const unknownPos = H.positions.filter((p) => !ids.has(p.formation)).length;
  if (unknownPos) warn('история', `положений неизвестных формирований: ${unknownPos} (пропускаются)`);
  const events = H.events ?? [];
  if (!events.length) warn('история', 'нет ключевых событий — не по чему сверять даты и нечем задать победу');
  for (const e of events) {
    if ('place' in e && !areas.has(e.place)) err('история', `событие «${e.title}»: район «${e.place}» не найден в театре`);
    const fs = 'formations' in e && e.formations ? e.formations : 'formation' in e && e.formation ? [e.formation] : [];
    for (const f of fs) if (!ids.has(f)) err('история', `событие «${e.title}»: формирование «${f}» не найдено`);
  }
  if (!H.frontline?.length) info('история', 'исторической линии фронта нет — на карте не будет «ист. фронта»');

  // игра (передача командования человеку)
  const g = pkg.catalog?.game;
  if (!g) warn('игра', 'условия окончания игры не заданы — будут взяты по умолчанию (победа — последнее событие истории)');
  else if (!events.some((e) => e.id === g.victory.event)) err('игра', `победа: событие «${g.victory.event}» не найдено в истории`);

  // штаб модели
  if (!pkg.live) warn('штаб', 'настроек штаба на модели нет — будут составлены по умолчанию (противник — вторая сторона)');
  else {
    if (!sides.has(pkg.live.side)) err('штаб', `штаб модели ведёт сторону «${pkg.live.side}», а её нет в сценарии`);
    if (!areas.has(pkg.live.anchor)) err('штаб', `опорный пункт «${pkg.live.anchor}» не найден в театре`);
  }
  return I;
}

/** Запись каталога по умолчанию. */
export function defaultCatalog(pkg: OperationPackage): CatalogEntry {
  const S = pkg.scenario, ev = pkg.history.events ?? [];
  const last = ev[ev.length - 1];
  const deadline = new Date(Date.parse(S.end + 'Z') + 10 * 86400_000).toISOString().slice(0, 16);
  return {
    id: S.id,
    title: S.name,
    detail: `${S.formations.filter((f) => f.type && f.position).length} формирований, клетка ${pkg.theatre.cellKm} км, ход ${S.turnHours} ч`,
    toleranceKm: pkg.theatre.cellKm <= 0.5 ? 2 : 10,
    rules: [{ id: S.rules, title: `правила сценария (${S.rules})` }],
    ...(last ? { game: { victory: { event: last.id, title: last.title }, defeat: { strengthBelow: 0.35, deadline, deadlineText: `цель не достигнута к ${deadline.slice(8, 10)}.${deadline.slice(5, 7)}` } } } : {}),
  };
}

/** Настройки штаба модели и советника по умолчанию: модель — вторая сторона, человек — первая. */
export function defaultLive(pkg: OperationPackage): LiveSetup {
  const S = pkg.scenario, T = pkg.theatre;
  const [human, ai] = S.sides;
  // опорный пункт — район в центре театра
  const cx = (T.bbox[0] + T.bbox[2]) / 2, cy = (T.bbox[1] + T.bbox[3]) / 2;
  const center = (r: [number, number][]) => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);
  const anchor = [...T.areas].sort((a, b) => { const p = center(a.ring), q = center(b.ring); return Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy); })[0];
  return {
    scenario: S.id, side: ai.id, sideName: ai.name, profile: ai.profile,
    description: `переигровка: ${S.name}`,
    role: `командующий войсками стороны «${ai.name}» в операции`,
    higher: 'верховное командование',
    constraints: [],
    anchor: anchor?.id ?? '', anchorName: anchor ? areaTitle(anchor.name) : '',
    advisor: { side: human.id, sideName: human.name, profile: human.profile, role: `начальник оперативного отдела штаба стороны «${human.name}»`, anchor: anchor?.id ?? '', anchorName: anchor ? areaTitle(anchor.name) : '' },
  };
}
