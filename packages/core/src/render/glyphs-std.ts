/**
 * Уставные точечные знаки, перерисованные по первоисточникам:
 *  [TM] — Handbook on USSR Military Forces, TM 30-430, ch. XII (War Department, 1946) —
 *         система тактических знаков РККА периода войны (1942–1945).
 *
 * Локальные координаты: точка привязки (0, 0), размер s, «вперёд» (к противнику) — вверх (−Y).
 * Для флажков точка привязки — основание древка; для остальных — центр знака
 */
import type { GlyphCtx } from './glyphs';
import { f2, esc } from './context';

type Glyph = (g: GlyphCtx) => string;
let clipSeq = 0;
const n = (v: number) => f2(v);

/* ------------------------------- примитивы ------------------------------- */
const stroke = (g: GlyphCtx, w = g.sw) => `fill="none" stroke="${g.color}" stroke-width="${n(w)}" stroke-linecap="butt" stroke-linejoin="miter"`;
const P = (d: string, g: GlyphCtx, w = g.sw) => `<path d="${d}" ${stroke(g, w)}/>`;
const F = (d: string, g: GlyphCtx, fill = g.color) => `<path d="${d}" fill="${fill}"/>`;
const PF = (d: string, g: GlyphCtx, fill = g.fill) => `<path d="${d}" fill="${fill}" stroke="${g.color}" stroke-width="${n(g.sw)}" stroke-linejoin="miter"/>`;
const L = (x1: number, y1: number, x2: number, y2: number, g: GlyphCtx, w = g.sw) => P(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, g, w);
const C = (cx: number, cy: number, r: number, g: GlyphCtx, fill = 'none', w = g.sw) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" stroke="${g.color}" stroke-width="${n(w)}"/>`;
const R = (x: number, y: number, w: number, h: number, g: GlyphCtx, fill = g.fill) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>`;
const T = (x: number, y: number, text: string, size: number, g: GlyphCtx, anchor = 'middle', color?: string) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${g.font(size, 700, color)}>${esc(text)}</text>`;
/** Стрелка-наконечник в точке (x, y), направленная по углу a (рад, 0 — вверх). */
const head = (x: number, y: number, a: number, len: number, g: GlyphCtx) => {
  const dx = Math.sin(a), dy = -Math.cos(a), px = -dy, py = dx, w = len * 0.42;
  return F(`M${n(x)} ${n(y)}L${n(x - dx * len + px * w)} ${n(y - dy * len + py * w)}L${n(x - dx * len - px * w)} ${n(y - dy * len - py * w)}Z`, g);
};

/* ---------------------------- флажки штабов ---------------------------- */
type FlagShape = 'rect' | 'army' | 'corps' | 'front' | 'division' | 'pennant';
function flag(g: GlyphCtx, shape: FlagShape, opts: { half?: boolean; cpTriangle?: boolean; text?: string } = {}): string {
  const s = g.s, fw = s * 0.78, fh = s * 0.42, y = -s;
  let out = L(0, 0, 0, y, g, g.sw * 1.15);
  let pts: [number, number][];
  if (shape === 'front') pts = [[0, y], [fw, y], [fw + fh * 0.45, y + fh / 2], [fw, y + fh], [0, y + fh]];
  else if (shape === 'division') pts = [[0, y], [fw, y], [fw - fh * 0.42, y + fh / 2], [fw, y + fh], [0, y + fh]];
  else if (shape === 'pennant') pts = [[0, y], [fw * 0.95, y + fh * 0.62], [0, y + fh * 1.24]];
  else pts = [[0, y], [fw, y], [fw, y + fh], [0, y + fh]];
  const d = `M${pts.map(([a, b]) => `${n(a)} ${n(b)}`).join('L')}Z`;
  out += PF(d, g);
  if (opts.half) {
    // нижняя половина полотнища залита — кавалерия [TM]
    const cid = `fh${(++clipSeq).toString(36)}`;
    out += `<clipPath id="${cid}"><path d="${d}"/></clipPath><rect x="0" y="${n(y + fh / 2)}" width="${n(fw + fh)}" height="${n(fh / 2 + 1)}" fill="${g.color}" clip-path="url(#${cid})"/>`;
  }
  if (shape === 'army') out += L(0, y + fh * 0.24, fw, y + fh * 0.24, g);
  if (shape === 'corps') out += L(fw * 0.12, y, fw * 0.12, y + fh, g) + L(fw * 0.88, y, fw * 0.88, y + fh, g);
  if (opts.cpTriangle) out += F(`M0 ${n(-s * 0.2)}L${n(s * 0.12)} 0L${n(-s * 0.12)} 0Z`, g);
  const text = opts.text ?? g.text;
  if (text) {
    const tx = shape === 'pennant' ? fw * 0.3 : shape === 'corps' ? fw / 2 : fw * 0.48;
    const ty = shape === 'pennant' ? y + fh * 0.78 : y + (opts.half ? fh * 0.42 : fh * 0.72);
    out += T(tx, ty, text, fh * (opts.half ? 0.38 : 0.6), g);
  }
  return out;
}

