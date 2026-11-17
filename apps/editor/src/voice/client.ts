// Связь окна с голосовым сервисом: микрофон (AudioWorklet), воспроизведение, WebSocket.
// Все браузерные API — здесь; разбор протокола и состояние — в protocol.ts.
import {
  CancelledIds, VOICE_SAY_IDS, micConstraints, micFrame, parseAudio, reconnectDelay, voiceStatus,
  type AudioChunk, type CalibStep, type ClientMsg, type ServerMsg, type VoiceRole, type VoiceSettings, type VoiceStatus, type WsState,
} from './protocol';

export { VOICE_SAY_IDS } from './protocol';
import type { TtsInfo } from './tts-store';
import { MIC_CHANGED_NOTE, MIC_KEY, OUT_KEY, onDevicesChanged, parseDevices, pickDevice, type AudioDevices } from './audio-devices';

const DEFAULT_URL = 'ws://127.0.0.1:47645/ws';
const URL_KEY = 'def_ops.voice.url';

/**
 * Пересчёт микрофона в 16 кГц и кадры по 512 отсчётов (int16) — в AudioWorklet (как на стенде). Вход 0 — микрофон,
 * вход 1 — весь звук штаба, который в этот же миг уходит в динамики. В режиме `stereo` (сервис подавляет эхо) к кадру
 * микрофона прикладывается опора — отсчёты этого звука с тех же мгновений; ничего не звучит — нули.
 */
const WORKLET = `
class Mic extends AudioWorkletProcessor {
  constructor() {
    super(); this.ratio = sampleRate / 16000; this.acc = 0; this.out = new Int16Array(512); this.ref = new Int16Array(512);
    this.n = 0; this.peak = 0; this.stereo = false;
    this.port.onmessage = (e) => { this.stereo = !!e.data.stereo; this.n = 0; this.acc = 0; this.peak = 0; };
  }
  process(inputs) {
    const ch = inputs[0][0]; if (!ch) return true;
    const rf = this.stereo && inputs[1] ? inputs[1][0] : undefined;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1; this.peak = Math.max(this.peak, Math.abs(ch[i]));
      if (this.acc >= this.ratio) { this.acc -= this.ratio;
        const v = Math.max(-1, Math.min(1, ch[i])); this.out[this.n] = v * 32767;
        if (this.stereo) this.ref[this.n] = rf ? Math.max(-1, Math.min(1, rf[i])) * 32767 : 0;
        if (++this.n === 512) {
          this.port.postMessage(this.stereo ? { pcm: this.out.buffer.slice(0), ref: this.ref.buffer.slice(0), peak: this.peak }
            : { pcm: this.out.buffer.slice(0), peak: this.peak });
          this.n = 0; this.peak = 0;
        } }
    }
    return true;
  }
}
registerProcessor('mic', Mic);`;

/**
 * Фильтр нижних частот перед пересчётом в 16 кГц (4-й порядок, 7 кГц) — на микрофоне и на опоре одинаковый: путь
 * эха «динамик → микрофон» для подавления остаётся линейным, а не складывается с отражениями частот выше 8 кГц.
 */
function lowpass(ctx: BaseAudioContext): BiquadFilterNode[] {
  return [0, 1].map(() => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 7000;
    f.Q.value = 0.707;
    return f;
  });
}

