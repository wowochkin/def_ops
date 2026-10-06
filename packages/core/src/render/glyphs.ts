/**
 * Реестр точечных условных знаков (глифов).
 *
 * Каждый глиф рисуется в локальных координатах: точка привязки — (0, 0),
 * размер — s (пикселей на опорном масштабе), «вперёд» (к противнику) — вверх (−Y).
 * По уставному правилу для знаков на древке (флажки) точка привязки — основание
 * древка, для остальных — центр знака.
 *
 * Начертания приведены к общей системе советских тактических знаков
 * (уставные «Условные обозначения, применяемые в боевых документах»);
 * знаки, у которых в разные годы были варианты, помечены в библиотеке как
 * требующие сверки с первоисточником.
 */
import type { SymbolStyle, TextStyle } from '../model';
import { f2, esc } from './context';
import { STD_GLYPHS } from './glyphs-std';

export interface GlyphCtx {
  s: number;
  color: string;
  fill: string;
  sw: number;
  text?: string;
  /** Атрибуты шрифта для подписей внутри знака. */
  font(size: number, weight?: number, color?: string): string;
}

type Glyph = (g: GlyphCtx) => string;

const P = (d: string, g: GlyphCtx, fill = 'none', w = g.sw) =>
  `<path d="${d}" fill="${fill}" stroke="${fill === 'none' || fill === g.fill ? g.color : 'none'}" stroke-width="${f2(w)}" stroke-linejoin="miter" stroke-linecap="butt"/>`;
const L = (x1: number, y1: number, x2: number, y2: number, g: GlyphCtx, w = g.sw) =>
  `<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${g.color}" stroke-width="${f2(w)}" stroke-linecap="butt"/>`;
const C = (cx: number, cy: number, r: number, g: GlyphCtx, fill = 'none', w = g.sw) =>
  `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="${fill}" stroke="${g.color}" stroke-width="${f2(w)}"/>`;
const T = (x: number, y: number, text: string, size: number, g: GlyphCtx, anchor = 'middle', weight = 700, color?: string) =>
  `<text x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}" ${g.font(size, weight, color)}>${esc(text)}</text>`;
const n = (v: number) => f2(v);

/** Силуэт самолёта (нос — вверх). */
function planePath(s: number, span = 1): string {
  const k = s / 24;
  const pts = [
    [0, -12], [1.8, -8], [1.9, -4], [11.5 * span, -1.2], [11.5 * span, 2.4], [1.9, 1.6], [1.7, 8], [5.6, 10], [5.6, 12.4], [0, 11.4],
  ];
  const right = pts.map(([x, y]) => `${n(x * k)} ${n(y * k)}`);
  const left = pts.slice(1, -1).reverse().map(([x, y]) => `${n(-x * k)} ${n(y * k)}`);
  return `M${right.join('L')}L${left.join('L')}Z`;
}

/** Флажок на древке: древко (0,0)→(0,−s), полотнище вправо. */
function flag(g: GlyphCtx, filled: boolean, text?: string, extra = ''): string {
  const s = g.s, w = s * 0.72, h = s * 0.44;
  let out = L(0, 0, 0, -s, g, g.sw * 1.2);
  out += `<rect x="0" y="${n(-s)}" width="${n(w)}" height="${n(h)}" fill="${filled ? g.color : g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>`;
  out += extra;
  if (text) out += T(w / 2, -s + h * 0.72, text, h * 0.62, g, 'middle', 700, filled ? g.fill : g.color);
  return out;
}

