/** Детерминированный генератор случайных чисел (mulberry32): один и тот же seed — один и тот же прогон. */
export interface Rng {
  /** Равномерно на [0, 1). */
  next(): number;
  /** Нормальное распределение N(0, 1). */
  normal(): number;
  /** Текущее внутреннее состояние — для сохранения и продолжения прогона. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal() {
      const u = Math.max(next(), 1e-12), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    state: () => a,
  };
}
