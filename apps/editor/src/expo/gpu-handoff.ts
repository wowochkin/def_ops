/** Координатор видеопамяти главного окна. Уже начатые операции ожидаются даже при отмене. */
type LoadConfig = { context_length?: number; eval_batch_size?: number; flash_attention?: boolean; offload_kv_cache_to_gpu?: boolean };
type Instance = { id?: string; identifier?: string; config?: Record<string, unknown> } | string;
type Model = { key?: string; id?: string; modelKey?: string; type?: string; loaded_instances?: Instance[] };
type Selection = { key: string; ids: string[] };
type Owned = { key: string; id: string };
type Deps = { managed(): boolean; model(): string; resource(op: 'load' | 'unload', voiceId?: string): Promise<unknown>; fetcher?: (url: string, init?: RequestInit) => Promise<Response> };
export class GpuHandoff {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private aliases = new Map<string, string>();
  private instances = new Map<string, string>();
  private configs = new Map<string, LoadConfig>();
  private owned: Owned | null = null;
  private ttsCleared = false;
  /** Разрыв во время native load не доказывает, что сервер прекратил загрузку. */
  private loadUncertain = false;
  private resourceUncertain = false;
  private chat: string | undefined;
  chatModel(): string | undefined { return this.chat; }
  constructor(private d: Deps) {}
  cancel() { this.epoch++; }
  private assertCertain() {
    if (this.loadUncertain) throw new Error('Неизвестно, завершилась ли загрузка LM Studio. Перезапустите LM Studio, затем стенд.');
    if (this.resourceUncertain) throw new Error('Неизвестно, завершилась ли операция голосовой службы. Перезапустите голосовую службу, затем стенд.');
  }
  idle(): Promise<void> { return this.tail.then(() => this.assertCertain()); }
  private async resource(op: 'load' | 'unload', voiceId?: string) {
    this.resourceUncertain = true;
    await this.d.resource(op, voiceId);
    this.resourceUncertain = false;
  }
  private run(fn: (check: () => void) => Promise<void>, signal?: AbortSignal): Promise<void> {
    const epoch = this.epoch;
    const check = () => { if (epoch !== this.epoch || signal?.aborted) throw signal?.reason ?? new Error('Переход отменён'); };
    const job = this.tail.then(async () => {
      check();
      if (this.d.managed()) {
        this.assertCertain();
        await fn(check);
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }
  private async request(path: string, body?: object): Promise<any> {
    const response = await (this.d.fetcher ?? fetch)(`/llm/api/v1/models${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    if (!response.ok) throw new Error(`LM Studio: ${path || 'models'} — ${response.status}`);
    return response.json();
  }
  private async selected(original: string, override?: string, configId?: string): Promise<Selection> {
    const selected = override ?? this.aliases.get(original) ?? original;
    if (!selected) throw new Error('Выберите языковую модель в разделе «ИИ»');
    const result = await this.request('');
    const models: Model[] = result.models ?? result.data;
    if (!Array.isArray(models)) throw new Error('LM Studio не поддерживает управление моделями');
    const idOf = (x: Instance) => typeof x === 'string' ? x : x.id ?? x.identifier ?? '';
    const ids = (m: Model) => (m.loaded_instances ?? []).map(idOf).filter(Boolean);
    const matches = models.filter((m) => !['embedding', 'embeddings'].includes(m.type ?? '') && [m.key, m.id, m.modelKey, ...ids(m)].includes(selected));
    if (matches.length !== 1) throw new Error(`Выбранная модель не найдена: ${selected}`);
    const m = matches[0];
    const key = m.key ?? m.id ?? m.modelKey;
    if (!key) throw new Error('У выбранной модели нет ключа');
    const all = ids(m);
    if (!override && all.includes(original)) this.aliases.set(original, key);
    let chosen: string[];
    if (!override && this.aliases.has(original)) {
      const exact = this.instances.get(original) ?? original;
      chosen = all.includes(exact) ? [exact] : [];
    } else {
      if (!override && !all.includes(selected) && all.length > 1) throw new Error('Несколько экземпляров выбранной модели: выберите точный идентификатор');
      chosen = !override && all.includes(selected) ? [selected] : all;
    }
    const configTarget = configId ?? (!override && chosen.length === 1 ? chosen[0] : undefined);
    const instance = m.loaded_instances?.find((x) => idOf(x) === configTarget);
    if (instance && typeof instance !== 'string' && instance.config) {
      const config: LoadConfig = {};
      for (const field of ['context_length', 'eval_batch_size'] as const) {
        const value = instance.config[field];
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) config[field] = value;
      }
      for (const field of ['flash_attention', 'offload_kv_cache_to_gpu'] as const) {
        const value = instance.config[field];
        if (typeof value === 'boolean') config[field] = value;
      }
      if (Object.keys(config).length) this.configs.set(key, config);
    }
    return { key, ids: chosen };
  }
  /** Выгружаем ровно свой экземпляр и не забываем его, пока выгрузка не подтверждена. */
  private async unloadOwned(owner: Owned, known?: Selection): Promise<void> {
    const before = known ?? await this.selected(owner.key, owner.key, owner.id);
    if (before.ids.includes(owner.id)) {
      await this.request('/unload', { instance_id: owner.id });
      const after = await this.selected(owner.key, owner.key);
      if (after.ids.includes(owner.id)) throw new Error('LM Studio не выгрузила выбранную модель');
    }
    if (this.owned?.key === owner.key && this.owned.id === owner.id) { this.owned = null; this.ttsCleared = true; }
    if (this.chat === owner.id) this.chat = undefined;
  }
  llm(signal?: AbortSignal): Promise<void> {
    // Выбор фиксируется до очереди и не подменяется настройкой, изменённой во время native load.
    const original = this.d.model().trim();
    return this.run(async (check) => {
      await this.resource('unload'); check();
      const selected = await this.selected(original); check();
      if (this.owned && (this.owned.key !== selected.key || !selected.ids.includes(this.owned.id))) {
        await this.unloadOwned(this.owned); check();
      }
      if (!selected.ids.length) {
        this.loadUncertain = true;
        const loadedResponse = await this.request('/load', { model: selected.key, ...this.configs.get(selected.key) });
        const id = typeof loadedResponse.instance_id === 'string' ? loadedResponse.instance_id : '';
        if (!id) throw new Error('LM Studio не вернула идентификатор загруженного экземпляра');
        this.owned = { key: selected.key, id };
        this.loadUncertain = false;
        this.ttsCleared = false;
        this.chat = id;
        if (this.aliases.has(original)) this.instances.set(original, id);
        try { check(); } catch (error) { await this.unloadOwned(this.owned); throw error; }
      } else {
        this.owned = { key: selected.key, id: selected.ids[0] };
        this.ttsCleared = false;
        this.chat = selected.ids[0];
      }
    }, signal);
  }
  tts(voiceId: string, signal?: AbortSignal): Promise<void> {
    const original = this.d.model().trim();
    return this.run(async (check) => {
      if (this.owned) { await this.unloadOwned(this.owned); check(); }
      else if (!this.ttsCleared) {
        const selected = await this.selected(original); check();
        if (selected.ids.length) { this.owned = { key: selected.key, id: selected.ids[0] }; await this.unloadOwned(this.owned, selected); check(); }
        this.ttsCleared = true;
      }
      await this.resource('load', voiceId);
      try { check(); } catch (error) { await this.resource('unload'); throw error; }
    }, signal);
  }
}
