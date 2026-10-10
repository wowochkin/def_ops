/**
 * Обстановка для штаба модели — из состояния переигровки, на утро хода. Модель
 * знает то же, что знал бы штаб: свои войска (доклады), противника — в пределах
 * разведки (туман войны, оценка сил округлённо), что случилось за сутки, пункты
 * вблизи войск. Шаблоны промптов передаются текстом: так модуль работает и в
 * Node, и в браузере.
 */
import {
  areaTitle, dayEvents, places, detectKm, describePlace, dist, intelReport, nearbyPlaces, orderDelay, rumb, unitReports,
  commandTerms, groupOf, onMap, sectorText, shortName, withBoundaries, type GameState, type SimContext,
} from '@def-ops/sim';
import { fill } from '../fill';

/** Настройки штаба модели для сценария (services/staff/live/<сценарий>.json). */
export interface LiveConfig {
  scenario: string;
  /** Сторона, которую ведёт модель (id из сценария). */
  side: string;
  /** Название стороны для промпта. */
  sideName: string;
  /** Профиль стороны и эпохи — profiles/<profile>.md. */
  profile: string;
  /** «переигровка … (даты)». */
  description: string;
  role: string;
  higher: string;
  constraints: string[];
  /** Пункт-ориентир (id района театра) для описания положения пунктов: «20 км к В от Берлина». */
  anchor: string;
  anchorName: string;
}

export interface Templates { system: string; user: string; profile: string }

