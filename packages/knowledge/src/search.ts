/**
 * Поиск по базе: записи и части документов. Слова приводятся к основам (первые 5 букв; числа —
 * целиком), «ё» = «е», без стоп-слов; ранжирование BM25, заголовки и синонимы весят больше.
 * Работает без сервера и без модели — и в браузере, и в Node.
 */
import type { Entry, KbDocument } from './schema';

const STOP = new Set(['и', 'в', 'во', 'на', 'с', 'со', 'по', 'к', 'ко', 'о', 'об', 'от', 'до', 'за', 'из', 'у', 'не', 'что', 'как', 'это', 'для', 'при', 'же', 'ли', 'а', 'но', 'или', 'the', 'of', 'and', 'in', 'a', 'to', 'der', 'die', 'das', 'und', 'von', 'расскажи', 'какой', 'какая', 'какие', 'кто', 'где', 'когда', 'почему', 'было', 'был', 'была', 'были']);

export function stems(text: string): string[] {
  return text.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9äöüß]+/i).filter((w) => w && !STOP.has(w))
    .map((w) => (/^\d/.test(w) ? w.replace(/\D.*$/, '') : w.slice(0, 5))).filter((w) => w.length > 1 || /\d/.test(w));
}

export interface Doc { id: string; kind: 'entry' | 'chunk'; ref: string; title: string; text: string; boost: string }
export interface Hit { id: string; kind: 'entry' | 'chunk'; ref: string; title: string; text: string; score: number }

export class Index {
  private docs: Doc[] = [];
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private df = new Map<string, number>();
  private avg = 1;

  constructor(entries: Entry[], documents: KbDocument[] = []) {
    for (const e of entries) {
      const text = [e.summary, ...(e.sections ?? []).map((s) => `${s.title}. ${s.text}`), ...(e.facts ?? []).map((f) => `${f.key}: ${f.value}`)].join('\n');
      this.add({ id: `e:${e.id}`, kind: 'entry', ref: e.id, title: e.title, text, boost: [e.title, ...(e.aliases ?? [])].join(' ') });
    }
    for (const d of documents) for (const c of d.chunks) this.add({ id: `c:${d.id}:${c.i}`, kind: 'chunk', ref: d.id, title: `${d.name}, часть ${c.i + 1}`, text: c.text, boost: '' });
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length);
  }

  /** Документы индекса (для векторов). */
  get all(): readonly Doc[] { return this.docs; }
  /** Документ индекса как выдача (для гибридного поиска). */
  doc(id: string): Hit | undefined {
    const d = this.docs.find((x) => x.id === id);
    return d ? { id: d.id, kind: d.kind, ref: d.ref, title: d.title, text: d.text, score: 0 } : undefined;
  }

  private add(d: Doc) {
    const m = new Map<string, number>();
    const words = [...stems(d.text), ...stems(d.boost).flatMap((w) => [w, w, w])];
    for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
    for (const w of m.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.docs.push(d); this.tf.push(m); this.len.push(words.length);
  }

  search(query: string, opts: { limit?: number; kinds?: ('entry' | 'chunk')[]; filter?: (d: Doc) => boolean } = {}): Hit[] {
    const q = [...new Set(stems(query))];
    if (!q.length) return [];
    const N = this.docs.length, k1 = 1.4, b = 0.75;
    const out: Hit[] = [];
    this.docs.forEach((d, i) => {
      if (opts.kinds && !opts.kinds.includes(d.kind)) return;
      if (opts.filter && !opts.filter(d)) return;
      let s = 0;
      for (const w of q) {
        const f = this.tf[i].get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(w) ?? 0) + 0.5) / ((this.df.get(w) ?? 0) + 0.5));
        s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.len[i]) / this.avg)));
      }
      if (s > 0) out.push({ id: d.id, kind: d.kind, ref: d.ref, title: d.title, text: d.text, score: +s.toFixed(3) });
    });
    return out.sort((a, b2) => b2.score - a.score).slice(0, opts.limit ?? 10);
  }
}

/** Отрывок текста вокруг первых совпадений запроса (для выдачи и для промпта). */
export function snippet(text: string, query: string, max = 600): string {
  if (text.length <= max) return text;
  const q = new Set(stems(query));
  const parts = text.split(/(?<=[.!?\n])\s+/);
  let best = 0, bs = -1;
  parts.forEach((p, i) => { const s = stems(p).filter((w) => q.has(w)).length; if (s > bs) { bs = s; best = i; } });
  let out = '';
  for (let i = Math.max(0, best - 1); i < parts.length && out.length < max; i++) out += (out ? ' ' : '') + parts[i];
  return out.length > max ? out.slice(0, max) + '…' : out;
}
