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
  kind: 'portrait' | 'archive' | 'generated';
  author?: string;
  url?: string;
  /** Основание общественного достояния (шаблон Wikimedia Commons). */
  pd?: string;
  generated?: boolean;
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