/* ------------------------ орудия, миномёты [TM] ------------------------ */
/** Знак артиллерийского орудия РККА: вертикальная черта с боковыми черточками. */
function tmGun(g: GlyphCtx, kind: 'gun76' | 'gunMed' | 'gunHeavy' | 'howitzer' | 'howHeavy' | 'mountain'): string {
  const s = g.s, h = s * 0.9;
  let out = L(0, h / 2, 0, -h / 2, g, g.sw * 1.2);
  const side = (y0: number, y1: number) => L(-s * 0.14, y0, -s * 0.14, y1, g) + L(s * 0.14, y0, s * 0.14, y1, g);
  if (kind === 'gun76') out += side(-h * 0.1, h * 0.25);
  if (kind === 'gunMed') out += side(-h * 0.1, h * 0.25) + L(-s * 0.1, -h * 0.32, s * 0.1, -h * 0.32, g);
  if (kind === 'gunHeavy') out += side(-h * 0.1, h * 0.25) + L(-s * 0.1, -h * 0.32, s * 0.1, -h * 0.32, g) + L(-s * 0.1, -h * 0.22, s * 0.1, -h * 0.22, g);
  if (kind === 'howitzer') out += side(-h * 0.1, h * 0.2) + C(0, h / 2 + s * 0.06, s * 0.06, g, g.color, 0);
  if (kind === 'howHeavy') out += side(-h * 0.1, h * 0.2) + L(-s * 0.1, -h * 0.3, s * 0.1, -h * 0.3, g) + C(0, h / 2 + s * 0.06, s * 0.06, g, g.color, 0);
  if (kind === 'mountain') out += C(-s * 0.16, 0, s * 0.05, g, g.color, 0) + C(s * 0.16, 0, s * 0.05, g, g.color, 0);
  return out;
}
/** Миномёт РККА: «V» с древком; калибр — точкой (50), основанием (82), «ногами» (120). */
function tmMortar(g: GlyphCtx, cal: 50 | 82 | 120): string {
  const s = g.s;
  let out = P(`M${n(-s * 0.3)} ${n(-s * 0.35)}L0 ${n(s * 0.25)}L${n(s * 0.3)} ${n(-s * 0.35)}`, g);
  out += L(0, s * 0.25, 0, -s * 0.5, g);
  if (cal === 50) out += C(0, s * 0.05, s * 0.06, g, g.color, 0);
  if (cal === 82) out += F(`M${n(-s * 0.12)} ${n(s * 0.25)}L${n(s * 0.12)} ${n(s * 0.25)}L0 ${n(0)}Z`, g);
  if (cal === 120) out += L(-s * 0.12, s * 0.25, -s * 0.22, s * 0.42, g) + L(s * 0.12, s * 0.25, s * 0.22, s * 0.42, g) + L(-s * 0.15, s * 0.25, s * 0.15, s * 0.25, g);
  return out;
}

/* ------------------------------- танки ------------------------------- */
/** Ромб танка: длинная ось — по направлению движения (вверх). */
const rhomb = (g: GlyphCtx, fill = g.fill, s = g.s) => PF(`M0 ${n(-s / 2)}L${n(s * 0.3)} 0L0 ${n(s / 2)}L${n(-s * 0.3)} 0Z`, g, fill);

