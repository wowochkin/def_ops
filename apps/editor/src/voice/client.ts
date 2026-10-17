// Связь окна с голосовым сервисом: микрофон (AudioWorklet), воспроизведение, WebSocket.
// Все браузерные API — здесь; разбор протокола и состояние — в protocol.ts.
import {
  CancelledIds, VOICE_SAY_IDS, parseAudio, voiceStatus,
  type CalibStep, type ClientMsg, type ServerMsg, type VoiceRole, type VoiceSettings, type VoiceStatus, type WsState,
} from './protocol';

export { VOICE_SAY_IDS } from './protocol';

const DEFAULT_URL = 'ws://127.0.0.1:47645/ws';
const URL_KEY = 'def_ops.voice.url';
const RECONNECT_MS = 2000;

/** Пересчёт микрофона в 16 кГц и кадры по 512 отсчётов (int16) — в AudioWorklet (как на стенде). */
const WORKLET = `
class Mic extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.acc = 0; this.out = new Int16Array(512); this.n = 0; this.peak = 0; }
  process(inputs) {
    const ch = inputs[0][0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1; this.peak = Math.max(this.peak, Math.abs(ch[i]));
      if (this.acc >= this.ratio) { this.acc -= this.ratio;
        const v = Math.max(-1, Math.min(1, ch[i])); this.out[this.n++] = v * 32767;
        if (this.n === 512) { this.port.postMessage({ pcm: this.out.buffer.slice(0), peak: this.peak }); this.n = 0; this.peak = 0; } }
    }
    return true;
  }
}
registerProcessor('mic', Mic);`;

type Handler<K extends ServerMsg['type']> = (m: Extract<ServerMsg, { type: K }>) => void;

/** Разбор отказа микрофона: где сохранён запрет — в браузере или в системе (macOS). */
async function micDenied(e: unknown): Promise<Error> {
  const err = e as { name?: string; message?: string };
  let perm: string | null = null;
  try { perm = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state; } catch { /* нет Permissions API */ }
  const msg = err.message ?? '';
  const why: string = ({
    NotAllowedError: perm === 'denied' && !/system/i.test(msg)
      ? 'запрет сохранён в самом браузере, поэтому он не спрашивает. Нажмите значок слева от адреса и разрешите микрофон, затем обновите страницу.'
      : 'браузер готов спросить, но macOS не даёт ему микрофон (система спрашивает приложение один раз; после отказа молчит). '
        + 'Системные настройки → Конфиденциальность и безопасность → Микрофон → включите браузер или приложение и перезапустите его.',
    NotFoundError: 'микрофон не найден — проверьте устройство ввода в настройках звука системы.',
    NotReadableError: 'микрофон занят другой программой или недоступен системе — закройте её или перезапустите приложение.',
    OverconstrainedError: 'выбранный микрофон не поддерживает нужные настройки — выберите другой.',
  } as Record<string, string>)[err.name ?? ''] ?? msg;
  return new Error(`Микрофон не подключился (${err.name}: «${msg}», разрешение: ${perm ?? 'неизвестно'}): ${why}`);
}

export class VoiceClient {
  private ws: WebSocket | null = null;
  private wsState: WsState = 'closed';
  private api: { state: string } | null = null;
  private ready = false;
  private wanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handlers = new Map<string, Set<(m: never) => void>>();
  private statusCbs = new Set<(s: VoiceStatus) => void>();
  private playedCbs = new Set<(id: number) => void>();
  private lastStatus: VoiceStatus | null = null;
  private hello: Partial<VoiceSettings> = {};
  private nextId: number = VOICE_SAY_IDS.first;
  private starting: Promise<void> | null = null;
  private cancelled = new CancelledIds();

  private micCtx: AudioContext | null = null;
  private playCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nextT = 0;
  private sources: { src: AudioBufferSourceNode; id: number }[] = [];
  /** По фразам: `done` — сервис сказал, что кусков больше нет; сыграно — когда доиграли все. */
  private phrases = new Map<number, { done: boolean }>();

  get status(): VoiceStatus { return voiceStatus(this.api, this.wsState, this.ready); }

  /** Ответ шлюза `/api/voice` (null — шлюз не ответил). */
  setApi(api: { state: string } | null) { this.api = api; this.emitStatus(); }

  /** Опрос шлюза; ошибка сети — как «голос выключен». */
  async refreshApi(): Promise<void> {
    try {
      const r = await fetch('/api/voice');
      this.setApi(r.ok ? await r.json() : null);
    } catch { this.setApi(null); }
  }

  onStatus(cb: (s: VoiceStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => { this.statusCbs.delete(cb); };
  }

  /** Окно доиграло фразу (после `say-done` и всего её звука; остановленные и перебитые не считаются). */
  onPlayed(cb: (id: number) => void): () => void {
    this.playedCbs.add(cb);
    return () => { this.playedCbs.delete(cb); };
  }

  /** Возобновить звук после действия человека (браузер может держать AudioContext приостановленным). */
  resume() {
    void this.micCtx?.resume().catch(() => {});
    void this.playCtx?.resume().catch(() => {});
  }

  on<K extends ServerMsg['type']>(type: K, cb: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(cb as (m: never) => void);
    return () => { set.delete(cb as (m: never) => void); };
  }

  /** Следующий номер фразы для `say`. */
  newSayId(): number { return this.nextId++; }

  /** Микрофон и подключение к сервису. Ошибка микрофона — с разбором причины. */
  start(hello: Partial<VoiceSettings> = {}): Promise<void> {
    if (this.micCtx) return Promise.resolve();
    // одновременные вызовы делят одну попытку
    this.starting ??= this.doStart(hello).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doStart(hello: Partial<VoiceSettings>): Promise<void> {
    this.hello = hello;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(`Браузер не даёт микрофон этой странице: адрес ${location.origin} не считается защищённым.`);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) { throw await micDenied(e); }
    try {
      const micCtx = new AudioContext();
      this.micCtx = micCtx;
      this.playCtx = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try { await micCtx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const node = new AudioWorkletNode(micCtx, 'mic');
      micCtx.createMediaStreamSource(this.stream).connect(node);
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data.pcm);
      };
    } catch (e) {
      this.close();  // не оставляем открытый микрофон и «занятое» состояние: повторный запуск должен работать
      throw e;
    }
    this.wanted = true;
    this.connect();
  }

