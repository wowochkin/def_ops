// Связь окна с голосовым сервисом: микрофон (AudioWorklet), воспроизведение, WebSocket.
// Все браузерные API — здесь; разбор протокола и состояние — в protocol.ts.
import {
  CancelledIds, VOICE_SAY_IDS, parseAudio, reconnectDelay, voiceStatus,
  type CalibStep, type ClientMsg, type ServerMsg, type VoiceRole, type VoiceSettings, type VoiceStatus, type WsState,
} from './protocol';

export { VOICE_SAY_IDS } from './protocol';

const DEFAULT_URL = 'ws://127.0.0.1:47645/ws';
const URL_KEY = 'def_ops.voice.url';

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
  private failed = false;  // последняя попытка подключиться не удалась
  private fails = 0;  // неудачных попыток подряд
  private everOpened = false;  // связь уже была (сервис перезапускается — переподключаться часто)
  private serviceError: string | null = null;  // ошибка сервиса до `ready` (модели не загрузились)
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
  /** Голос включён человеком; выключен — микрофон закрыт и сам не открывается. */
  private enabled = true;
  /** Микрофон был открыт к выключению — включение открывает его снова. */
  private micBeforeOff = false;
  /** Звук калибровки (id 0) ждём: шаг «голос штаба» или «перебивание» начат и не отменён. */
  private calibSound = false;

  private micCtx: AudioContext | null = null;
  private playCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nextT = 0;
  private sources: { src: AudioBufferSourceNode; id: number }[] = [];
  /** По фразам: `done` — сервис сказал, что кусков больше нет; сыграно — когда доиграли все. */
  private phrases = new Map<number, { done: boolean }>();

  get status(): VoiceStatus { return voiceStatus(this.api, this.wsState, this.ready, this.failed, this.serviceError !== null); }

  /** Почему голос не запустился: ошибка сервиса до `ready` или ошибка из состояния шлюза; нет — null. */
  get errorText(): string | null {
    if (this.ready) return null;
    return this.serviceError ?? (this.api as { error?: string } | null)?.error ?? null;
  }

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

  /**
   * Только подключение к сервису (без микрофона): узнать, есть ли сервис, не спрашивая микрофон.
   * Микрофон — `start()`, когда сервис ответил.
   */
  connect(hello: Partial<VoiceSettings> = {}) {
    this.hello = { ...hello, ...this.hello };
    this.wanted = true;
    if (!this.ws && !this.timer) this.open();
  }

  /**
   * Выключить или включить голос. Выключение: микрофон закрыт (дорожки остановлены) и сам не переподключается,
   * звук штаба и все фразы остановлены (`finishSpeech` — фразы договариваются: ответ на «Штаб, отбой»);
   * связь с сервисом остаётся — он не выгружается, включение мгновенное. Включение: снова микрофон, если он был
   * открыт к выключению (иначе его откроет `start()`, когда сервис ответит).
   */
  setEnabled(on: boolean, opts: { finishSpeech?: boolean } = {}): Promise<void> {
    if (on === this.enabled) return Promise.resolve();
    this.enabled = on;
    if (!on) {
      this.micBeforeOff = this.micCtx !== null || this.starting !== null;
      this.calibSound = false;
      this.stopPlayback(0);
      if (!opts.finishSpeech) this.stop();
      this.closeMic();
      return Promise.resolve();
    }
    const again = this.micBeforeOff;
    this.micBeforeOff = false;
    return again ? this.start(this.hello) : Promise.resolve();
  }

  /** Микрофон и подключение к сервису. Ошибка микрофона — с разбором причины. Голос выключен — без микрофона. */
  start(hello: Partial<VoiceSettings> = {}): Promise<void> {
    if (this.micCtx || !this.enabled) return Promise.resolve();
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
    if (!this.enabled) {  // выключили, пока браузер давал микрофон: не держим его
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      return;
    }
    try {
      const micCtx = new AudioContext();
      this.micCtx = micCtx;
      this.playCtx ??= new AudioContext();  // после выключения голоса звук штаба — в прежнем
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try { await micCtx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      // выключили, пока готовилась обработка звука: микрофон уже закрыт, связь с сервисом не трогаем;
      // успели включить снова — эта попытка пропала, открываем микрофон заново
      if (!this.enabled || this.micCtx !== micCtx) {
        if (this.micCtx === micCtx) this.closeMic();
        else void micCtx.close().catch(() => {});
        return this.enabled ? this.doStart(hello) : undefined;
      }
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
    if (!this.ws && !this.timer) this.open();
  }

  /** Отключение: микрофон, звук, переподключения. */
  close() {
    this.wanted = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const old = this.ws;
    this.ws = null;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; old.close(); }
    this.stopPlayback();
    this.closeMic();
    void this.playCtx?.close();
    this.playCtx = null;
    this.ready = false;
    this.failed = false;
    this.fails = 0;
    this.serviceError = null;
    this.setWs('closed');
  }

  /** Закрыть микрофон: дорожки остановлены (система гасит значок микрофона), обработка звука закрыта. */
  private closeMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.micCtx?.close();
    this.stream = null; this.micCtx = null;
  }

  private url(): string {
    try { return localStorage.getItem(URL_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
  }

  private open() {
    if (!this.wanted || this.ws) return;
    this.setWs('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { this.failed = true; this.fails++; this.setWs('closed'); this.scheduleReconnect(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.ready = false;  // до нового `ready` сервис не считается готовым
      this.failed = false;
      this.fails = 0;
      this.everOpened = true;
      this.serviceError = null;
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
    let opened = false;
    ws.addEventListener('open', () => { opened = true; });
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!opened) { this.failed = true; this.fails++; }
      this.stopPlayback();  // обрыв: договаривать некому
      this.setWs('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* следом придёт close */ };
  }

  private scheduleReconnect() {
    if (!this.wanted || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.open(); }, reconnectDelay(Math.max(1, this.fails), this.everOpened));
  }

  private setWs(s: WsState) { this.wsState = s; this.emitStatus(); }

  private emitStatus() {
    const s = this.status;
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    this.statusCbs.forEach((cb) => cb(s));
  }

  private onMessage(m: ServerMsg) {
    if (m.type === 'ready') { this.ready = true; this.serviceError = null; this.emitStatus(); }
    else if (m.type === 'error' && !this.ready) { this.serviceError = m.text; this.emitStatus(); }
    else if (m.type === 'barge') { this.cancelled.add(m.id); this.stopPlayback(m.id); }
    // остановил сервис (калибровка, запись голоса, отказ от записи): уже пришедший звук не доигрывается
    else if (m.type === 'say-done' && m.stopped) { this.cancelled.add(m.id); this.stopPlayback(m.id); }
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

  /** Шаг калибровки. Отмена гасит звук калибровки — и тот, что придёт позже (сервис мог ещё готовить его). */
  calib(step: CalibStep, sec?: number) {
    this.calibSound = step === 'echo' || step === 'over';
    if (step === 'cancel') this.stopPlayback(0);
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
    if (!a.pcm.length || (a.id !== 0 && this.cancelled.has(a.id)) || (a.id === 0 && !this.calibSound)) return;
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
