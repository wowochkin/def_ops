/**
 * Обстановка для штаба модели — из состояния переигровки, на утро хода. Модель
 * знает то же, что знал бы штаб: свои войска (доклады), противника — в пределах
 * разведки (туман войны, оценка сил округлённо), что случилось за сутки, пункты
 * вблизи войск. Шаблоны промптов передаются текстом: так модуль работает и в
 * Node, и в браузере.
 */
import {
  areaTitle, dayEvents, places, detectKm, describePlace, dist, hqReports, intelReport, nearbyPlaces, orderDelay, rumb, unitReports,
  commandTerms, groupOf, onMap, profileOf, sectorText, shortName, supplyHoursOf, withBoundaries, type GameState, type SimContext,
} from '@def-ops/sim';
import type { DoctrineRule, RoleRef } from '@def-ops/knowledge';
import { fill } from '../fill';
import { kbBlocks } from './kb-blocks';

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
  /** parent — вышестоящее по подчинению (для приказа «всем соединениям»). */
  formations: { id: string; name: string; parent?: string | null }[];
  /** Пункты из обстановки: id района театра и название (как в обстановке). */
  areas: { id: string; title: string; at?: [number, number] }[];
  /** Все пункты театра (запасной поиск: модель называет пункт, которого нет в ближнем списке). */
  allAreas?: { id: string; title: string; at?: [number, number] }[];
  /** Обнаруженный противник: id и название. */
  enemies: { id: string; name: string }[];
  time: string;
  /** Штаб ведёт тыл, переправы, резервы: базы снабжения и резервы своей стороны (для распоряжений). */
  staff?: { side: string; bases: { id: string; name: string }[]; reserves: { id: string; name: string }[] };
  /** Справки и правила доктрины под номерами R1… (есть, когда база дала хоть одну справку или правило). */
  refs?: RoleRef[];
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
/** focus — пункт управления: свои войска — только эти формирования и их подчинённые. */
export function situationParts(ctx: SimContext, g: GameState, view: { side: string; anchor: string; anchorName: string; focus?: string[] }) {
  const T = ctx.theatre, s = g.state, side = view.side;
  const names = new Map([...ctx.scenario.formations.map((f) => [f.id, f.name] as const), ...s.formations.map((f) => [f.id, f.name] as const)]);
  const units = unitReports(ctx, s, side, g.prev).filter((u) => u.status !== 'destroyed' && s.formations.find((f) => f.id === u.id)!.type);
  // агентная модель: в состоянии только дивизии, армии и корпуса — узлы подчинения; их доклады — сводкой по дивизиям,
  // чтобы им можно было отдавать приказы (ядро доведёт до всех дивизий) и называть армии в разграничительных линиях
  const inState = new Set(s.formations.map((f) => f.id));
  const hq = ctx.agentModel ? hqReports(ctx, units, side).filter((u) => !inState.has(u.id)) : [];
  const defs0 = new Map(ctx.scenario.formations.map((f) => [f.id, f]));
  const inFocus = (id: string) => { if (!view.focus) return true; for (let x: string | null | undefined = id, n = 0; x && n < 8; x = defs0.get(x)?.parent, n++) if (view.focus.includes(x)) return true; return false; };
  const own = [...hq, ...units].filter((u) => inFocus(u.id));
  const hqIds = new Set(hq.map((u) => u.id));
  const defs = new Map(ctx.scenario.formations.map((f) => [f.id, f]));
  /** Подчинение до армии: «26-й гв. ск, 5-я ударная армия» (фронт не называется — он в полосах). */
  const chain = (id: string | null) => {
    const out: string[] = [];
    for (let x = id ? defs.get(id) : undefined, n = 0; x && n < 6 && x.echelon !== 'front'; x = x.parent ? defs.get(x.parent) : undefined, n++) {
      out.push(names.get(x.id) ?? x.id);
      if (x.echelon === 'army') break;
    }
    return out.join(', ');
  };
  const intel = intelReport(ctx, s, side, g.prev);
  const km = detectKm(ctx);
  const anchor = T.area(view.anchor)?.center ?? null;

  const ownLines = own.map((u) => {
    const parent = hq.length ? chain(u.parent) : u.parent ? names.get(u.parent) : null;
    const n = hqIds.has(u.id) ? units.filter((d) => d.status === 'active' && chain(d.parent).split(', ').includes(u.name)).length : 0;
    const head = `- ${u.name}${parent ? ` [в составе: ${parent}]` : ''}${n ? ` (${u.echelon === 'army' ? 'армия' : 'корпус'}, соединений: ${n})` : ''}`;
    if (u.status === 'reserve') return `${head} — резерв Ставки, в сражение не введён; готов к вводу с ${ddmm(u.reserveFrom!)}`;
    if (u.status === 'arriving') return `${head} — прибывает на театр ${ddmm(u.arrives!)}${u.pending.length ? `; приказ ждёт: ${u.pending.map((p) => `${p.task} (${p.target})`).join(', ')}` : ''}`;
    const bits = [
      u.place, u.posture,
      u.task ? `задача: ${u.task} (${u.target})` : 'задачи нет',
      `состав ${pct(u.strength)} (${u.personnel.toLocaleString('ru')} чел., танков и САУ ${u.tanks}, орудий ${u.guns})`,
      `боеприпасы ${num(u.ammo)} бк, горючее ${num(u.fuel)} запр.`,
      hq.length && u.fatigue < 0.1 ? '' : `усталость ${pct(u.fatigue)}`,
    ];
    if (u.cutOff) bits.push('ОТРЕЗАНО от подвоза');
    if (u.movedKm >= 1) bits.push(`за сутки переместилось на ${Math.round(u.movedKm)} км`);
    for (const c of u.combats) bits.push(`бой (${c.role === 'attack' ? 'наступали' : 'оборонялись'}) против ${c.against.join(', ')}: ${c.outcome}${c.advanceKm ? ` на ${num(c.advanceKm)} км` : ''}, потери ${c.lossPct} %`);
    if (u.pending.length) bits.push(`приказ в пути: ${u.pending.map((p) => `${p.task} (${p.target})`).join(', ')}`);
    return `${head} — ${bits.filter(Boolean).join('; ')}.`;
  });

  const enemyLine = (e: (typeof intel)[number]) => `- ${e.name} — ${e.place}; ${e.posture}; оценка: ${e.estimate}${e.nearest ? `; ближайшее наше — ${e.nearest.name}, ${Math.round(e.nearest.km)} км` : ''}${e.fresh ? '; обнаружено впервые' : ''}.`;
  let enemyLines = intel.length ? intel.map(enemyLine) : ['- В пределах разведки противник не обнаружен.'];
  let ownOut = ownLines;
  // агентная модель: сотни дивизий — запрос длиннее контекста небольшой модели. Полностью — армии и корпуса (сводкой),
  // дивизии с поводом (бой за сутки, окружение, меньше 60 % людей, мало боеприпасов или горючего, только что прибыли);
  // остальные дивизии — коротко под своей армией. Разведсводка: полностью — ближние к нашим войскам, остальные — списком
  if (hq.length) {
    const notable = (u: (typeof units)[number]) => u.status !== 'active' || u.combats.length > 0 || u.cutOff || u.strength < 0.5 || u.ammo < 0.3 || u.fuel <= 0.05;
    const armyOf = (u: (typeof units)[number]) => chain(u.parent).split(', ').pop() || 'без объединения';
    const quiet = new Map<string, string[]>();
    ownOut = [];
    own.forEach((u, i) => {
      if (hqIds.has(u.id) || notable(u)) { ownOut.push(ownLines[i]); return; }
      const a = armyOf(u);
      quiet.set(a, [...(quiet.get(a) ?? []), shortName(u.name)]);
    });
    ownOut.unshift('- Приказ армии или корпусу ядро доводит до всех их соединений; приказ дивизии — ей одной.');
    if (quiet.size) ownOut.push(`- Остальные дивизии (без боя за сутки; положение и задача — как у их объединения выше), по объединениям: ${[...quiet].map(([a, l]) => `${a}: ${l.join(', ')}`).join(' | ')}.`);
    const NEAR = 30;
    if (intel.length > NEAR) {
      const sorted = [...intel].sort((a, b) => (a.nearest?.km ?? 1e9) - (b.nearest?.km ?? 1e9));
      enemyLines = [...sorted.slice(0, NEAR).map(enemyLine), `- Ещё обнаружено в глубине (${sorted.length - NEAR}): ${sorted.slice(NEAR).map((e) => shortName(e.name)).join(', ')}.`];
    }
  }

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

  const cut = units.filter((u) => u.cutOff).map((u) => u.name);
  const lowAmmo = units.filter((u) => u.status === 'active' && u.ammo < 0.5).map((u) => u.name);
  const noFuel = units.filter((u) => u.status === 'active' && u.fuel <= 0.05).map((u) => u.name);
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
      own_forces: ownOut.join('\n'),
      detect_km: String(Math.round(km)),
      enemy: enemyLines.join('\n'),
      areas: areaLines.join('\n'),
      supply: supply.map((x) => `- ${x}`).join('\n'),
      boundaries: bounds.length ? bounds.map((x) => `- ${x}`).join('\n') : '- Нет.',
    },
    delays,
    own,
    formations: own.map((u) => ({ id: u.id, name: u.name, parent: u.parent ?? null })),
    areas: near.map((a) => ({ id: a.id, title: a.title, at: a.at })),
    allAreas: places(T).map((a) => ({ id: a.id, title: a.title, at: a.at })),
    enemies: intel.map((e) => ({ id: e.id, name: e.name })),
  };
}