export const GLYPHS: Record<string, Glyph> = {
  /* ---------------- пункты управления и связь ---------------- */
  cp: (g) => flag(g, false, g.text ?? 'КП'),
  hq: (g) => flag(g, true, g.text),
  /** Запасной КП — полотнище с диагональю. */
  reserveCp: (g) => flag(g, false, g.text ?? 'ЗКП'),
  /** Наблюдательный пункт: треугольник; внутри буква вида (А, И, Х, В) или точка. */
  op: (g) => {
    const s = g.s, h = s * 0.8;
    let out = P(`M0 ${n(-h * 0.62)}L${n(s / 2)} ${n(h * 0.38)}L${n(-s / 2)} ${n(h * 0.38)}Z`, g, g.fill);
    out += g.text ? T(0, h * 0.26, g.text, s * 0.42, g) : C(0, 0, s * 0.07, g, g.color, 0);
    return out;
  },
  /** Командно-наблюдательный пункт: флажок и треугольник у основания древка. */
  cop: (g) => {
    const s = g.s, t = s * 0.36;
    return flag(g, false, g.text ?? 'КНП') + P(`M0 ${n(-t * 0.9)}L${n(t / 2)} 0L${n(-t / 2)} 0Z`, g, g.fill);
  },
  commsNode: (g) => {
    const s = g.s, r = s / 2;
    return C(0, 0, r, g, g.fill) + P(`M${n(-r * 0.15)} ${n(-r * 0.7)}L${n(r * 0.2)} ${n(-r * 0.05)}L${n(-r * 0.2)} ${n(r * 0.05)}L${n(r * 0.15)} ${n(r * 0.7)}`, g);
  },
  radio: (g) => {
    const s = g.s;
    return L(0, 0, 0, -s, g) + P(`M${n(-s * 0.3)} ${n(-s * 1.05)}L0 ${n(-s * 0.75)}L${n(s * 0.3)} ${n(-s * 1.05)}`, g) +
      P(`M${n(-s * 0.42)} ${n(-s * 0.55)}A${n(s * 0.5)} ${n(s * 0.5)} 0 0 1 ${n(-s * 0.42)} ${n(-s * 0.95)}`, g) +
      P(`M${n(s * 0.42)} ${n(-s * 0.55)}A${n(s * 0.5)} ${n(s * 0.5)} 0 0 0 ${n(s * 0.42)} ${n(-s * 0.95)}`, g);
  },

  /* ---------------- артиллерия и огневые средства ---------------- */
  /** Орудие (пушка): ствол на станке. */
  gun: (g) => { const s = g.s; return L(-s * 0.28, 0, s * 0.28, 0, g) + L(0, 0, 0, -s, g); },
  /** Гаубица: ствол короче, дуга лафета. */
  howitzer: (g) => {
    const s = g.s;
    return P(`M${n(-s * 0.3)} ${n(s * 0.05)}A${n(s * 0.3)} ${n(s * 0.3)} 0 0 1 ${n(s * 0.3)} ${n(s * 0.05)}`, g) + L(0, -s * 0.25, 0, -s * 0.85, g);
  },
  /** Противотанковое орудие: ствол со стрелкой. */
  atGun: (g) => {
    const s = g.s;
    return L(-s * 0.28, 0, s * 0.28, 0, g) + L(0, 0, 0, -s * 0.8, g) + P(`M${n(-s * 0.16)} ${n(-s * 0.68)}L0 ${n(-s)}L${n(s * 0.16)} ${n(-s * 0.68)}`, g);
  },
  /** Миномёт: ствол на опорной плите (кружок). */
  mortar: (g) => { const s = g.s; return C(0, 0, s * 0.13, g, g.fill) + L(0, -s * 0.13, 0, -s * 0.85, g); },
  /** Реактивная установка («катюша»): направляющие со стрелой. */
  rocket: (g) => {
    const s = g.s;
    return L(-s * 0.3, 0, s * 0.3, 0, g) + L(-s * 0.14, 0, -s * 0.14, -s * 0.7, g) + L(s * 0.14, 0, s * 0.14, -s * 0.7, g) +
      L(0, 0, 0, -s * 0.85, g) + P(`M${n(-s * 0.15)} ${n(-s * 0.72)}L0 ${n(-s)}L${n(s * 0.15)} ${n(-s * 0.72)}`, g, g.color);
  },
  /** Зенитное орудие: ствол над дугой. */
  aaGun: (g) => {
    const s = g.s;
    return P(`M${n(-s * 0.32)} 0A${n(s * 0.32)} ${n(s * 0.32)} 0 0 1 ${n(s * 0.32)} 0`, g) + L(-s * 0.36, 0, s * 0.36, 0, g) + L(0, -s * 0.32, 0, -s, g);
  },
  /** Станковый пулемёт. */
  hmg: (g) => { const s = g.s; return L(-s * 0.25, 0, s * 0.25, 0, g) + L(0, 0, 0, -s, g) + L(-s * 0.18, -s * 0.62, s * 0.18, -s * 0.62, g); },
  /** Ручной пулемёт. */
  lmg: (g) => { const s = g.s; return L(0, 0, 0, -s * 0.85, g) + L(-s * 0.16, -s * 0.5, s * 0.16, -s * 0.5, g); },
  /** Огневая позиция батареи: четыре орудия на общей позиции. */
  battery: (g) => {
    const s = g.s, step = s * 0.3;
    let out = L(-s * 0.55, 0, s * 0.55, 0, g);
    for (let i = 0; i < 4; i++) out += L(-s * 0.45 + i * step, 0, -s * 0.45 + i * step, -s * 0.55, g);
    return out;
  },
  /** Огневая точка противника (флажок-вымпел). */
  pennant: (g) => P(`M0 0L0 ${n(-g.s)}L${n(g.s * 0.55)} ${n(-g.s * 0.15)}Z`, g, g.color, 0),

  /* ---------------- бронетанковые ---------------- */
  tank: (g) => { const s = g.s; return P(`M${n(-s / 2)} 0L0 ${n(-s * 0.28)}L${n(s / 2)} 0L0 ${n(s * 0.28)}Z`, g, g.color); },
  tankOutline: (g) => { const s = g.s; return P(`M${n(-s / 2)} 0L0 ${n(-s * 0.28)}L${n(s / 2)} 0L0 ${n(s * 0.28)}Z`, g, g.fill); },
  /** Танк в окопе: ромб и дуга окопа. */
  tankDug: (g) => {
    const s = g.s;
    return GLYPHS.tank(g) + P(`M${n(-s * 0.62)} ${n(-s * 0.05)}A${n(s * 0.66)} ${n(s * 0.5)} 0 0 0 ${n(s * 0.62)} ${n(-s * 0.05)}`, g);
  },
  /** Самоходная артиллерийская установка: ромб с выступающим стволом. */
  spg: (g) => { const s = g.s; return GLYPHS.tankOutline(g) + L(0, -s * 0.28, 0, -s * 0.75, g, g.sw * 1.3); },
  armoredCar: (g) => {
    const s = g.s;
    return `<rect x="${n(-s / 2)}" y="${n(-s * 0.3)}" width="${n(s)}" height="${n(s * 0.5)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>` +
      C(-s * 0.28, s * 0.28, s * 0.1, g, g.color, 0) + C(s * 0.28, s * 0.28, s * 0.1, g, g.color, 0) +
      P(`M${n(-s * 0.22)} ${n(-s * 0.05)}L0 ${n(-s * 0.2)}L${n(s * 0.22)} ${n(-s * 0.05)}L0 ${n(s * 0.1)}Z`, g, g.color, 0);
  },
  armoredTrain: (g) => {
    const s = g.s, w = s * 0.42;
    let out = L(-s * 0.85, s * 0.18, s * 0.85, s * 0.18, g);
    for (const x of [-w * 1.5, -w * 0.5, w * 0.5]) out += `<rect x="${n(x + w * 0.06)}" y="${n(-s * 0.18)}" width="${n(w * 0.88)}" height="${n(s * 0.3)}" fill="${g.color}"/>`;
    return out;
  },

  /* ---------------- авиация и ПВО ---------------- */
  plane: (g) => `<path d="${planePath(g.s)}" fill="${g.color}"/>`,
  bomber: (g) => `<path d="${planePath(g.s, 1.35)}" fill="${g.color}"/>` + C(-g.s * 0.22, -g.s * 0.08, g.s * 0.06, g, g.fill, 0) + C(g.s * 0.22, -g.s * 0.08, g.s * 0.06, g, g.fill, 0),
  airfield: (g) => C(0, 0, g.s / 2, g, g.fill) + `<path d="${planePath(g.s * 0.62)}" fill="${g.color}"/>`,
  landingStrip: (g) => {
    const s = g.s;
    return `<rect x="${n(-s / 2)}" y="${n(-s / 2)}" width="${n(s)}" height="${n(s)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>` +
      L(-s * 0.28, -s * 0.22, s * 0.28, -s * 0.22, g, g.sw * 1.4) + L(0, -s * 0.22, 0, s * 0.3, g, g.sw * 1.4);
  },
  /** Воздушный десант: купол парашюта. */
  parachute: (g) => {
    const s = g.s;
    return P(`M${n(-s / 2)} ${n(-s * 0.15)}A${n(s / 2)} ${n(s * 0.42)} 0 0 1 ${n(s / 2)} ${n(-s * 0.15)}Z`, g, g.color) +
      P(`M${n(-s / 2)} ${n(-s * 0.15)}L0 ${n(s * 0.5)}L${n(s / 2)} ${n(-s * 0.15)}M0 ${n(-s * 0.15)}L0 ${n(s * 0.5)}`, g);
  },
  searchlight: (g) => {
    const s = g.s;
    return C(0, s * 0.15, s * 0.18, g, g.color, 0) + L(0, -s * 0.05, 0, -s * 0.7, g) + L(-s * 0.1, -s * 0.05, -s * 0.38, -s * 0.6, g) + L(s * 0.1, -s * 0.05, s * 0.38, -s * 0.6, g);
  },
  balloon: (g) => {
    const s = g.s;
    return `<ellipse cx="0" cy="${n(-s * 0.55)}" rx="${n(s * 0.38)}" ry="${n(s * 0.22)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>` + L(0, -s * 0.33, 0, 0, g);
  },

  /* ---------------- флот ---------------- */
  ship: (g) => {
    const s = g.s;
    return P(`M${n(-s / 2)} ${n(-s * 0.05)}L${n(s / 2)} ${n(-s * 0.05)}L${n(s * 0.36)} ${n(s * 0.18)}L${n(-s * 0.4)} ${n(s * 0.18)}Z`, g, g.color, 0) +
      `<rect x="${n(-s * 0.18)}" y="${n(-s * 0.2)}" width="${n(s * 0.3)}" height="${n(s * 0.16)}" fill="${g.color}"/>` + L(0, -s * 0.2, 0, -s * 0.36, g);
  },
  boat: (g) => { const s = g.s; return P(`M${n(-s / 2)} 0L${n(s / 2)} 0L${n(s * 0.3)} ${n(s * 0.2)}L${n(-s * 0.38)} ${n(s * 0.2)}Z`, g, g.color, 0); },
  anchor: (g) => {
    const s = g.s;
    return C(0, -s * 0.42, s * 0.1, g) + L(0, -s * 0.32, 0, s * 0.42, g) + L(-s * 0.22, -s * 0.18, s * 0.22, -s * 0.18, g) +
      P(`M${n(-s * 0.38)} ${n(s * 0.1)}A${n(s * 0.38)} ${n(s * 0.34)} 0 0 0 ${n(s * 0.38)} ${n(s * 0.1)}`, g);
  },
  coastBattery: (g) => {
    const s = g.s;
    return GLYPHS.gun({ ...g, s: s * 0.8 }) + P(`M${n(-s * 0.45)} ${n(s * 0.18)}q${n(s * 0.11)} ${n(-s * 0.12)} ${n(s * 0.22)} 0t${n(s * 0.22)} 0t${n(s * 0.22)} 0t${n(s * 0.22)} 0`, g);
  },

  /* ---------------- фортификация ---------------- */
  /** ДОТ — долговременная огневая точка. */
  pillbox: (g) => {
    const s = g.s;
    return `<rect x="${n(-s * 0.35)}" y="${n(-s * 0.3)}" width="${n(s * 0.7)}" height="${n(s * 0.6)}" fill="${g.color}"/>` + L(0, -s * 0.3, 0, -s * 0.62, g, g.sw * 1.3);
  },
  /** ДЗОТ — дерево-земляная огневая точка. */
  dzot: (g) => {
    const s = g.s;
    return `<rect x="${n(-s * 0.35)}" y="${n(-s * 0.3)}" width="${n(s * 0.7)}" height="${n(s * 0.6)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>` +
      L(-s * 0.35, s * 0.3, s * 0.35, -s * 0.3, g) + L(0, -s * 0.3, 0, -s * 0.62, g, g.sw * 1.3);
  },
  /** Блиндаж (укрытие с перекрытием). */
  dugout: (g) => {
    const s = g.s;
    return P(`M${n(-s * 0.4)} ${n(s * 0.2)}L${n(-s * 0.4)} ${n(-s * 0.1)}L0 ${n(-s * 0.32)}L${n(s * 0.4)} ${n(-s * 0.1)}L${n(s * 0.4)} ${n(s * 0.2)}Z`, g, g.fill);
  },
  /** Окоп на отделение (стрелковая ячейка — дуга к противнику). */
  trenchSquad: (g) => {
    const s = g.s;
    return P(`M${n(-s / 2)} ${n(s * 0.15)}A${n(s * 0.6)} ${n(s * 0.45)} 0 0 1 ${n(s / 2)} ${n(s * 0.15)}`, g, 'none', g.sw * 1.3);
  },
  /** Убежище/щель (перекрытая). */
  shelter: (g) => {
    const s = g.s;
    return L(-s * 0.45, 0, s * 0.45, 0, g, g.sw * 1.3) + L(-s * 0.3, -s * 0.18, s * 0.3, -s * 0.18, g);
  },

  /* ---------------- заграждения ---------------- */
  /** Противотанковая мина. */
  mineAT: (g) => C(0, 0, g.s / 2, g, g.fill),
  /** Противопехотная мина. */
  mineAP: (g) => C(0, 0, g.s / 2, g, g.fill) + C(0, 0, g.s * 0.16, g, g.color, 0),
  /** Фугас (управляемый). */
  fougasse: (g) => C(0, 0, g.s / 2, g, g.fill) + T(0, g.s * 0.2, g.text ?? 'Ф', g.s * 0.55, g),
  /** Разрушение, подрыв (взрыв). */
  explosion: (g) => {
    const s = g.s, pts: string[] = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? s * 0.22 : s * 0.5, a = (Math.PI * i) / 8;
      pts.push(`${n(Math.cos(a) * r)} ${n(Math.sin(a) * r)}`);
    }
    return `<path d="M${pts.join('L')}Z" fill="${g.color}"/>`;
  },
  /** Надолба (одиночная). */
  dragonTooth: (g) => P(`M0 ${n(-g.s * 0.4)}L${n(g.s * 0.35)} ${n(g.s * 0.25)}L${n(-g.s * 0.35)} ${n(g.s * 0.25)}Z`, g, g.color, 0),

  /* ---------------- переправы и дороги ---------------- */
  /** Мост (поперёк реки — ось знака вдоль дороги, по Y). */
  bridge: (g) => {
    const s = g.s, w = s * 0.18, h = s / 2;
    return P(`M${n(-w - s * 0.12)} ${n(-h - s * 0.12)}L${n(-w)} ${n(-h)}L${n(-w)} ${n(h)}L${n(-w - s * 0.12)} ${n(h + s * 0.12)}`, g) +
      P(`M${n(w + s * 0.12)} ${n(-h - s * 0.12)}L${n(w)} ${n(-h)}L${n(w)} ${n(h)}L${n(w + s * 0.12)} ${n(h + s * 0.12)}`, g);
  },
  bridgeDestroyed: (g) => GLYPHS.bridge(g) + L(-g.s * 0.35, -g.s * 0.35, g.s * 0.35, g.s * 0.35, g, g.sw * 1.4) + L(g.s * 0.35, -g.s * 0.35, -g.s * 0.35, g.s * 0.35, g, g.sw * 1.4),
  pontoon: (g) => {
    const s = g.s;
    let out = L(-s * 0.16, -s / 2, -s * 0.16, s / 2, g) + L(s * 0.16, -s / 2, s * 0.16, s / 2, g);
    for (const y of [-s * 0.3, 0, s * 0.3]) out += `<ellipse cx="0" cy="${n(y)}" rx="${n(s * 0.28)}" ry="${n(s * 0.07)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw * 0.8)}"/>`;
    return out;
  },
  ferry: (g) => {
    const s = g.s;
    return `<line x1="0" y1="${n(-s / 2)}" x2="0" y2="${n(s / 2)}" stroke="${g.color}" stroke-width="${n(g.sw)}" stroke-dasharray="${n(s * 0.08)} ${n(s * 0.06)}"/>` +
      `<rect x="${n(-s * 0.16)}" y="${n(-s * 0.1)}" width="${n(s * 0.32)}" height="${n(s * 0.2)}" fill="${g.color}"/>`;
  },
  ford: (g) => {
    const s = g.s;
    return `<line x1="0" y1="${n(-s / 2)}" x2="0" y2="${n(s / 2)}" stroke="${g.color}" stroke-width="${n(g.sw)}" stroke-dasharray="${n(s * 0.1)} ${n(s * 0.07)}"/>` + T(s * 0.12, s * 0.06, g.text ?? 'бр.', s * 0.3, g, 'start', 400);
  },
  kpp: (g) => {
    const s = g.s;
    return `<rect x="${n(-s / 2)}" y="${n(-s * 0.28)}" width="${n(s)}" height="${n(s * 0.56)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>` + T(0, s * 0.13, g.text ?? 'КПП', s * 0.34, g);
  },
  railStation: (g) => {
    const s = g.s;
    return `<rect x="${n(-s / 2)}" y="${n(-s * 0.2)}" width="${n(s)}" height="${n(s * 0.4)}" fill="${g.color}"/>` + (g.text ? T(0, -s * 0.32, g.text, s * 0.32, g) : '');
  },

  /* ---------------- тыл и обеспечение ---------------- */
  /** Склад (вид указывается буквами: Б — боеприпасы, ГСМ, П — продовольствие). */
  depot: (g) => {
    const s = g.s;
    return P(`M${n(-s / 2)} ${n(s * 0.3)}L${n(-s / 2)} ${n(-s * 0.15)}L0 ${n(-s * 0.4)}L${n(s / 2)} ${n(-s * 0.15)}L${n(s / 2)} ${n(s * 0.3)}Z`, g, g.fill) +
      (g.text ? T(0, s * 0.18, g.text, s * 0.32, g) : '');
  },
  /** Медицинский пункт (вид — подписью: МПБ, МПП, медсанбат). */
  medical: (g) => {
    const s = g.s, a = s * 0.1;
    return C(0, 0, s / 2, g, g.fill) + `<path d="M${n(-a)} ${n(-s * 0.32)}h${n(2 * a)}v${n(s * 0.22)}h${n(s * 0.22)}v${n(2 * a)}h${n(-s * 0.22)}v${n(s * 0.22)}h${n(-2 * a)}v${n(-s * 0.22)}h${n(-s * 0.22)}v${n(-2 * a)}h${n(s * 0.22)}Z" fill="#d42a2a"/>`;
  },
  hospital: (g) => {
    const s = g.s, a = s * 0.1;
    return `<rect x="${n(-s / 2)}" y="${n(-s / 2)}" width="${n(s)}" height="${n(s)}" fill="${g.fill}" stroke="${g.color}" stroke-width="${n(g.sw)}"/>` +
      `<path d="M${n(-a)} ${n(-s * 0.34)}h${n(2 * a)}v${n(s * 0.24)}h${n(s * 0.24)}v${n(2 * a)}h${n(-s * 0.24)}v${n(s * 0.24)}h${n(-2 * a)}v${n(-s * 0.24)}h${n(-s * 0.24)}v${n(-2 * a)}h${n(s * 0.24)}Z" fill="#d42a2a"/>`;
  },
  /** Ремонтный пункт / СПАМ (сборный пункт аварийных машин). */
  repair: (g) => {
    const s = g.s;
    return C(0, 0, s / 2, g, g.fill) + T(0, s * 0.17, g.text ?? 'Р', s * 0.5, g);
  },
  /** Обменный пункт / станция снабжения — флажок с буквами на треугольнике. */
  supply: (g) => {
    const s = g.s;
    return P(`M0 ${n(-s * 0.45)}L${n(s / 2)} ${n(s * 0.35)}L${n(-s / 2)} ${n(s * 0.35)}Z`, g, g.fill) + T(0, s * 0.25, g.text ?? 'ДОП', s * 0.26, g);
  },

  /* ---------------- особые ---------------- */
  /** Партизанский отряд (бригада). */
  partisans: (g) => {
    const s = g.s, pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.16 : s * 0.38, a = -Math.PI / 2 + (Math.PI * i) / 5;
      pts.push(`${n(Math.cos(a) * r)} ${n(Math.sin(a) * r)}`);
    }
    return C(0, 0, s / 2, g, g.fill) + `<path d="M${pts.join('L')}Z" fill="${g.color}"/>`;
  },
  star: (g) => {
    const s = g.s, pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.2 : s * 0.5, a = -Math.PI / 2 + (Math.PI * i) / 5;
      pts.push(`${n(Math.cos(a) * r)} ${n(Math.sin(a) * r)}`);
    }
    return `<path d="M${pts.join('L')}Z" fill="${g.color}"/>`;
  },
  fire: (g) => {
    const s = g.s;
    return `<path d="M0 ${n(-s / 2)}C${n(s * 0.35)} ${n(-s * 0.15)} ${n(s * 0.38)} ${n(s * 0.2)} 0 ${n(s * 0.45)}C${n(-s * 0.38)} ${n(s * 0.2)} ${n(-s * 0.28)} ${n(-s * 0.05)} ${n(-s * 0.08)} ${n(-s * 0.18)}C${n(-s * 0.05)} 0 ${n(s * 0.05)} ${n(-s * 0.2)} 0 ${n(-s / 2)}Z" fill="${g.color}"/>`;
  },
  /** Отметка высоты: треугольник и число. */
  height: (g) => {
    const s = g.s;
    return P(`M0 ${n(-s * 0.3)}L${n(s * 0.26)} ${n(s * 0.15)}L${n(-s * 0.26)} ${n(s * 0.15)}Z`, g, g.color, 0) + T(s * 0.35, s * 0.1, g.text ?? '120,5', s * 0.5, g, 'start', 400);
  },
  /** Стрелка «север». */
  northArrow: (g) => {
    const s = g.s;
    return P(`M0 ${n(-s / 2)}L${n(s * 0.18)} ${n(s * 0.3)}L0 ${n(s * 0.18)}Z`, g, g.color, 0) + P(`M0 ${n(-s / 2)}L${n(-s * 0.18)} ${n(s * 0.3)}L0 ${n(s * 0.18)}Z`, g, g.fill) +
      T(0, -s * 0.58, 'С', s * 0.36, g);
  },
};