  /** Отключение: микрофон, звук, переподключения. */
  close() {
    this.wanted = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const old = this.ws;
    this.ws = null;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; old.close(); }
    this.stopPlayback();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.micCtx?.close();
    void this.playCtx?.close();
    this.stream = null; this.micCtx = null; this.playCtx = null;
    this.ready = false;
    this.setWs('closed');
  }

  private url(): string {
    try { return localStorage.getItem(URL_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
  }

  private connect() {
    if (!this.wanted) return;
    this.setWs('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { this.scheduleReconnect(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.ready = false;  // до нового `ready` сервис не считается готовым
      this.setWs('open');
      this.send({ type: 'hello', settings: this.hello });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (typeof e.data !== 'string') return this.onAudio(e.data as ArrayBuffer);
      let m: ServerMsg;
      try { m = JSON.parse(e.data) as ServerMsg; } catch { return; }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPlayback();  // обрыв: договаривать некому
      this.setWs('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* следом придёт close */ };
  }

  private scheduleReconnect() {
    if (!this.wanted || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, RECONNECT_MS);
  }

  private setWs(s: WsState) { this.wsState = s; this.emitStatus(); }

  private emitStatus() {
    const s = this.status;
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    this.statusCbs.forEach((cb) => cb(s));
  }

  private onMessage(m: ServerMsg) {
    if (m.type === 'ready') { this.ready = true; this.emitStatus(); }
    else if (m.type === 'barge') { this.cancelled.add(m.id); this.stopPlayback(m.id); }
    else if (m.type === 'say-done') this.phraseDone(m.id);
    this.handlers.get(m.type)?.forEach((cb) => cb(m as never));
  }

  // --- команды сервису ---

  private send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  say(id: number, role: VoiceRole, text: string, more?: boolean) {
    this.cancelled.revive(id);
    this.send(more === undefined ? { type: 'say', id, role, text } : { type: 'say', id, role, text, more });
  }

  /** Замолчать: фраза `id` или всё; локальный звук гасится сразу. */
  stop(id?: number) {
    if (id === undefined) this.cancelled.addUpTo(this.nextId - 1);
    else this.cancelled.add(id);
    this.stopPlayback(id);
    this.send(id === undefined ? { type: 'stop' } : { type: 'stop', id });
  }

  settings(cfg: Partial<VoiceSettings>) {
    this.hello = { ...this.hello, ...cfg };
    this.send({ type: 'settings', ...cfg });
  }

  calib(step: CalibStep, sec?: number) {
    this.send(sec === undefined ? { type: 'calib', step } : { type: 'calib', step, sec });
  }

  voice(op: string, args: Record<string, unknown> = {}) {
    this.send({ ...args, type: 'voice', op });
  }

  // --- воспроизведение ---

  private onAudio(buf: ArrayBuffer) {
    const ctx = this.playCtx;
    if (!ctx) return;
    let a;
    try { a = parseAudio(buf); } catch { return; }
    // id 0 — тестовая фраза калибровки: не фраза `say`, отмены и `played` её не касаются
    if (!a.pcm.length || (a.id !== 0 && this.cancelled.has(a.id))) return;
    void ctx.resume();
    const ab = ctx.createBuffer(1, a.pcm.length, a.rate);
    const ch = ab.getChannelData(0);
    for (let i = 0; i < a.pcm.length; i++) ch[i] = a.pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(ctx.destination);
    // куски идут встык: каждый начинается там, где кончился предыдущий
    const t = Math.max(ctx.currentTime + 0.03, this.nextT);
    src.start(t);
    this.nextT = t + ab.duration;
    const entry = { src, id: a.id };
    this.sources.push(entry);
    if (a.id !== 0 && !this.phrases.has(a.id)) this.phrases.set(a.id, { done: false });
    src.onended = () => {
      this.sources = this.sources.filter((x) => x !== entry);
      if (a.id !== 0) this.checkPlayed(a.id);
    };
  }

  private phraseDone(id: number) {
    if (this.cancelled.has(id)) return;  // остановленную фразу не «доигрываем»
    const p = this.phrases.get(id);
    if (p) p.done = true;
    else this.phrases.set(id, { done: true });
    this.checkPlayed(id);
  }

  /** Фраза доиграна: сервис договорил (`say-done`) и в очереди не осталось её кусков. */
  private checkPlayed(id: number) {
    const p = this.phrases.get(id);
    if (!p || !p.done || this.sources.some((x) => x.id === id)) return;
    this.phrases.delete(id);
    this.send({ type: 'played', id });
    this.playedCbs.forEach((cb) => cb(id));
  }

  /** Остановить звук: одной фразы или всего. Для остановленных `played` не шлётся. */
  stopPlayback(id?: number) {
    const keep: typeof this.sources = [];
    for (const x of this.sources) {
      if (id === undefined || x.id === id) { x.src.onended = null; try { x.src.stop(); } catch { /* уже кончился */ } }
      else keep.push(x);
    }
    this.sources = keep;
    if (id === undefined) { this.phrases.clear(); this.nextT = 0; }
    else {
      this.phrases.delete(id);
      if (!keep.length) this.nextT = 0;
    }
  }
}
