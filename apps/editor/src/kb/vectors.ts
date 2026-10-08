/**
 * Векторы базы знаний в браузере: модель эмбеддингов из LM Studio (Qwen3-Embedding), самопроверка,
 * расчёт векторов записей и частей документов (кэш в IndexedDB — пересчитываются только изменённые
 * тексты), вектор запроса. Нет модели — смысловой поиск выключен, работает BM25.
 */
import { docText, entryEmbedText, hashText, nearest, queryText, SELF_TEST, selfTestGap, toVec, type EmbedOptions, type Entry, type Index } from '@def-ops/knowledge';
import { LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from '../sim/game-protocol';
import * as store from './store';

export interface VecState {
  /** none — модели эмбеддингов на сервере нет; off — выключено в настройках. */
  status: 'none' | 'off' | 'testing' | 'indexing' | 'ready' | 'error';
  model: string | null;
  dims: number;
  done: number;
  total: number;
  /** Самопроверка: зазор близости (перефразировка − посторонний текст) и нужен ли <|endoftext|>. */
  gap?: number;
  eos?: boolean;
  error?: string;
}

interface Row { id: string; hash: string; v: Float32Array }
const BATCH = 16;

export class Vectors {
  state: VecState = { status: 'none', model: null, dims: 1024, done: 0, total: 0 };
  readonly map = new Map<string, Float32Array>();
  private llm: LlmSettings | null = null;
  private gen = 0;
  private qcache = new Map<string, Float32Array>();
  private tested = new Map<string, { eos: boolean; gap: number } | { error: string }>();

  constructor(private readonly onChange: () => void) {}

  private client() {
    const u = this.llm!.url;
    return new LlmClient({ url: /^https?:/.test(u) ? u : new URL(u, location.origin).href.replace(/\/+$/, ''), model: '', thinking: 'off', timeoutMs: 120_000, maxTokens: 1 }, fetch.bind(globalThis));
  }
  private get opts(): EmbedOptions { return { dims: this.state.dims, eos: !!this.state.eos }; }
  private set(p: Partial<VecState>) { this.state = { ...this.state, ...p }; this.onChange(); }

  /** Настройки модели и список моделей эмбеддингов на сервере (из проверки связи). */
  configure(llm: LlmSettings, available: string[] | null) {
    const dims = llm.embedDims || 1024;
    const model = llm.embedModel === 'off' ? null : llm.embedModel || available?.find((m) => /qwen3?.?embed/i.test(m)) || available?.[0] || null;
    const changed = model !== this.state.model || dims !== this.state.dims || llm.url !== this.llm?.url;
    this.llm = llm;
    if (!changed) return false;
    this.gen++;
    this.map.clear(); this.qcache.clear();
    this.set({ status: llm.embedModel === 'off' ? 'off' : model ? 'testing' : 'none', model, dims, done: 0, total: 0, gap: undefined, eos: undefined, error: undefined });
    return true;
  }

  /** Самопроверка модели: перефразировка ближе постороннего; выбрать, добавлять ли <|endoftext|>. */
  private async selfTest(model: string): Promise<{ eos: boolean; gap: number }> {
    const known = this.tested.get(model);
    if (known && 'eos' in known) return known;
    const c = this.client();
    const run = async (eos: boolean) => {
      const o = { dims: this.state.dims, eos };
      const [q, a, b] = (await c.embed([queryText(SELF_TEST.query, o), docText(SELF_TEST.close, o), docText(SELF_TEST.far, o)], model)).map((v) => toVec(v, o.dims));
      return selfTestGap(q, a, b);
    };
    const withEos = await run(true), plain = await run(false);
    const r = withEos >= plain ? { eos: true, gap: withEos } : { eos: false, gap: plain };
    if (r.gap < 0.05) throw new Error(`самопроверка не прошла (зазор ${r.gap}): модель «${model}» даёт неподходящие векторы — нужна Qwen3-Embedding (GGUF), пулинг last`);
    this.tested.set(model, r);
    return r;
  }

  /** Посчитать недостающие векторы для индекса (после загрузки базы и при изменениях). */
  async index(index: Index, byId: Map<string, Entry>) {
    const model = this.state.model;
    if (!model || !this.llm || this.state.status === 'off') return;
    const my = ++this.gen;
    try {
      if (this.state.eos === undefined) {
        this.set({ status: 'testing' });
        const t = await this.selfTest(model);
        if (my !== this.gen) return;
        this.set({ eos: t.eos, gap: t.gap });
      }
      const prefix = `${model}|${this.state.dims}|${this.state.eos ? 1 : 0}|`;
      const cached = new Map((await store.all<Row>('vectors')).filter((r) => r.id.startsWith(prefix)).map((r) => [r.id.slice(prefix.length), r]));
      const todo: { id: string; text: string; hash: string }[] = [];
      for (const d of index.all) {
        const e = d.kind === 'entry' ? byId.get(d.ref) : undefined;
        const text = e ? entryEmbedText(e) : `${d.title}\n${d.text}`.slice(0, 4000);
        const hash = hashText(text);
        const c = cached.get(d.id);
        if (c && c.hash === hash) this.map.set(d.id, c.v); else todo.push({ id: d.id, text, hash });
      }
      for (const id of [...this.map.keys()]) if (!index.all.some((d) => d.id === id)) this.map.delete(id);
      const total = index.all.length;
      this.set({ status: todo.length ? 'indexing' : 'ready', done: total - todo.length, total });
      const c = this.client();
      for (let i = 0; i < todo.length; i += BATCH) {
        if (my !== this.gen) return;
        const part = todo.slice(i, i + BATCH);
        const vs = await c.embed(part.map((x) => docText(x.text, this.opts)), model);
        const rows: Row[] = part.map((x, k) => ({ id: prefix + x.id, hash: x.hash, v: toVec(vs[k], this.state.dims) }));
        rows.forEach((r, k) => this.map.set(part[k].id, r.v));
        await store.put('vectors', ...rows);
        this.set({ done: this.state.done + part.length });
      }
      if (my === this.gen) this.set({ status: 'ready' });
    } catch (e) {
      if (my === this.gen) this.set({ status: 'error', error: (e as Error).message });
    }
  }

  get ready() { return this.state.status === 'ready' && this.map.size > 0; }

  /** Ближайшие по смыслу к запросу. */
  async near(query: string, limit: number): Promise<{ id: string; score: number }[]> {
    if (!this.ready) return [];
    let q = this.qcache.get(query);
    if (!q) {
      const [v] = await this.client().embed([queryText(query, this.opts)], this.state.model!);
      q = toVec(v, this.state.dims);
      if (this.qcache.size > 200) this.qcache.clear();
      this.qcache.set(query, q);
    }
    return nearest(q, this.map, limit);
  }

  /** Сбросить кэш этой модели и пересчитать. */
  async rebuild(index: Index, byId: Map<string, Entry>) {
    const ids = (await store.all<Row>('vectors')).filter((r) => r.id.startsWith(`${this.state.model}|`)).map((r) => r.id);
    if (ids.length) await store.del('vectors', ...ids);
    this.map.clear();
    this.tested.delete(this.state.model ?? '');
    this.set({ eos: undefined, gap: undefined });
    await this.index(index, byId);
  }
}