// уставные знаки по первоисточникам (РККА 1942–45, TM 30-430)
Object.assign(GLYPHS, STD_GLYPHS);

export function glyphCtx(st: SymbolStyle, fontAttrs: (t: TextStyle) => string): GlyphCtx {
  return {
    s: st.size, color: st.color, fill: st.fill, sw: st.strokeWidth, text: st.text,
    font: (size, weight = 700, color) => fontAttrs({
      font: st.textStyle?.font ?? 'PT Sans Narrow', size, weight, italic: false, color: color ?? st.color, halo: null,
      letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1,
    }),
  };
}

/** Названия глифов для интерфейса. */
export const GLYPH_NAMES: Record<string, string> = {
  cp: 'Командный пункт', hq: 'Штаб (флажок залитый)', reserveCp: 'Запасной КП', op: 'Наблюдательный пункт', cop: 'КНП', commsNode: 'Узел связи', radio: 'Радиостанция',
  gun: 'Орудие', howitzer: 'Гаубица', atGun: 'ПТ орудие', mortar: 'Миномёт', rocket: 'Реактивная установка', aaGun: 'Зенитное орудие', hmg: 'Станковый пулемёт', lmg: 'Ручной пулемёт',
  battery: 'Огневая позиция батареи', pennant: 'Огневая точка (вымпел)', tank: 'Танк', tankOutline: 'Танк (контур)', tankDug: 'Танк в окопе', spg: 'САУ', armoredCar: 'Бронеавтомобиль',
  armoredTrain: 'Бронепоезд', plane: 'Самолёт', bomber: 'Бомбардировщик', airfield: 'Аэродром', landingStrip: 'Посадочная площадка', parachute: 'Парашют (десант)',
  searchlight: 'Прожектор', balloon: 'Аэростат', ship: 'Корабль', boat: 'Катер', anchor: 'Якорь (база)', coastBattery: 'Береговая батарея', pillbox: 'ДОТ', dzot: 'ДЗОТ',
  dugout: 'Блиндаж', trenchSquad: 'Окоп', shelter: 'Щель/убежище', mineAT: 'Мина ПТ', mineAP: 'Мина ПП', fougasse: 'Фугас', explosion: 'Разрушение', dragonTooth: 'Надолба',
  bridge: 'Мост', bridgeDestroyed: 'Мост разрушен', pontoon: 'Понтонный мост', ferry: 'Паром', ford: 'Брод', kpp: 'КПП', railStation: 'Станция', depot: 'Склад',
  medical: 'Медпункт', hospital: 'Госпиталь', repair: 'Ремонтный пункт', supply: 'Обменный пункт', partisans: 'Партизаны', star: 'Звезда', fire: 'Пожар',
  height: 'Отметка высоты', northArrow: 'Стрелка «север»',
};
