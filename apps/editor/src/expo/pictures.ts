/**
 * Картинки стенда: портреты командующих и документальные кадры — снимки общественного достояния, фоны и сцены без
 * реальных лиц — сгенерированные. У каждой в манифесте — источник или пометка «сгенерировано» (проверяет тест).
 */
import manifest from './pictures/manifest.json';

export interface Picture {
  file: string;
  caption: string;
  /** Армия или фронт, чей командующий на портрете. */
  army?: string;
  kind: 'portrait' | 'archive' | 'generated' | 'card';
  /** Слова в заголовке карточки, к которой подходит снимок. */
  topics?: string[];
  author?: string;
  url?: string;
  /** Основание общественного достояния (шаблон Wikimedia Commons). */
  pd?: string;
  generated?: boolean;
  /** Кадрирование `object-position`, чтобы в обрезке остались лица. */
  focus?: string;
}

export const PICTURES = (manifest as { pictures: Picture[] }).pictures;
const urls = import.meta.glob('./pictures/*.{jpg,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const src = (p: Picture) => urls[`./pictures/${p.file}`];

/** Портрет командующего армией (или фронтом): адрес и подпись; нет — null. */
export function portraitOf(army: string): { src: string; caption: string } | null {
  const p = PICTURES.find((x) => x.kind === 'portrait' && x.army === army);
  return p && src(p) ? { src: src(p), caption: p.caption } : null;
}

/** Картинки вида `kind` с адресами. */
export function picturesOf(kind: Picture['kind']): (Picture & { src: string })[] {
  return PICTURES.filter((p) => p.kind === kind && src(p)).map((p) => ({ ...p, src: src(p) }));
}

const CARD_FALLBACK: Record<string, string> = { su_1bf: 'allied-commanders-berlin-1945.jpg', su_1uf: 'berlin-column-1945.jpg' };

/** Архивный снимок к карточке: по словам темы, иначе кадр командующего фронта или Берлина. */
export function photoFor(text: string, front?: string): (Picture & { src: string }) | null {
  const t = text.toLowerCase();
  const pool = PICTURES.filter((p) => (p.kind === 'archive' || p.kind === 'card') && src(p));
  let best: Picture | null = null;
  let score = 0;
  for (const p of pool) {
    const s = (p.topics ?? []).reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (s > score) { score = s; best = p; }
  }
  const pick = best ?? pool.find((p) => p.file === (front ? CARD_FALLBACK[front] : '')) ?? null;
  return pick && src(pick) ? { ...pick, src: src(pick) } : null;
}