/* ------------------------------- реестр ------------------------------- */
export const STD_GLYPHS: Record<string, Glyph> = {
  /* ===================== пункты управления ===================== */
  // [TM XII-7] штабы по ступеням
  rkkaHqFront: (g) => flag(g, 'front'),
  rkkaHqArmy: (g) => flag(g, 'army'),
  rkkaHqCorps: (g) => flag(g, 'corps'),
  rkkaHqCorpsCav: (g) => flag(g, 'rect', { half: true }),
  rkkaHqDivision: (g) => flag(g, 'division'),
  rkkaHqDivisionCav: (g) => flag(g, 'division', { half: true }),
  rkkaHqRegiment: (g) => flag(g, 'rect'),
  rkkaHqRegimentCav: (g) => flag(g, 'rect', { half: true }),
  rkkaHqBattalion: (g) => flag(g, 'pennant'),
  rkkaCp: (g) => flag(g, 'rect', { cpTriangle: true }),
  /** НП: треугольник; номер — запасной НП [TM XII-7]. */
  stdOp: (g) => {
    const s = g.s;
    return PF(`M0 ${n(-s * 0.5)}L${n(s * 0.48)} ${n(s * 0.32)}L${n(-s * 0.48)} ${n(s * 0.32)}Z`, g) + (g.text ? T(0, s * 0.22, g.text, s * 0.42, g) : '');
  },
  /** НП с точно определёнными координатами [TM]. */
  rkkaOpSurveyed: (g) => {
    const s = g.s;
    return PF(`M0 ${n(-s * 0.5)}L${n(s * 0.48)} ${n(s * 0.32)}L${n(-s * 0.48)} ${n(s * 0.32)}Z`, g) + C(0, s * 0.05, s * 0.07, g, g.color, 0);
  },
  /** Пост регулирования движения [TM XII-17]: главный — флажок над жирным кружком. */
  rkkaTrafficMain: (g) => {
    const s = g.s;
    return C(0, 0, s * 0.22, g, g.fill, g.sw * 2) + L(-s * 0.22, -s * 0.1, -s * 0.22, -s * 0.8, g) + P(`M${n(-s * 0.22)} ${n(-s * 0.8)}L${n(s * 0.2)} ${n(-s * 0.65)}L${n(-s * 0.22)} ${n(-s * 0.5)}`, g);
  },
  rkkaTrafficPost: (g) => {
    const s = g.s;
    return C(0, 0, s * 0.22, g, g.fill) + C(0, 0, s * 0.04, g, g.color, 0) + L(-s * 0.22, -s * 0.05, -s * 0.22, -s * 0.8, g) + P(`M${n(-s * 0.22)} ${n(-s * 0.8)}L${n(s * 0.2)} ${n(-s * 0.65)}L${n(-s * 0.22)} ${n(-s * 0.5)}`, g);
  },
  /** Узел передачи донесений [TM XII-12]: кружок со стрелками в обе стороны. */
  rkkaMessageCenter: (g) => C(0, 0, g.s * 0.2, g, g.fill) + L(-g.s * 0.2, 0, -g.s * 0.5, 0, g) + L(g.s * 0.2, 0, g.s * 0.5, 0, g) + head(-g.s * 0.55, 0, -Math.PI / 2, g.s * 0.14, g) + head(g.s * 0.55, 0, Math.PI / 2, g.s * 0.14, g),
  rkkaTelegraph: (g) => C(0, 0, g.s * 0.22, g, g.color, 0),

  /* ===================== стрелковое оружие и артиллерия ===================== */
  // [TM XII-9, XII-10] пехотное оружие и артиллерия РККА
  rkkaLmg: (g) => L(0, g.s * 0.45, 0, -g.s * 0.2, g, g.sw * 1.6) + head(0, -g.s * 0.5, 0, g.s * 0.32, g),
  rkkaHmg: (g) => P(`M${n(-g.s * 0.38)} ${n(g.s * 0.25)}A${n(g.s * 0.38)} ${n(g.s * 0.38)} 0 0 1 ${n(g.s * 0.38)} ${n(g.s * 0.25)}`, g) + L(0, g.s * 0.35, 0, -g.s * 0.5, g),
  rkkaHmg12: (g) => P(`M${n(-g.s * 0.38)} ${n(g.s * 0.25)}A${n(g.s * 0.38)} ${n(g.s * 0.38)} 0 0 1 ${n(g.s * 0.38)} ${n(g.s * 0.25)}`, g) + L(0, g.s * 0.35, 0, -g.s * 0.5, g) + L(-g.s * 0.14, g.s * 0.35, g.s * 0.14, g.s * 0.35, g),
  rkkaAtRifle: (g) => L(0, g.s * 0.4, 0, -g.s * 0.45, g) + L(-g.s * 0.22, g.s * 0.4, g.s * 0.22, g.s * 0.4, g),
  rkkaAtGunSmall: (g) => L(0, g.s * 0.3, 0, -g.s * 0.5, g) + L(-g.s * 0.12, -g.s * 0.2, -g.s * 0.12, g.s * 0.05, g) + L(g.s * 0.12, -g.s * 0.2, g.s * 0.12, g.s * 0.05, g) + P(`M${n(-g.s * 0.18)} ${n(g.s * 0.5)}L0 ${n(g.s * 0.3)}L${n(g.s * 0.18)} ${n(g.s * 0.5)}`, g),
  rkkaInfHowitzer: (g) => L(0, g.s * 0.35, 0, -g.s * 0.45, g) + C(-g.s * 0.15, 0, g.s * 0.05, g, g.color, 0) + C(g.s * 0.15, 0, g.s * 0.05, g, g.color, 0),
  rkkaMortar50: (g) => tmMortar(g, 50),
  rkkaMortar82: (g) => tmMortar(g, 82),
  rkkaMortar120: (g) => tmMortar(g, 120),
  rkkaGun76: (g) => tmGun(g, 'gun76'),
  rkkaGunMed: (g) => tmGun(g, 'gunMed'),
  rkkaGunHeavy: (g) => tmGun(g, 'gunHeavy'),
  rkkaHowitzer: (g) => tmGun(g, 'howitzer'),
  rkkaHowHeavy: (g) => tmGun(g, 'howHeavy'),
  rkkaGunMountain: (g) => tmGun(g, 'mountain'),
  /** Реактивная установка [TM XII-10]: три расходящиеся направляющие на основании. */
  rkkaRocket: (g) => {
    const s = g.s;
    return L(-s * 0.3, s * 0.35, s * 0.3, s * 0.35, g) + L(0, s * 0.35, 0, -s * 0.45, g) + L(0, s * 0.35, -s * 0.35, -s * 0.3, g) + L(0, s * 0.35, s * 0.35, -s * 0.3, g);
  },
  /** Батарея на огневой позиции: кружок со знаком орудия [TM XII-9]. */
  rkkaBattery: (g) => C(0, 0, g.s / 2, g, g.fill) + tmGun({ ...g, s: g.s * 0.62 }, 'gun76'),
  rkkaBatteryPlanned: (g) => `<circle r="${n(g.s / 2)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}" stroke-dasharray="${n(g.s * 0.12)} ${n(g.s * 0.08)}"/>` + tmGun({ ...g, s: g.s * 0.62 }, 'gun76'),
  /** Наблюдатель [TM]: кружок с треугольником. */
  rkkaObserver: (g) => C(0, 0, g.s / 2, g, g.fill) + PF(`M0 ${n(-g.s * 0.28)}L${n(g.s * 0.25)} ${n(g.s * 0.18)}L${n(-g.s * 0.25)} ${n(g.s * 0.18)}Z`, g),
  /** Пост звуковой разведки [TM]. */
  rkkaSoundRanging: (g) => P(`M${n(-g.s * 0.3)} ${n(-g.s * 0.4)}L0 ${n(g.s * 0.1)}L${n(g.s * 0.3)} ${n(-g.s * 0.4)}M${n(-g.s * 0.3)} ${n(g.s * 0.4)}L0 ${n(g.s * 0.1)}L${n(g.s * 0.3)} ${n(g.s * 0.4)}`, g),

  /* ===================== танки и бронетехника ===================== */
  // [TM XII-10]: лёгкий — пустой ромб; средний — с поперечной чертой; тяжёлый — с точкой
  rkkaTankLight: (g) => rhomb(g),
  rkkaTankMedium: (g) => rhomb(g) + L(-g.s * 0.3, 0, g.s * 0.3, 0, g),
  rkkaTankHeavy: (g) => rhomb(g) + C(0, 0, g.s * 0.07, g, g.color, 0),
  rkkaSpg: (g) => rhomb(g) + tmGun({ ...g, s: g.s * 0.55 }, 'gun76'),
  rkkaTankMine: (g) => rhomb(g) + L(0, -g.s * 0.5, 0, -g.s * 0.72, g) + L(-g.s * 0.2, -g.s * 0.64, g.s * 0.2, -g.s * 0.64, g),
  rkkaArmoredCar: (g) => PF(`M${n(-g.s * 0.22)} ${n(g.s * 0.4)}L${n(-g.s * 0.22)} ${n(-g.s * 0.2)}A${n(g.s * 0.22)} ${n(g.s * 0.22)} 0 0 1 ${n(g.s * 0.22)} ${n(-g.s * 0.2)}L${n(g.s * 0.22)} ${n(g.s * 0.4)}Z`, g),
  rkkaArmoredCarHeavy: (g) => STD_GLYPHS.rkkaArmoredCar(g) + C(0, -g.s * 0.12, g.s * 0.07, g, g.color, 0),
  rkkaHalfTrack: (g) => STD_GLYPHS.rkkaArmoredCar(g) + L(-g.s * 0.22, g.s * 0.28, g.s * 0.22, g.s * 0.28, g),

  /* ===================== авиация, ПВО, десант ===================== */
  // [TM XII-11] аэродромы
  rkkaAirfield: (g) => C(0, 0, g.s / 2, g, g.fill) + T(0, g.s * 0.18, g.text ?? 'А', g.s * 0.5, g),
  rkkaAirdrome: (g) => R(-g.s / 2, -g.s / 2, g.s, g.s, g) + T(0, g.s * 0.18, 'А', g.s * 0.5, g),
  rkkaLandingField: (g) => C(0, 0, g.s / 2, g, g.fill) + L(-g.s * 0.25, -g.s * 0.2, -g.s * 0.25, g.s * 0.2, g) + L(-g.s * 0.25, 0, g.s * 0.28, 0, g),
  /** Посадочная площадка для тяжёлых самолётов [TM XII-11]: круг с «Т». */
  stdLandingT: (g) => C(0, 0, g.s / 2, g, g.fill) + L(-g.s * 0.24, -g.s * 0.2, g.s * 0.24, -g.s * 0.2, g, g.sw * 1.2) + L(0, -g.s * 0.2, 0, g.s * 0.26, g, g.sw * 1.2),
  /** Высадка воздушного десанта [TM XII-11]: купол и треугольник. */
  rkkaAirborne: (g) => {
    const s = g.s;
    return P(`M${n(-s * 0.3)} ${n(-s * 0.2)}A${n(s * 0.3)} ${n(s * 0.3)} 0 0 1 ${n(s * 0.3)} ${n(-s * 0.2)}Z`, g) + P(`M${n(-s * 0.3)} ${n(-s * 0.2)}L0 ${n(s * 0.5)}L${n(s * 0.3)} ${n(-s * 0.2)}`, g);
  },
  rkkaAirCargo: (g) => STD_GLYPHS.rkkaAirborne(g) + C(0, 0, g.s * 0.08, g),
  /** Части авиации [TM XII-11]: знак «Т» на древке. Истребительный полк — со стрелкой. */
  rkkaAirFighter: (g) => L(0, g.s * 0.5, 0, -g.s * 0.3, g) + head(0, -g.s * 0.52, 0, g.s * 0.22, g) + L(-g.s * 0.2, -g.s * 0.12, g.s * 0.2, -g.s * 0.12, g),
  rkkaAirAttack: (g) => L(0, g.s * 0.35, 0, -g.s * 0.45, g) + L(-g.s * 0.25, -g.s * 0.45, g.s * 0.25, -g.s * 0.45, g) + P(`M${n(-g.s * 0.15)} ${n(g.s * 0.5)}L0 ${n(g.s * 0.35)}L${n(g.s * 0.15)} ${n(g.s * 0.5)}`, g),
  rkkaAirBomber: (g) => L(0, g.s * 0.35, 0, -g.s * 0.45, g) + L(-g.s * 0.25, -g.s * 0.45, g.s * 0.25, -g.s * 0.45, g) + L(-g.s * 0.22, -g.s * 0.36, g.s * 0.22, -g.s * 0.36, g) + C(0, g.s * 0.43, g.s * 0.07, g),
  rkkaAirRecon: (g) => L(0, g.s * 0.45, 0, -g.s * 0.45, g) + L(-g.s * 0.25, -g.s * 0.45, g.s * 0.25, -g.s * 0.45, g),
  /** Зенитная батарея [TM XII-12]: кружок со знаком зенитного орудия. */
  rkkaAaBattery: (g) => C(0, 0, g.s / 2, g, g.fill) + L(0, g.s * 0.3, 0, -g.s * 0.15, g) + head(0, -g.s * 0.32, 0, g.s * 0.16, g) + L(-g.s * 0.12, g.s * 0.05, -g.s * 0.12, g.s * 0.25, g) + L(g.s * 0.12, g.s * 0.05, g.s * 0.12, g.s * 0.25, g),
  rkkaAaMg: (g) => C(0, 0, g.s / 2, g, g.fill) + L(0, g.s * 0.3, 0, -g.s * 0.12, g) + head(0, -g.s * 0.32, 0, g.s * 0.18, g),
  rkkaAaGunSmall: (g) => L(0, g.s * 0.4, 0, -g.s * 0.3, g) + head(0, -g.s * 0.5, 0, g.s * 0.2, g) + L(-g.s * 0.14, g.s * 0.4, g.s * 0.14, g.s * 0.4, g) + C(0, g.s * 0.15, g.s * 0.05, g, g.color, 0),
  /** Зенитный прожектор [TM]: «V» на линии. */
  rkkaSearchlight: (g) => L(-g.s / 2, 0, g.s / 2, 0, g) + P(`M${n(-g.s * 0.18)} ${n(-g.s * 0.35)}L0 0L${n(g.s * 0.18)} ${n(-g.s * 0.35)}`, g),
  /** Аэростат заграждения [TM]: «петля». */
  rkkaBalloon: (g) => P(`M${n(g.s * 0.1)} ${n(-g.s * 0.05)}A${n(g.s * 0.22)} ${n(g.s * 0.22)} 0 1 0 ${n(g.s * 0.28)} ${n(-g.s * 0.3)}C${n(g.s * 0.3)} ${n(0)} ${n(g.s * 0.1)} ${n(g.s * 0.3)} ${n(-g.s * 0.15)} ${n(g.s * 0.48)}`, g),
  rkkaAirWarning: (g) => C(0, 0, g.s / 2, g, g.fill) + C(0, 0, g.s * 0.07, g, g.color, 0),

  /* ===================== фортификация ===================== */
  // [TM XII-13] окопы: дуга с зубцами наружу (к противнику)
  rkkaTrenchSquad: (g) => comb(g),
  rkkaTrenchLmg: (g) => comb(g) + L(0, g.s * 0.1, 0, -g.s * 0.3, g, g.sw * 1.4) + head(0, -g.s * 0.42, 0, g.s * 0.2, g),
  rkkaTrenchHmg: (g) => comb(g) + L(0, g.s * 0.15, 0, -g.s * 0.35, g) + P(`M${n(-g.s * 0.16)} ${n(g.s * 0.08)}A${n(g.s * 0.16)} ${n(g.s * 0.16)} 0 0 1 ${n(g.s * 0.16)} ${n(g.s * 0.08)}`, g),
  rkkaTrenchMortar: (g) => comb(g) + P(`M${n(-g.s * 0.16)} ${n(-g.s * 0.12)}L0 ${n(g.s * 0.14)}L${n(g.s * 0.16)} ${n(-g.s * 0.12)}`, g),
  rkkaTrenchAtGun: (g) => comb(g) + tmGun({ ...g, s: g.s * 0.42 }, 'gun76'),
  rkkaTrenchReserve: (g) => P(`M${n(-g.s * 0.45)} ${n(g.s * 0.15)}A${n(g.s * 0.5)} ${n(g.s * 0.4)} 0 0 1 ${n(g.s * 0.45)} ${n(g.s * 0.15)}`, g) + ticksArc(g, -1),
  /** Перекрытая пулемётная площадка (общее) [TM]. */
  rkkaMgCovered: (g) => comb(g) + C(0, g.s * 0.05, g.s * 0.06, g, g.color, 0) + head(0, -g.s * 0.35, 0, g.s * 0.18, g) + L(0, g.s * 0.05, 0, -g.s * 0.22, g),
  /** Пулемётное сооружение: противоосколочное (контур), ДЗОТ (штриховка), ДОТ (заливка) — со стрелкой сектора [TM XII-13]. */
  rkkaMgSplinter: (g) => emplacement(g, 'outline'),
  rkkaDzot: (g) => emplacement(g, 'hatch'),
  rkkaDot: (g) => emplacement(g, 'solid'),
  rkkaFort: (g) => {
    const s = g.s, cid = `ft${(++clipSeq).toString(36)}`;
    const d = `M${n(-s * 0.32)} ${n(s * 0.15)}A${n(s * 0.32)} ${n(s * 0.3)} 0 0 1 ${n(s * 0.32)} ${n(s * 0.15)}Z`;
    let hatch = '';
    for (let x = -s * 0.4; x < s * 0.4; x += s * 0.08) hatch += `M${n(x)} ${n(s * 0.2)}L${n(x + s * 0.3)} ${n(-s * 0.2)}`;
    return `<clipPath id="${cid}"><path d="${d}"/></clipPath>` + PF(d, g) + `<path d="${hatch}" ${stroke(g, g.sw * 0.6)} clip-path="url(#${cid})"/>` +
      L(-s * 0.32, s * 0.15, -s * 0.55, s * 0.15, g) + head(-s * 0.6, s * 0.15, -Math.PI / 2, s * 0.14, g) + L(s * 0.32, s * 0.15, s * 0.55, s * 0.15, g) + head(s * 0.6, s * 0.15, Math.PI / 2, s * 0.14, g) +
      L(0, -s * 0.15, 0, -s * 0.38, g) + head(0, -s * 0.45, 0, s * 0.14, g);
  },
  rkkaTurret: (g) => C(0, g.s * 0.1, g.s * 0.25, g, g.color, 0) + L(0, -g.s * 0.12, 0, -g.s * 0.35, g) + head(0, -g.s * 0.48, 0, g.s * 0.18, g),
  /** Убежище (общее) [TM XII-14]: ступенчатая линия. */
  stdShelter: (g) => P(`M${n(-g.s / 2)} ${n(-g.s * 0.12)}L${n(-g.s * 0.08)} ${n(-g.s * 0.12)}L${n(g.s * 0.08)} ${n(g.s * 0.12)}L${n(g.s / 2)} ${n(g.s * 0.12)}`, g),
  rkkaShelterEarth: (g) => PF(`M${n(-g.s * 0.35)} ${n(g.s * 0.3)}L${n(-g.s * 0.35)} ${n(-g.s * 0.15)}Q${n(-g.s * 0.35)} ${n(-g.s * 0.3)} ${n(-g.s * 0.2)} ${n(-g.s * 0.3)}L${n(g.s * 0.2)} ${n(-g.s * 0.3)}Q${n(g.s * 0.35)} ${n(-g.s * 0.3)} ${n(g.s * 0.35)} ${n(-g.s * 0.15)}L${n(g.s * 0.35)} ${n(g.s * 0.3)}Z`, g) + L(-g.s * 0.14, -g.s * 0.12, g.s * 0.14, g.s * 0.14, g) + L(g.s * 0.14, -g.s * 0.12, -g.s * 0.14, g.s * 0.14, g),
  /** Противотанковый опорный пункт [TM XII-13]: звезда с ромбом. */
  rkkaAtStrongpoint: (g) => {
    const s = g.s, pts: string[] = [];
    for (let i = 0; i < 12; i++) { const r = i % 2 ? s * 0.28 : s * 0.5, a = (Math.PI * i) / 6; pts.push(`${n(Math.cos(a) * r)} ${n(Math.sin(a) * r)}`); }
    return PF(`M${pts.join('L')}Z`, g) + rhomb({ ...g, s: s * 0.4 }, g.color);
  },

  /* ===================== заграждения ===================== */
  /** Мина ПТ — залитый кружок, ПП — пустой [TM XII-14]. */
  stdMineAT: (g) => C(0, 0, g.s / 2, g, g.color, 0),
  stdMineAP: (g) => C(0, 0, g.s / 2, g, g.fill),
  /** Заряд ВВ (фугас) [TM XII-14]: кружок с «рожками». */
  rkkaCharge: (g) => C(0, g.s * 0.08, g.s * 0.3, g, g.fill) + L(-g.s * 0.18, -g.s * 0.16, -g.s * 0.36, -g.s * 0.42, g) + L(g.s * 0.18, -g.s * 0.16, g.s * 0.36, -g.s * 0.42, g),
  rkkaDelayedMine: (g) => C(0, g.s * 0.08, g.s * 0.3, g, g.fill) + C(0, g.s * 0.08, g.s * 0.08, g, g.color, 0) + L(-g.s * 0.18, -g.s * 0.16, -g.s * 0.32, -g.s * 0.36, g) + L(g.s * 0.18, -g.s * 0.16, g.s * 0.32, -g.s * 0.36, g),
  rkkaBoobyTrap: (g) => P(`M${n(g.s * 0.25)} ${n(-g.s * 0.3)}A${n(g.s * 0.35)} ${n(g.s * 0.38)} 0 1 0 ${n(g.s * 0.25)} ${n(g.s * 0.3)}`, g, g.sw * 1.3),
  rkkaUnremovableMine: (g) => C(0, 0, g.s * 0.4, g, g.fill) + L(-g.s * 0.28, -g.s * 0.28, g.s * 0.28, g.s * 0.28, g) + L(g.s * 0.28, -g.s * 0.28, -g.s * 0.28, g.s * 0.28, g),
  rkkaFragMine: (g) => `<path d="M0 ${n(-g.s * 0.05)}C${n(g.s * 0.3)} ${n(g.s * 0.15)} ${n(g.s * 0.2)} ${n(g.s * 0.45)} 0 ${n(g.s * 0.45)}C${n(-g.s * 0.2)} ${n(g.s * 0.45)} ${n(-g.s * 0.3)} ${n(g.s * 0.15)} 0 ${n(-g.s * 0.05)}Z" fill="${g.color}"/>` + P(`M0 ${n(-g.s * 0.05)}L0 ${n(-g.s * 0.3)}A${n(g.s * 0.08)} ${n(g.s * 0.08)} 0 0 1 ${n(g.s * 0.14)} ${n(-g.s * 0.34)}`, g),
  rkkaTankTrap: (g) => R(-g.s * 0.4, -g.s * 0.4, g.s * 0.8, g.s * 0.8, g) + rhomb({ ...g, s: g.s * 0.6 }, g.color),

  /* ===================== переправы ===================== */
  /** Переправа (станция снабжения) на железной дороге [TM XII-16]: кружок с буквой на линии. */
  rkkaSupplyStation: (g) => L(-g.s * 0.6, 0, g.s * 0.6, 0, g, g.sw * 2.2) + C(0, 0, g.s * 0.28, g, g.fill) + T(0, g.s * 0.1, g.text ?? 'С', g.s * 0.3, g),

  /* ===================== тыл ===================== */
  /** Армейский склад (снабжения) [TM]: квадрат с диагоналями. */
  rkkaArmyDepot: (g) => R(-g.s * 0.4, -g.s * 0.4, g.s * 0.8, g.s * 0.8, g) + L(-g.s * 0.4, -g.s * 0.4, g.s * 0.4, g.s * 0.4, g) + L(g.s * 0.4, -g.s * 0.4, -g.s * 0.4, g.s * 0.4, g),
  /** Дивизионный пункт снабжения [TM]: кружок с крестом. */
  rkkaDivSupply: (g) => C(0, 0, g.s * 0.4, g, g.fill) + L(-g.s * 0.28, -g.s * 0.28, g.s * 0.28, g.s * 0.28, g) + L(g.s * 0.28, -g.s * 0.28, -g.s * 0.28, g.s * 0.28, g),
  rkkaFuelPoint: (g) => C(0, 0, g.s * 0.4, g, g.fill) + C(0, 0, g.s * 0.2, g, g.color, 0),
  /** Дивизионный медицинский пункт [TM]: кружок с крестом «+». */
  rkkaMedDivision: (g) => C(0, 0, g.s * 0.4, g, g.fill) + L(-g.s * 0.22, 0, g.s * 0.22, 0, g) + L(0, -g.s * 0.22, 0, g.s * 0.22, g),
  /** Медпункт полка [TM XII-17]: квадрат с «+»; батальона — треугольник с «+». */
  stdMedRegiment: (g) => R(-g.s * 0.4, -g.s * 0.4, g.s * 0.8, g.s * 0.8, g) + L(-g.s * 0.22, 0, g.s * 0.22, 0, g, g.sw * 1.5) + L(0, -g.s * 0.22, 0, g.s * 0.22, g, g.sw * 1.5),
  stdMedBattalion: (g) => PF(`M0 ${n(-g.s * 0.5)}L${n(g.s * 0.48)} ${n(g.s * 0.32)}L${n(-g.s * 0.48)} ${n(g.s * 0.32)}Z`, g) + L(-g.s * 0.16, g.s * 0.08, g.s * 0.16, g.s * 0.08, g, g.sw * 1.4) + L(0, -g.s * 0.08, 0, g.s * 0.24, g, g.sw * 1.4),
  /** Госпиталь [TM XII-16]: «домик» с крестом над ним и сокращением (ВПГ, ГЛР…). */
  rkkaHospital: (g) => PF(`M${n(-g.s * 0.38)} ${n(g.s * 0.4)}L${n(-g.s * 0.38)} ${n(-g.s * 0.05)}L0 ${n(-g.s * 0.32)}L${n(g.s * 0.38)} ${n(-g.s * 0.05)}L${n(g.s * 0.38)} ${n(g.s * 0.4)}Z`, g) +
    L(-g.s * 0.1, -g.s * 0.5, g.s * 0.1, -g.s * 0.5, g) + L(0, -g.s * 0.6, 0, -g.s * 0.4, g) + (g.text ? T(0, g.s * 0.3, g.text, g.s * 0.26, g) : ''),
  /** Пункт сбора повреждённых машин [TM XII-16]: кружок с залитыми встречными треугольниками. */
  stdVehicleCollection: (g) => C(0, 0, g.s * 0.42, g, g.fill) + F(`M${n(-g.s * 0.3)} ${n(-g.s * 0.3)}L${n(g.s * 0.3)} ${n(g.s * 0.3)}L${n(-g.s * 0.3)} ${n(g.s * 0.3)}L${n(g.s * 0.3)} ${n(-g.s * 0.3)}Z`, g),
  /** Пункт боепитания (обменный) полка/дивизии [TM XII-17]: прямоугольник с буквами на «отводе». */
  rkkaAmmoPoint: (g) => L(-g.s * 0.55, 0, -g.s * 0.35, 0, g) + R(-g.s * 0.35, -g.s * 0.2, g.s * 0.75, g.s * 0.4, g) + T(g.s * 0.02, g.s * 0.1, g.text ?? 'П АБ', g.s * 0.26, g),

  /* ===================== разведка и охранение ===================== */
  /** Разведывательный дозор [TM XII-7]: пехотный — кружок со стрелкой, кавалерийский — полузалитый, танковый — ромб. */
  rkkaReconInf: (g) => C(0, 0, g.s * 0.28, g, g.fill) + L(g.s * 0.28, 0, g.s * 0.5, 0, g) + head(g.s * 0.6, 0, Math.PI / 2, g.s * 0.14, g),
  rkkaReconCav: (g) => C(0, 0, g.s * 0.28, g, g.fill) + F(`M0 ${n(-g.s * 0.28)}A${n(g.s * 0.28)} ${n(g.s * 0.28)} 0 0 0 0 ${n(g.s * 0.28)}Z`, g) + L(g.s * 0.28, 0, g.s * 0.5, 0, g) + head(g.s * 0.6, 0, Math.PI / 2, g.s * 0.14, g),
  rkkaReconTank: (g) => PF(`M${n(-g.s * 0.3)} 0L0 ${n(-g.s * 0.18)}L${n(g.s * 0.3)} 0L0 ${n(g.s * 0.18)}Z`, g) + L(g.s * 0.3, 0, g.s * 0.5, 0, g) + head(g.s * 0.6, 0, Math.PI / 2, g.s * 0.14, g),
  /** Сборный район (К — конечный, З — запасный, П — промежуточный) [TM XII-10]. */
  rkkaAssembly: (g) => `<circle r="${n(g.s / 2)}" fill="none" stroke="${g.color}" stroke-width="${n(g.sw)}" stroke-dasharray="${n(g.s * 0.14)} ${n(g.s * 0.1)}"/>` + T(0, g.s * 0.16, g.text ?? 'К', g.s * 0.44, g),

  /* ===================== отметки на осях стрелок (колонны) ===================== */
  markDiamond: (g) => rhomb({ ...g, s: g.s * 0.55 }),
  ring: (g) => C(0, 0, g.s / 2, g, g.fill),
  eqMark: (g) => L(-g.s * 0.12, -g.s * 0.3, -g.s * 0.12, g.s * 0.3, g) + L(g.s * 0.12, -g.s * 0.3, g.s * 0.12, g.s * 0.3, g),
  flagSquare: (g) => R(-g.s * 0.3, -g.s * 0.3, g.s * 0.6, g.s * 0.6, g),
  flagSquareHalf: (g) => R(-g.s * 0.3, -g.s * 0.3, g.s * 0.6, g.s * 0.6, g) + F(`M${n(-g.s * 0.3)} ${n(g.s * 0.3)}L${n(g.s * 0.3)} ${n(-g.s * 0.3)}L${n(g.s * 0.3)} ${n(g.s * 0.3)}Z`, g),
};