/** Соединить узлы цепочкой; вернуть последний. */
function chain(nodes: AudioNode[]): AudioNode {
  nodes.reduce((a, b) => { a.connect(b); return b; });
  return nodes[nodes.length - 1];
}

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
  private batchCapable = false;
  private temperatureCapable = false;
  private cpuThreadsCapable = false;
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
  /** Звук выключен человеком: фразы в сервис не уходят. */
  private muted = false;
  /** Выбранные устройства: id; пусто — как в системе. */
  private micId = lsGetStr(MIC_KEY);
  private outId = lsGetStr(OUT_KEY);
  private lastInputs: { id: string; label: string }[] = [];
  private deviceCbs = new Set<(d: AudioDevices & { mic: string; out: string; outSupported: boolean; note?: string }) => void>();
  private devicesBound = false;
  /** Микрофон был открыт к выключению — включение открывает его снова. */
  private micBeforeOff = false;
  /** Звук калибровки (id 0) ждём: шаг «голос штаба» или «перебивание» начат и не отменён. */
  private calibSound = false;

  /**
   * Один звуковой граф на микрофон и звук штаба: весь звук штаба (ответы, пробы голоса, звук калибровки) идёт через
   * `bus` в динамики и, вторым входом, в ворклет микрофона — опорой подавления эха, по отсчётам вровень с микрофоном.
   * Выключение голоса закрывает только микрофон: граф остаётся, фразы договариваются.
   */
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  /** Громкость штаба в динамиках: после `bus`, так что опора подавления эха от неё не зависит. */
  private out: GainNode | null = null;
  private volume = 1;
  private node: AudioWorkletNode | null = null;
  private nodeReady: Promise<AudioWorkletNode> | null = null;
  private stream: MediaStream | null = null;
  /** Источник микрофона и его фильтры — отсоединяются, когда микрофон закрывается или открывается заново. */
  private micIn: AudioNode[] = [];
  /** Сервис подавляет эхо (`ready.aec`): микрофон без обработки браузера, кадры с опорой. */
  private aec = false;
  /** Для какого режима взят нынешний микрофон. */
  private streamAec = false;
  private swapping = false;
  private nextT = 0;
  private sources: { src: AudioBufferSourceNode; id: number }[] = [];
  /** Заготовки `prepare`, ждущие ответа: номер → чем ответить (true — звук готов). */
  private prepWait = new Map<number, (ok: boolean) => void>();
  private batchWait = new Map<number, { finish(ok: boolean, error?: string): void; progress(done: number, total: number): void; total: number; done: number }>();
  private prepId = 0;
  private resourceId = 0;
  private resourceWait = new Map<number, (info?: TtsInfo, error?: string) => void>();
  /** По фразам: `done` — сервис сказал, что кусков больше нет; сыграно — когда доиграли все. */
  private phrases = new Map<number, { done: boolean }>();
  /** Куски фразы до `say-done`: играем целиком, когда синтез закончился. */
  private held = new Map<number, AudioChunk[]>();
  /** Синтез закончен, звук ждёт, пока доиграет более ранняя фраза. */
  private buffered = new Map<number, AudioChunk[]>();

  get supportsPrepareBatch(): boolean { return this.batchCapable; }

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

  /** Громкость звука штаба (0–1), сразу — и для звучащей фразы. */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
  }

  /** Возобновить звук после действия человека (браузер может держать AudioContext приостановленным). */
  resume() {
    // первое действие человека — граф звука создаётся сразу (браузер разрешает звук только после него)
    if (typeof AudioContext === 'undefined') return;
    void this.audio().ctx.resume().catch(() => {});
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
   * Выключить или включить голосовое управление (микрофон). Выключение: микрофон закрыт (дорожки остановлены) и сам
   * не переподключается; звук штаба и фразы не трогаются — посредник и экскурсии продолжают говорить (их глушит
   * `setMuted`); связь с сервисом остаётся — включение мгновенное. Включение: снова микрофон, если он был открыт к
   * выключению (иначе его откроет `start()`, когда сервис ответит).
   */
  setEnabled(on: boolean): Promise<void> {
    if (on === this.enabled) return Promise.resolve();
    this.enabled = on;
    if (!on) {
      this.micBeforeOff = this.stream !== null || this.starting !== null;
      this.closeMic();
      return Promise.resolve();
    }
    const again = this.micBeforeOff;
    this.micBeforeOff = false;
    return again ? this.start(this.hello) : Promise.resolve();
  }

  /**
   * Выключить или включить звук: любая озвучка (штаб, посредник, экскурсии, пробы). Выключение — звук и все фразы
   * остановлены, новые не уходят в сервис; микрофон и распознавание не затронуты.
   */
  setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) { this.calibSound = false; this.stopPlayback(0); this.stop(); }
  }

  /** Микрофон и подключение к сервису. Ошибка микрофона — с разбором причины. Голос выключен — без микрофона. */
  start(hello: Partial<VoiceSettings> = {}): Promise<void> {
    if (this.stream || !this.enabled) return Promise.resolve();
    // одновременные вызовы делят одну попытку
    this.starting ??= this.doStart(hello).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doStart(hello: Partial<VoiceSettings>): Promise<void> {
    this.hello = hello;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(`Браузер не даёт микрофон этой странице: адрес ${location.origin} не считается защищённым.`);
    const aec = this.aec;
    let stream: MediaStream;
    try {
      stream = await this.getMic(aec);
    } catch (e) { throw await micDenied(e); }
    const drop = () => stream.getTracks().forEach((t) => t.stop());
    if (!this.enabled) { drop(); return; }  // выключили, пока браузер давал микрофон: не держим его
    try {
      const { ctx, bus } = this.audio();
      await this.worklet(ctx, bus);
      // выключили (или закрыли), пока готовилась обработка звука: микрофон не держим, связь с сервисом не трогаем
      if (!this.enabled || this.ctx !== ctx) { drop(); return; }
      this.attachMic(stream, aec);
    } catch (e) {
      drop();
      this.close();  // не оставляем открытый микрофон и «занятое» состояние: повторный запуск должен работать
      throw e;
    }
    this.wanted = true;
    if (!this.ws && !this.timer) this.open();
    void this.syncCapture();  // сервис ответил, пока открывался микрофон, — и режим другой
  }

  /** Микрофон: выбранное устройство; его нет (отключено) — системное, выбор сбрасывается. */
  private async getMic(aec: boolean): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(aec, this.micId) });
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (this.micId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        this.micId = '';
        lsSetStr(MIC_KEY, '');
        this.emitDevices(MIC_CHANGED_NOTE);
        return navigator.mediaDevices.getUserMedia({ audio: micConstraints(aec) });
      }
      throw e;
    }
  }

  /** Устройства звука: списки, выбранные, поддерживается ли выбор вывода (в окне macOS его может не быть). */
  async devices(): Promise<AudioDevices & { mic: string; out: string; outSupported: boolean }> {
    let list: AudioDevices = { inputs: [], outputs: [] };
    try { list = parseDevices(await navigator.mediaDevices.enumerateDevices()); } catch { /* список недоступен — только «как в системе» */ }
    this.lastInputs = list.inputs;
    return { ...list, mic: pickDevice(this.micId, list.inputs), out: pickDevice(this.outId, list.outputs), outSupported: this.outSupported() };
  }

  private outSupported(): boolean { return typeof AudioContext !== 'undefined' && typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === 'function'; }

  /** Подписка на изменения устройств (подключили или отключили); возвращает отписку. Первая подписка включает слежение. */
  onDevices(cb: (d: AudioDevices & { mic: string; out: string; outSupported: boolean; note?: string }) => void): () => void {
    this.deviceCbs.add(cb);
    if (!this.devicesBound && navigator.mediaDevices?.addEventListener) {
      this.devicesBound = true;
      navigator.mediaDevices.addEventListener('devicechange', () => { void this.deviceChanged(); });
    }
    return () => { this.deviceCbs.delete(cb); };
  }

  private async emitDevices(note?: string) {
    const d = await this.devices();
    this.deviceCbs.forEach((f) => f({ ...d, ...(note ? { note } : {}) }));
  }

  private async deviceChanged() {
    const before = this.lastInputs;
    const d = await this.devices();
    const act = onDevicesChanged({ chosen: this.micId, before, after: d.inputs });
    let note: string | undefined;
    if (act === 'fallback') { this.micId = ''; lsSetStr(MIC_KEY, ''); }
    if ((act === 'fallback' || act === 'reopen') && this.stream && this.enabled) { await this.reopenMic(); note = MIC_CHANGED_NOTE; }
    this.deviceCbs.forEach((f) => f({ ...d, mic: this.micId, ...(note ? { note } : {}) }));
  }

  /** Выбрать микрофон (id; '' — как в системе): запоминается; микрофон открыт — переоткрывается с новым устройством. */
  async setMic(id: string): Promise<void> {
    if (id === this.micId) return;
    this.micId = id;
    lsSetStr(MIC_KEY, id);
    if (this.stream && this.enabled) await this.reopenMic();
    await this.emitDevices(MIC_CHANGED_NOTE);
  }

  /** Выбрать устройство вывода (если окно это умеет); false — выбор не поддерживается. */
  async setOut(id: string): Promise<boolean> {
    if (!this.outSupported()) return false;
    this.outId = id;
    lsSetStr(OUT_KEY, id);
    try { await (this.ctx as unknown as { setSinkId(v: string): Promise<void> } | null)?.setSinkId(id); } catch { return false; }
    await this.emitDevices();
    return true;
  }

  /** Открыть микрофон заново (устройство сменилось); не вышло — остаётся прежний. */
  private async reopenMic() {
    const aec = this.aec;
    try {
      const s = await this.getMic(aec);
      if (!this.stream || !this.enabled || !this.node) { s.getTracks().forEach((t) => t.stop()); return; }
      this.attachMic(s, aec);
    } catch (e) { console.warn('микрофон не переоткрылся', e); }
  }

  /** Звуковой граф: создаётся с первым микрофоном, первым звуком или первым действием человека; звук штаба — через `bus`. */
  private audio(): { ctx: AudioContext; bus: GainNode } {
    if (!this.ctx || !this.bus) {
      const ctx = new AudioContext();
      if (this.outId && this.outSupported()) void (ctx as unknown as { setSinkId(v: string): Promise<void> }).setSinkId(this.outId).catch(() => {});
      const bus = ctx.createGain();
      const out = ctx.createGain();
      out.gain.value = this.volume;
      bus.connect(out);
      out.connect(ctx.destination);
      this.ctx = ctx;
      this.bus = bus;
      this.out = out;
    }
    return { ctx: this.ctx, bus: this.bus };
  }

  /** Ворклет микрофона (один на граф): вход 0 — микрофон, вход 1 — звук штаба через фильтр. */
  private worklet(ctx: AudioContext, bus: GainNode): Promise<AudioWorkletNode> {
    this.nodeReady ??= (async () => {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const node = new AudioWorkletNode(ctx, 'mic', { numberOfInputs: 2, channelCount: 1, channelCountMode: 'explicit' });
      chain([bus, ...lowpass(ctx)]).connect(node, 0, 1);
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; ref?: ArrayBuffer }>) => this.onMic(e.data);
      if (this.ctx === ctx) this.node = node;
      return node;
    })().catch((e: unknown) => { this.nodeReady = null; throw e; });
    return this.nodeReady;
  }

  /** Подключить микрофон к ворклету (прежний — закрыть). С подавлением эха — через тот же фильтр, что и опора. */
  private attachMic(stream: MediaStream, aec: boolean) {
    const ctx = this.ctx, node = this.node;
    if (!ctx || !node) throw new Error('звук не готов');
    this.closeMic();
    const nodes: AudioNode[] = [ctx.createMediaStreamSource(stream), ...(aec ? lowpass(ctx) : [])];
    chain(nodes).connect(node, 0, 0);
    this.micIn = nodes;
    this.stream = stream;
    this.streamAec = aec;
    node.port.postMessage({ stereo: aec });
  }

  /**
   * Микрофон взят не для того режима, что сказал сервис (сервис перезапустили с подавлением эха или без): открыть
   * его заново с нужной обработкой. Не вышло — остаётся прежний (кадры сервис примет и такие).
   */
  private async syncCapture() {
    if (!this.stream || this.streamAec === this.aec || this.swapping) return;
    this.swapping = true;
    const aec = this.aec;
    try {
      const s = await this.getMic(aec);
      if (!this.stream || !this.enabled || !this.node) { s.getTracks().forEach((t) => t.stop()); return; }
      this.attachMic(s, aec);
    } catch (e) {
      console.warn('микрофон не переоткрылся для подавления эха — остаётся прежний', e);
      return;
    } finally { this.swapping = false; }
    void this.syncCapture();  // режим успел смениться ещё раз
  }

  /** Кадр ворклета → сервису: микрофон, в режиме подавления эха — с опорой. */
  private onMic(d: { pcm: ArrayBuffer; ref?: ArrayBuffer }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(micFrame(new Int16Array(d.pcm), d.ref ? new Int16Array(d.ref) : undefined));
  }

  /** Отключение: микрофон, звук, переподключения. */
  close() {
    this.wanted = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const old = this.ws;
    this.ws = null;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; old.close(); }
    this.stopPlayback();
    this.settlePrepared();
    this.settleResources();
    this.closeMic();
    this.node?.disconnect();
    void this.ctx?.close();
    this.ctx = null; this.bus = null; this.out = null; this.node = null; this.nodeReady = null;
    this.ready = false;
    this.batchCapable = this.temperatureCapable = this.cpuThreadsCapable = false;
    this.failed = false;
    this.fails = 0;
    this.serviceError = null;
    this.setWs('closed');
  }

  /** Закрыть микрофон: дорожки остановлены (система гасит значок микрофона), источник отсоединён от ворклета. */
  private closeMic() {
    this.micIn.forEach((n) => n.disconnect());
    this.micIn = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
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
      this.batchCapable = this.temperatureCapable = this.cpuThreadsCapable = false;
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
      this.batchCapable = this.temperatureCapable = this.cpuThreadsCapable = false;
      if (!opened) { this.failed = true; this.fails++; }
      this.stopPlayback();  // обрыв: договаривать некому
      this.settlePrepared();
      this.settleResources();  // и заготовки пропали вместе с подключением
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
    if (m.type === 'ready') {
      this.batchCapable = m.capabilities?.prepare_batch === true;
      this.temperatureCapable = m.capabilities?.tts_temperature === true;
      this.cpuThreadsCapable = m.capabilities?.tts_cpu_threads === true;
      this.ready = true; this.serviceError = null; this.aec = m.aec === true; this.emitStatus();
      void this.syncCapture();
    }
    else if (m.type === 'error' && !this.ready) { this.serviceError = m.text; this.emitStatus(); }
    else if (m.type === 'barge') { this.cancelled.add(m.id); this.stopPlayback(m.id); }
    // остановил сервис (калибровка, запись голоса, отказ от записи): уже пришедший звук не доигрывается
    else if (m.type === 'say-done' && m.stopped) { this.cancelled.add(m.id); this.stopPlayback(m.id); }
    else if (m.type === 'say-done') this.phraseDone(m.id);
    else if (m.type === 'tts-resource-done') { const f = this.resourceWait.get(m.id); this.resourceWait.delete(m.id); f?.(m.tts, m.error); }
    else if (m.type === 'prepared') { const f = this.prepWait.get(m.id); this.prepWait.delete(m.id); f?.(!m.error); }
    else if (m.type === 'prepared-batch') {
      const wait = this.batchWait.get(m.id);
      if (wait) {
        if (m.error) wait.finish(false, m.error);
        else if (m.total !== wait.total || !Number.isInteger(m.done) || m.done < wait.done || m.done > m.total) {
          this.send({ type: 'cancel-prepare-batch', id: m.id });
          wait.finish(false, 'Неверный счётчик готовности пакетной озвучки');
        } else {
          wait.done = m.done;
          wait.progress(m.done, m.total);
          if (m.done === m.total) wait.finish(true);
        }
      }
    }
    this.handlers.get(m.type)?.forEach((cb) => cb(m as never));
  }

  // --- команды сервису ---

  private send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  say(id: number, role: VoiceRole, text: string, more?: boolean, voiceId?: string, temperature?: number, cpuThreads?: number) {
    const sampling = this.sampling(temperature, cpuThreads);
    if (this.muted) return;
    this.cancelled.revive(id);
    this.send({ type: 'say', id, role, text, ...(more !== undefined ? { more } : {}), ...(voiceId ? { voice_id: voiceId } : {}), ...sampling });
  }

  /**
   * Заготовить звук фразы заранее (сервис синтезирует её целиком и держит до `say` того же текста тем же голосом).
   * Промис — когда звук готов (true) или заготовка не вышла: сервис не готов, нет связи, ошибка синтеза (false).
   */
  async prepare(role: VoiceRole, text: string, voiceId?: string, signal?: AbortSignal, temperature?: number, cpuThreads?: number): Promise<boolean> {
    const sampling = this.sampling(temperature, cpuThreads);
    if (signal?.aborted || this.muted || !this.ready || this.ws?.readyState !== WebSocket.OPEN || !text.trim()) return Promise.resolve(false);
    const id = ++this.prepId;
    return new Promise((res) => {
      const finish = (ok: boolean) => { signal?.removeEventListener('abort', abort); res(ok); };
      const abort = () => {
        this.prepWait.delete(id);
        this.send({ type: 'cancel-prepare', id });
        finish(false);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.prepWait.set(id, finish);
      this.send({ type: 'prepare', id, role, text, ...(voiceId ? { voice_id: voiceId } : {}), ...sampling });
    });
  }

  /** Параметр на запрос: старый сервис допускает только совместимое умолчание 0,2. */
  private sampling(temperature?: number, cpuThreads?: number): { temperature?: number; cpu_threads?: number } {
    const result: { temperature?: number; cpu_threads?: number } = {};
    if (temperature !== undefined) {
      if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1)
        throw new Error('Температура голоса должна быть числом от 0 до 1');
      if (this.temperatureCapable) result.temperature = temperature;
      else if (temperature !== 0.2) throw new Error('Голосовой сервис не поддерживает настройку температуры. Обновите сервис.');
    }
    if (cpuThreads !== undefined) {
      if (![1, 2, 4, 8].includes(cpuThreads)) throw new Error('Число потоков CPU должно быть 1, 2, 4 или 8');
      if (this.cpuThreadsCapable) result.cpu_threads = cpuThreads;
      else if (cpuThreads !== 2) throw new Error('Голосовой сервис не поддерживает настройку потоков CPU для TTS (PyTorch/Windows). Обновите сервис.');
    }
    return result;
  }

  /** Группа остаётся одним запросом сервиса; прогресс приходит после готовых пакетов. */
  async prepareBatch(role: VoiceRole, texts: string[], voiceId?: string, signal?: AbortSignal, options: {
    temperature?: number; cpuThreads?: number; batchSize?: 1 | 2 | 4; onProgress?: (done: number, total: number) => void;
  } = {}): Promise<boolean> {
    const sampling = this.sampling(options.temperature, options.cpuThreads);
    const batchSize = options.batchSize ?? 4;
    if (batchSize !== 1 && batchSize !== 2 && batchSize !== 4) throw new Error('Размер пакета должен быть 1, 2 или 4');
    if (signal?.aborted || this.muted || !this.ready || this.ws?.readyState !== WebSocket.OPEN) return false;
    if (!texts.length) return true;
    if (texts.some(text => typeof text !== 'string' || !text.trim())) throw new Error('Пакет озвучки содержит пустую фразу');
    if (!this.supportsPrepareBatch) {
      // Прежняя версия: строго последовательно, без очереди будущих фраз после отмены/разрыва.
      const connection = this.ws;
      for (let i = 0; i < texts.length; i++) {
        if (signal?.aborted || this.ws !== connection || !await this.prepare(role, texts[i], voiceId, signal, options.temperature, options.cpuThreads)) return false;
        if (signal?.aborted || this.ws !== connection) return false;
        options.onProgress?.(i + 1, texts.length);
      }
      return true;
    }
    const id = ++this.prepId;
    return new Promise((resolve, reject) => {
      const finish = (ok: boolean, error?: string) => {
        this.batchWait.delete(id);
        signal?.removeEventListener('abort', abort);
        if (error) reject(new Error(error)); else resolve(ok);
      };
      const abort = () => { this.send({ type: 'cancel-prepare-batch', id }); finish(false); };
      signal?.addEventListener('abort', abort, { once: true });
      this.batchWait.set(id, { finish, total: texts.length, done: 0, progress: (done, total) => options.onProgress?.(done, total) });
      this.send({ type: 'prepare-batch', id, role, texts: [...texts], batch_size: batchSize, ...(voiceId ? { voice_id: voiceId } : {}), ...sampling });
    });
  }

  /** Связь пропала: ждущие заготовки не придут. */
  private settlePrepared() {
    const ws = [...this.prepWait.values()];
    this.prepWait.clear();
    ws.forEach((f) => f(false));
    const batches = [...this.batchWait.values()];
    this.batchWait.clear();
    batches.forEach(wait => wait.finish(false));
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

  ttsResource(op: 'load' | 'unload', voiceId?: string, signal?: AbortSignal): Promise<TtsInfo> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Нет связи с голосовым сервисом'));
    const id = ++this.resourceId;
    return new Promise((resolve, reject) => {
      const finish = (info?: TtsInfo, error?: string) => {
        this.resourceWait.delete(id);
        signal?.removeEventListener('abort', abort);
        if (error || !info) reject(new Error(error ?? 'Нет связи с голосовым сервисом')); else resolve(info);
      };
      const abort = () => { this.resourceWait.delete(id); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
      this.resourceWait.set(id, finish);
      signal?.addEventListener('abort', abort, { once: true });
      this.send({ type: 'tts-resource', id, op, ...(voiceId ? { voice_id: voiceId } : {}) });
    });
  }

  private settleResources() {
    const pending = [...this.resourceWait.values()];
    this.resourceWait.clear();
    pending.forEach((finish) => finish(undefined, 'Нет связи с голосовым сервисом'));
  }

  /** Модель озвучки: список или смена (сервис отвечает `tts_list`). */
  tts(op: 'list' | 'set', id?: string) {
    this.send(id === undefined ? { type: 'tts', op } : { type: 'tts', op, id });
  }

  voice(op: string, args: Record<string, unknown> = {}) {
    this.send({ ...args, type: 'voice', op });
  }

  // --- воспроизведение ---

  private onAudio(buf: ArrayBuffer) {
    if (typeof AudioContext === 'undefined') return;
    let a: AudioChunk;
    try { a = parseAudio(buf); } catch { return; }
    if (!a.pcm.length || (a.id !== 0 && this.cancelled.has(a.id)) || (a.id === 0 && !this.calibSound)) return;
    if (!this.phrases.has(a.id) && a.id !== 0) this.phrases.set(a.id, { done: false });
    // чужая фраза ещё звучит — этот кусок ждёт своей очереди; иначе играем сразу, не дожидаясь конца синтеза
    if (a.id !== 0 && this.sources.some((x) => x.id !== a.id)) {
      const q = this.buffered.get(a.id) ?? [];
      q.push(a);
      this.buffered.set(a.id, q);
      return;
    }
    this.playChunk(a);
  }

  private playChunk(a: AudioChunk) {
    const { ctx, bus } = this.audio();
    void ctx.resume();
    const ab = ctx.createBuffer(1, a.pcm.length, a.rate);
    const ch = ab.getChannelData(0);
    for (let i = 0; i < a.pcm.length; i++) ch[i] = a.pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(bus);
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
    if (this.cancelled.has(id)) return;
    const held = this.held.get(id) ?? [];
    this.held.delete(id);
    this.buffered.set(id, [...(this.buffered.get(id) ?? []), ...held]);
    const p = this.phrases.get(id);
    if (p) p.done = true;
    else this.phrases.set(id, { done: true });
    this.pump();
  }

  /** Следующая готовая фраза — только когда сейчас никто не звучит. Более ранний номер ждёт своего синтеза. */
  private pump() {
    if (this.sources.length) return;
    const ids = [...this.phrases.keys()].sort((a, b) => a - b);
    const id = ids[0];
    if (id === undefined) return;
    const p = this.phrases.get(id);
    if (!p?.done) return;
    const chunks = this.buffered.get(id) ?? [];
    this.buffered.delete(id);
    for (const a of chunks) this.playChunk(a);
    this.checkPlayed(id);
  }

  /** Фраза доиграна: сервис договорил (`say-done`) и в очереди не осталось её кусков. */
  private checkPlayed(id: number) {
    const p = this.phrases.get(id);
    if (!p || !p.done || this.sources.some((x) => x.id === id)) return;
    this.phrases.delete(id);
    this.send({ type: 'played', id });
    this.playedCbs.forEach((cb) => cb(id));
    this.pump();
  }

  /** Остановить звук: одной фразы или всего. Для остановленных `played` не шлётся. */
  stopPlayback(id?: number) {
    const keep: typeof this.sources = [];
    for (const x of this.sources) {
      if (id === undefined || x.id === id) { x.src.onended = null; try { x.src.stop(); } catch { /* уже кончился */ } }
      else keep.push(x);
    }
    this.sources = keep;
    if (id === undefined) { this.phrases.clear(); this.held.clear(); this.buffered.clear(); this.nextT = 0; }
    else {
      this.phrases.delete(id);
      this.held.delete(id);
      this.buffered.delete(id);
      if (!keep.length) this.nextT = 0;
    }
  }
}

const lsGetStr = (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const lsSetStr = (k: string, v: string): void => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* */ } };