export interface Situation {
  messages: { role: 'system' | 'user'; content: string }[];
  /** Свои формирования, которым можно отдавать приказы: id и название (как в обстановке). */
  formations: { id: string; name: string }[];
  /** Пункты из обстановки: id района театра и название (как в обстановке). */
  areas: { id: string; title: string }[];
  /** Все пункты театра (запасной поиск: модель называет пункт, которого нет в ближнем списке). */
  allAreas?: { id: string; title: string }[];
  /** Обнаруженный противник: id и название. */
  enemies: { id: string; name: string }[];
  time: string;
  /** Штаб ведёт тыл, переправы, резервы: базы снабжения и резервы своей стороны (для распоряжений). */
  staff?: { side: string; bases: { id: string; name: string }[]; reserves: { id: string; name: string }[] };
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const part = (h: number) => (h < 5 ? 'ночь' : h < 11 ? 'утро' : h < 17 ? 'день' : h < 22 ? 'вечер' : 'ночь');
/** «утро 19 апреля 1945 года, 05:00». */
export function momentRu(t: string): string {
  const d = new Date(Date.parse(t + (t.length <= 16 ? ':00Z' : '')));
  return `${part(d.getUTCHours())} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} года, ${t.slice(11, 16)}`;
}
const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const num = (x: number) => x.toFixed(1).replace('.', ',');

/** Общая часть обстановки стороны на утро хода: свои силы, противник (туман войны), пункты, снабжение, итоги суток. */
export function situationParts(ctx: SimContext, g: GameState, view: { side: string; anchor: string; anchorName: string }) {
  const T = ctx.theatre, s = g.state, side = view.side;
  const names = new Map(s.formations.map((f) => [f.id, f.name]));
  const own = unitReports(ctx, s, side, g.prev).filter((u) => u.status !== 'destroyed' && s.formations.find((f) => f.id === u.id)!.type);
  const intel = intelReport(ctx, s, side, g.prev);
  const km = detectKm(ctx);
  const anchor = T.area(view.anchor)?.center ?? null;

  const ownLines = own.map((u) => {
    const parent = u.parent ? names.get(u.parent) : null;
    const head = `- ${u.name}${parent ? ` [в составе: ${parent}]` : ''}`;
    if (u.status === 'reserve') return `${head} — резерв Ставки, в сражение не введён; готов к вводу с ${ddmm(u.reserveFrom!)}`;
    if (u.status === 'arriving') return `${head} — прибывает на театр ${ddmm(u.arrives!)}${u.pending.length ? `; приказ ждёт: ${u.pending.map((p) => `${p.task} (${p.target})`).join(', ')}` : ''}`;
    const bits = [
      u.place, u.posture,
      u.task ? `задача: ${u.task} (${u.target})` : 'задачи нет',
      `состав ${pct(u.strength)} (${u.personnel.toLocaleString('ru')} чел., танков и САУ ${u.tanks}, орудий ${u.guns})`,
      `боеприпасы ${num(u.ammo)} бк, горючее ${num(u.fuel)} запр.`,
      `усталость ${pct(u.fatigue)}`,
    ];
    if (u.cutOff) bits.push('ОТРЕЗАНО от подвоза');
    if (u.movedKm >= 1) bits.push(`за сутки переместилось на ${Math.round(u.movedKm)} км`);
    for (const c of u.combats) bits.push(`бой (${c.role === 'attack' ? 'наступали' : 'оборонялись'}) против ${c.against.join(', ')}: ${c.outcome}${c.advanceKm ? ` на ${num(c.advanceKm)} км` : ''}, потери ${c.lossPct} %`);
    if (u.pending.length) bits.push(`приказ в пути: ${u.pending.map((p) => `${p.task} (${p.target})`).join(', ')}`);
    return `${head} — ${bits.join('; ')}.`;
  });

  const enemyLines = intel.length
    ? intel.map((e) => `- ${e.name} — ${e.place}; ${e.posture}; оценка: ${e.estimate}${e.nearest ? `; ближайшее наше — ${e.nearest.name}, ${Math.round(e.nearest.km)} км` : ''}${e.fresh ? '; обнаружено впервые' : ''}.`)
    : ['- В пределах разведки противник не обнаружен.'];

  const near = nearbyPlaces(ctx, s, side, km * 1.5, 70);
  if (anchor && !near.some((a) => a.id === view.anchor)) near.push({ id: view.anchor, title: areaTitle(T.area(view.anchor)!.name), at: anchor, km: 0 });
  const where = (a: { at: [number, number] }) => {
    if (!anchor) return describePlace(T, a.at);
    const d = dist(T.proj.toXY(anchor), T.proj.toXY(a.at));
    return d < Math.max(1, T.cellKm * 2) ? view.anchorName.replace(/^./, (c) => c.toUpperCase()) : `${d < 10 ? num(d) : Math.round(d)} км к ${rumb(T, anchor, a.at)} от ${view.anchorName}`;
  };
  const areaLines = near.map((a) => `- ${a.title} — ${where(a)}`);
  const lines = T.data.lines.filter((l) => l.name).map((l) => l.name);
  if (lines.length) areaLines.push(`Рубежи (для справки; в приказах указывайте пункты): ${lines.join('; ')}.`);

  const cut = own.filter((u) => u.cutOff).map((u) => u.name);
  const lowAmmo = own.filter((u) => u.status === 'active' && u.ammo < 0.5).map((u) => u.name);
  const noFuel = own.filter((u) => u.status === 'active' && u.fuel <= 0.05).map((u) => u.name);
  const supply = [
    cut.length ? `Отрезаны от подвоза (окружены): ${cut.join(', ')}.` : 'Окружённых соединений нет.',
    lowAmmo.length ? `Боеприпасов меньше половины боекомплекта: ${lowAmmo.join(', ')}.` : null,
    noFuel.length ? `Без горючего (технику двигать нельзя): ${noFuel.join(', ')}.` : null,
    'Подвоз идёт только по своей территории; отрезанные получают его лишь после восстановления связи.',
  ].filter(Boolean) as string[];

  // полосы и разграничительные линии своей стороны (директивы — только уже действующие)
  const bounds = sectorText(T, withBoundaries(ctx.scenario, s), s.formations.filter((f) => onMap(f, s.time)).map((f) => ({ id: f.id, side: f.side, at: f.position })), side, s.time,
    (id) => shortName(names.get(id) ?? ctx.scenario.formations.find((f) => f.id === id)?.name ?? id));

  const lastDay = g.prev ? dayEvents(ctx, s, side, g.prev) : [];
  const delays = [...new Set(own.map((u) => `${u.echelon === 'army' ? 'армиям' : u.echelon === 'corps' ? 'корпусам' : u.echelon === 'division' ? 'дивизиям' : u.echelon} — ${orderDelay(ctx, { side, echelon: u.echelon })} ч`))].join(', ');
  return {
    vars: {
      last_day: lastDay.length ? lastDay.map((x) => `- ${x}`).join('\n') : '- Существенных событий не отмечено.',
      own_forces: ownLines.join('\n'),
      detect_km: String(Math.round(km)),
      enemy: enemyLines.join('\n'),
      areas: areaLines.join('\n'),
      supply: supply.map((x) => `- ${x}`).join('\n'),
      boundaries: bounds.length ? bounds.map((x) => `- ${x}`).join('\n') : '- Нет.',
    },
    delays,
    own,
    formations: own.map((u) => ({ id: u.id, name: u.name })),
    areas: near.map((a) => ({ id: a.id, title: a.title })),
    allAreas: places(T).map((a) => ({ id: a.id, title: a.title })),
    enemies: intel.map((e) => ({ id: e.id, name: e.name })),
  };
}

export function buildSituation(ctx: SimContext, g: GameState, cfg: LiveConfig, tpl: Templates, previous?: { time: string; intent: string } | null, staffOn = false): Situation {
  const s = g.state;
  const p = situationParts(ctx, g, cfg);
  const hours = ctx.scenario.turnHours;
  const terms = commandTerms(ctx, cfg.side);
  // свои армии — по объединениям верхнего уровня (для разграничительных линий)
  const fronts = groupOf(ctx.scenario, 'front'), armyOf = groupOf(ctx.scenario, 'army');
  const armies = ctx.scenario.formations.filter((f) => f.side === cfg.side && f.echelon === 'army' && s.formations.some((u) => !u.destroyed && onMap(u, s.time) && (armyOf.get(u.id) ?? u.id) === f.id))
    .map((f) => `${f.name} (${ctx.scenario.formations.find((x) => x.id === fronts.get(f.id))?.name ?? 'вне объединения'})`);
  const system = fill(tpl.system, { side: cfg.sideName, scenario: cfg.description, profile: tpl.profile.trim() }, 'staff.system.md');
  const user = fill(tpl.user, {
    moment: momentRu(s.time),
    turn: String(s.turn + 1),
    role: cfg.role,
    higher: cfg.higher,
    constraints: cfg.constraints.map((c) => `- ${c}`).join('\n'),
    previous: previous ? `(${momentRu(previous.time)}) ${previous.intent}` : 'нет — это первое решение в игре; до сих пор войска действовали по прежним приказам.',
    ...p.vars,
    question: `Примите решение на ${hours === 24 ? 'сутки' : `${hours} ч`} — до ${momentRu(addH(s.time, hours))}. Приказы доходят до войск не сразу: ${p.delays}. `
      + 'Отдавайте приказы только тем формированиям, чья задача должна измениться: остальные продолжают выполнять действующие. '
      + 'area — пункт из списка, где действовать (для обороны — где занять оборону, для наступления и контратаки — цель); '
      + 'toArea — куда (для отхода, прорыва, перегруппировки, деблокирования), иначе null. Если формирование обороняется на месте — area — пункт, у которого оно стоит.'
      + (staffOn ? ' Вы ведёте и тыл с инженерными войсками — поле actions (может быть пустым): '
        + 'base — перенести базу снабжения (subject — название базы из списка, area — пункт; на время переноса база не действует); '
        + 'priority — приоритет подвоза (formations — не более трети своих формирований; им больше, остальным меньше); '
        + 'bridge — навести переправу (area — пункт у реки); demolish — подорвать мост или переправу (area — пункт у моста, на своей территории); '
        + 'commit — ввести резерв в сражение (subject — формирование из резерва, area — район сосредоточения на своей территории); '
        + `line — разграничительная линия между двумя своими армиями одного ${terms.group === 'фронт' ? 'фронта' : 'объединения (группы армий)'}, когда они мешают друг другу или нужна новая полоса `
        + `(formations — две армии${armies.length ? ` из: ${armies.join('; ')}` : ''}; area — пункты линии по порядку через « — », от тыла к переднему краю, от 2 до 6; вступает в силу через задержку доведения армиям; `
        + `линию, разделяющую ${terms.group === 'фронт' ? 'фронты' : 'группы армий'}, устанавливает ${terms.top}). `
        + 'В полях subject, area, formations — названия точно как в обстановке; в неиспользуемых — null или пустой список.'
        : ' Тыл, переправы и резервы ведёт вышестоящее командование: поле actions оставьте пустым.'),
    rear: staffOn ? rearText(ctx, g, cfg.side) : '- Ведёт вышестоящее командование (по плану).',
  }, 'staff.live.md');
  return {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    formations: p.formations.filter((f) => p.own.find((u) => u.id === f.id)!.status !== 'reserve'),
    areas: p.areas, allAreas: p.allAreas, enemies: p.enemies, time: s.time,
    ...(staffOn ? { staff: {
      side: cfg.side,
      bases: (s.logistics?.[cfg.side]?.bases ?? []).map((b) => ({ id: b.id, name: b.name })),
      reserves: s.formations.filter((f) => f.side === cfg.side && f.reserveFrom && !f.destroyed).map((f) => ({ id: f.id, name: f.name })),
    } } : {}),
  };
}

const addH = (t: string, h: number) => new Date(Date.parse(t + (t.length <= 16 ? ':00Z' : '')) + h * 3600_000).toISOString().slice(0, 16);

/** Тыл, переправы, резервы стороны — словами (для штаба модели и советника). */
export function rearText(ctx: SimContext, g: GameState, side: string): string {
  const s = g.state, T = ctx.theatre;
  const lg = s.logistics?.[side];
  const out: string[] = [];
  if (lg) {
    out.push(`- Базы снабжения: ${lg.bases.map((b) => `${b.name}${b.activeFrom && b.activeFrom > s.time ? ` (переносится до ${b.activeFrom.slice(8, 10)}.${b.activeFrom.slice(5, 7)})` : ''}`).join('; ')}.`);
    if (lg.priority.length) out.push(`- Приоритет подвоза: ${lg.priority.map((id) => s.formations.find((f) => f.id === id)?.name).join(', ')}.`);
  }
  const building = T.data.bridges.filter((b) => b.side === side && b.openFrom && b.openFrom > s.time);
  if (building.length) out.push(`- Наводятся переправы: ${building.map((b) => b.name).join('; ')}.`);
  const res = s.formations.filter((f) => f.side === side && f.reserveFrom);
  if (res.length) out.push(`- Резервы Ставки, не введённые в сражение: ${res.map((f) => `${f.name} (готов с ${f.reserveFrom!.slice(8, 10)}.${f.reserveFrom!.slice(5, 7)})`).join('; ')}.`);
  const coming = s.formations.filter((f) => f.side === side && !f.reserveFrom && f.enterAt && f.enterAt > s.time && !onMap(f, s.time));
  if (coming.length) out.push(`- Вводятся в сражение: ${coming.map((f) => f.name).join('; ')}.`);
  return out.length ? out.join('\n') : '- Особых распоряжений нет.';
}