/** Дуга окопа с зубцами к противнику (вверх) [TM XII-13]. */
function comb(g: GlyphCtx): string {
  return P(`M${n(-g.s * 0.45)} ${n(g.s * 0.2)}A${n(g.s * 0.5)} ${n(g.s * 0.42)} 0 0 1 ${n(g.s * 0.45)} ${n(g.s * 0.2)}`, g) + ticksArc(g, 1);
}
function ticksArc(g: GlyphCtx, dir: 1 | -1): string {
  return ticksArcAt(g, g.s * 0.2, 0.5, 0.42, dir);
}
/** Зубцы по дуге эллипса (rx·s, ry·s), опирающейся на y = y0. */
function ticksArcAt(g: GlyphCtx, y0: number, rx: number, ry: number, dir: 1 | -1 = 1): string {
  const s = g.s, A = rx * s, B = ry * s, cy = y0 + Math.sqrt(Math.max(0, B * B * (1 - (0.45 * s / A) ** 2)));
  let d = '';
  for (let i = 1; i < 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    const x = Math.cos(a) * A, y = cy + Math.sin(a) * B;
    const nx = Math.cos(a) / A, ny = Math.sin(a) / B, l = Math.hypot(nx, ny);
    const k = dir * s * 0.12;
    if (y > y0 + 0.01) continue;
    d += `M${n(x)} ${n(y)}L${n(x + (nx / l) * k)} ${n(y + (ny / l) * k)}`;
  }
  return d ? P(d, g) : '';
}
/** Огневое сооружение со стрелкой сектора: контур / штриховка / заливка [TM XII-13]. */
function emplacement(g: GlyphCtx, kind: 'outline' | 'hatch' | 'solid'): string {
  const s = g.s, a = s * 0.3;
  let out = '';
  if (kind === 'solid') out += `<rect x="${n(-a)}" y="${n(-a + s * 0.12)}" width="${n(2 * a)}" height="${n(2 * a)}" fill="${g.color}"/>`;
  else out += R(-a, -a + s * 0.12, 2 * a, 2 * a, g);
  if (kind === 'hatch') {
    let d = '';
    for (let k = -2 * a; k < 2 * a; k += s * 0.09) d += `M${n(Math.max(-a, -a + k))} ${n(Math.min(a, a - k) + s * 0.12)}L${n(Math.min(a, a + k))} ${n(Math.max(-a, -a - k) + s * 0.12)}`;
    out += `<path d="${d}" ${stroke(g, g.sw * 0.6)}/>`;
  }
  out += L(0, -a + s * 0.12, 0, -s * 0.4, g) + head(0, -s * 0.52, 0, s * 0.16, g);
  return out;
}