/**
 * Обстановка штаба модели на ход. kb — справка роли «штаб» и доктрина своей стороны из базы знаний: одна нумерация
 * [R1]… (справки, затем правила), в ответе — поле basis; без kb (или пусто) — «(правил нет)», «(справок нет)», без basis.
 */
export function buildSituation(ctx: SimContext, g: GameState, cfg: LiveConfig, tpl: Templates, previous?: { time: string; intent: string } | null, staffOn = false,
  kb?: { refs: RoleRef[]; rules: DoctrineRule[] }): Situation {
  const s = g.state;
  const blocks = kbBlocks(kb?.refs ?? [], kb?.rules ?? []);
  const withKb = blocks.refs.length > 0;
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
    doctrine: blocks.doctrine,
    reference: blocks.reference,
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
        : ' Тыл, переправы и резервы ведёт вышестоящее командование: поле actions оставьте пустым.')
      + (withKb ? ' В поле basis перечислите номера правил и справок ([R1]…), на которые опирается решение; нет таких — пустой список.'
        + ' Номера [R1]… — служебные метки только для поля basis: в оценке, замысле, приказах и докладах называйте правило или справку словами, по названию, без номера.' : ''),
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
    ...(withKb ? { refs: blocks.refs } : {}),
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
  // подвоз по объединениям: не доходит (дальше предела) и ослаблен (база далеко) — повод перенести базу или дать приоритет
  if (lg) {
    try {
      const { hours, rangeHours } = supplyHoursOf(ctx, s, side);
      const nm = (id: string) => shortName(s.formations.find((f) => f.id === id)?.name ?? id);
      const far = [...hours].filter(([, h]) => Number.isFinite(h) && h > rangeHours).map(([id, h]) => `${nm(id)} (${Math.round(h)} ч)`);
      const weak = [...hours].filter(([, h]) => Number.isFinite(h) && h <= rangeHours && h > (ctx.rules.supplyFlow?.fullHours ?? 12)).map(([id, h]) => `${nm(id)} (${Math.round(h)} ч)`);
      if (far.length) out.push(`- Подвоз не доходит (путь от баз длиннее ${rangeHours} ч): ${far.slice(0, 20).join(', ')}${far.length > 20 ? ` и ещё ${far.length - 20}` : ''}.`);
      if (weak.length) out.push(`- Подвоз ослаблен — база далеко: ${weak.slice(0, 20).join(', ')}${weak.length > 20 ? ` и ещё ${weak.length - 20}` : ''}.`);
      if (!far.length && !weak.length) out.push('- Подвоз доходит до всех объединений полностью.');
    } catch { /* подвоз не считается — без этой строки */ }
  }
  // переправы: действующие рядом с нашими войсками, наводимые, свободные понтонные парки
  const own = s.formations.filter((f) => f.side === side && onMap(f, s.time) && !f.destroyed);
  const near = (at: [number, number]) => own.some((f) => dist(T.proj.toXY(f.position), T.proj.toXY(at)) <= 20);
  const open = T.data.bridges.filter((b) => (!b.openFrom || b.openFrom <= s.time) && (!b.destroyedAt || b.destroyedAt > s.time) && near(b.at));
  if (open.length) out.push(`- Действующие мосты и переправы в 20 км от наших войск: ${open.slice(0, 15).map((b) => b.name ?? describePlace(T, b.at)).join('; ')}${open.length > 15 ? ` и ещё ${open.length - 15}` : ''}.`);
  const building = T.data.bridges.filter((b) => b.side === side && b.openFrom && b.openFrom > s.time);
  if (building.length) out.push(`- Наводятся переправы: ${building.map((b) => b.name).join('; ')}.`);
  if (lg) {
    const parks = profileOf(ctx, side).engineering?.parks ?? 3;
    out.push(`- Понтонных парков свободно: ${Math.max(0, parks - building.length)} из ${parks} (наводка: большая река — сутки, малая — 12 ч; нужны наши войска рядом).`);
  }
  const res = s.formations.filter((f) => f.side === side && f.reserveFrom);
  if (res.length) {
    // по армиям: в агентной модели резерв — дивизии армии; ввести можно армию целиком (subject — армия) или дивизию
    const armyOf = groupOf(ctx.scenario, 'army'), nm = (id: string) => ctx.scenario.formations.find((f) => f.id === id)?.name ?? id;
    const by = new Map<string, typeof res>();
    for (const f of res) { const a = armyOf.get(f.id) ?? f.id; by.set(a, [...(by.get(a) ?? []), f]); }
    const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
    const txt = [...by].map(([a, fs]) => (fs.length === 1 && fs[0].id === a ? `${fs[0].name} (готов с ${dm(fs[0].reserveFrom!)})`
      : `${nm(a)} — ${fs.length} соед.: ${fs.map((f) => f.name).join(', ')} (готовы с ${dm(fs.map((f) => f.reserveFrom!).sort()[0])})`));
    out.push(`- Резервы ${commandTerms(ctx, side).topGen}, не введённые в сражение: ${txt.join('; ')}.${[...by].some(([a, fs]) => !(fs.length === 1 && fs[0].id === a)) ? ' Объединение вводится целиком (subject — его название) или по соединению.' : ''}`);
  }
  const coming = s.formations.filter((f) => f.side === side && !f.reserveFrom && f.enterAt && f.enterAt > s.time && !onMap(f, s.time));
  if (coming.length) out.push(`- Вводятся в сражение: ${coming.map((f) => f.name).join('; ')}.`);
  return out.length ? out.join('\n') : '- Особых распоряжений нет.';
}
