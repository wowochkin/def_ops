/**
 * Чем говорит стенд. Заготовленные фразы — всегда из предзаписи (`prerecord.ts`): клипы заранее декодированы, куски
 * склейки ставятся в звук встык через WebAudio, с паузой по знаку. Живой голос (голосовой сервис системы, голос
 * начальника штаба) — только для текста, составленного ИИ сейчас, и только в режиме «С ИИ»; сервиса нет или он не
 * успевает начать — звучит заготовка на замену из предзаписи. Синтез речи окна не берём никогда: чужой голос на стенде
 * хуже тишины. Тишина с субтитрами — только для фразы без предзаписи (предзапись не подготовлена).
 */
import { VoiceClient } from '../voice/client';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY } from '../voice/panel-state';
import { setPrerecord, setVoiceGaps } from './health';
import { BANK } from './bank';
import { MAP } from './map';
import { clipPlan, debriefClip, joinGap, loadClip, loadDebriefManifest, loadManifest, missingClips, stageDomains, type Clip, type DebriefVoices, type VoiceManifest } from './prerecord';
import { expoVoiceProfile, expoSpeechText } from './live-voice-profile';
import type { Line, Speaker } from './voice-queue';

/** Затухание оборванной фразы, с. */
export const FADE_S = 0.3;
/** Срок получения буфера и запуска аудио. Уже играющий клип этим сроком не ограничен. */
const CLIP_START_MS = 10_000;

/** Сколько читать фразу вслух, мс. */
export const readMs = (text: string) => 1500 + text.length * 65;

type Handle = ReturnType<Speaker['speak']>;

export function silentSpeaker(): Speaker {
  return {
    speak(text, line) {
      let t: ReturnType<typeof setTimeout> | undefined;
      let remaining = line?.durationMs ?? readMs(text);
      let began = Date.now();
      let paused = false, ended = false;
      let finish = () => {};
      const done = new Promise<void>((r) => { finish = () => { ended = true; clearTimeout(t); r(); }; t = setTimeout(finish, remaining); });
      return { done, played: () => false, stop: finish,
        pause() { if (paused || ended) return; paused = true; remaining = Math.max(0, remaining - (Date.now() - began)); clearTimeout(t); },
        resume() { if (!paused || ended) return; paused = false; began = Date.now(); t = setTimeout(finish, remaining); },
      };
    },
  };
}

/** Звук, нужный проигрывателю клипов (AudioContext или его подмена в проверках). */
export interface ClipAudio {
  currentTime: number;
  destination: unknown;
  decodeAudioData(b: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  /** Есть — обрыв фразы с затуханием (`FADE_S`), нет — сразу. */
  createGain?(): GainNode;
  state?: string;
  resume?(): Promise<void>;
  suspend?(): Promise<void>;
}

/**
 * Проигрыватель предзаписи: клипы декодируются заранее (`preload`, в пределах `budgetS` секунд звука — память),
 * фраза ставится в звук, когда готовы буферы всех её кусков, — встык, без зазоров. Буфера нет (вытеснен или не дошёл)
 * — он декодируется тут же (миллисекунды); давно не звучавшие вытесняются сверх бюджета.
 */
export function clipPlayer(
  audio: () => ClipAudio, load: (file: string, signal?: AbortSignal) => Promise<ArrayBuffer> = loadClip, budgetS = 420, out?: () => unknown,
) {
  const bufs = new Map<string, Promise<AudioBuffer>>();
  const loading = new Map<string, AbortController>();
  const secs = new Map<string, number>();
  let total = 0;
  const active = new Set<AudioBufferSourceNode>();
  const pending = new Set<() => void>();
  let epoch = 0;
  const hush = () => {
    epoch += 1;
    for (const stop of [...pending]) stop();
    for (const controller of loading.values()) controller.abort();
    for (const s of active) {
      s.onended = null;
      try { s.stop(); } catch { /* уже кончился */ }
    }
    active.clear();
  };
  const evict = () => {
    for (const [f, s] of secs) {
      if (total <= budgetS) break;
      secs.delete(f);
      bufs.delete(f);
      total -= s;
    }
  };
  const buffer = (file: string) => {
    // stopAll и новый play могут прийти в одном стеке, раньше обработчика отклонённого Promise.
    if (loading.get(file)?.signal.aborted) bufs.delete(file);
    let b = bufs.get(file);
    if (b) {
      bufs.delete(file);
      bufs.set(file, b);
      const s = secs.get(file);
      if (s !== undefined) { secs.delete(file); secs.set(file, s); }
      return b;
    }
    const controller = new AbortController();
    loading.set(file, controller);
    const timer = setTimeout(() => controller.abort(new Error('Не удалось загрузить звук вовремя')), CLIP_START_MS);
    let onAbort = () => {};
    b = new Promise<AudioBuffer>((resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      // decodeAudioData и команда приложения не отменяются: после срока их результат не попадает ни в звук, ни в кэш.
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(file, controller.signal);
      }).then((x) => {
        controller.signal.throwIfAborted();
        return audio().decodeAudioData(x);
      }).then(resolve, reject);
    }).finally(() => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      if (loading.get(file) === controller) loading.delete(file);
    });
    b.then((x) => { if (bufs.get(file) === b) { secs.set(file, x.duration); total += x.duration; evict(); } }, () => { if (bufs.get(file) === b) bufs.delete(file); });
    bufs.set(file, b);
    return b;
  };
  return {
    /** Декодировать клипы заранее, по одному (окно не замирает), пока хватает бюджета. */
    async preload(clips: Clip[]) {
      const mine = epoch;
      let planned = 0;
      for (const c of clips) {
        if (mine !== epoch) break;
        if ((planned += c.ms / 1000) > budgetS) break;
        await buffer(c.file).catch(() => null);
      }
    },
    /** Сыграть клипы встык; `gaps[i]` — пауза после i-го, с. */
    play(clips: Clip[], gaps: number[]): Handle {
      const mine = epoch;
      const srcs: AudioBufferSourceNode[] = [];
      let gain: GainNode | null = null;
      let stopped = false;
      let played = false;
      let paused = false, started = false;
      let context: ClipAudio | null = null;
      let resumeStart: (() => void) | null = null;
      let startRemaining = CLIP_START_MS, startAt = Date.now();
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      let finish = () => {};
      const done = new Promise<void>((r) => { finish = () => { clearTimeout(startTimer); pending.delete(halt); r(); }; });
      const halt = () => {
        stopped = true;
        resumeStart?.();
        resumeStart = null;
        for (const c of clips) loading.get(c.file)?.abort();
        for (const s of srcs) {
          s.onended = null;
          active.delete(s);
          try { s.stop(); } catch { /* ещё не стартовал или уже кончился */ }
        }
        finish();
      };
      pending.add(halt);
      startTimer = setTimeout(halt, startRemaining);
      const awaitResume = () => paused ? new Promise<void>((resolve) => { resumeStart = resolve; }) : Promise.resolve();
      void Promise.all(clips.map((c) => buffer(c.file))).then(
        async (bs) => {
          await awaitResume();
          if (stopped || mine !== epoch || (typeof document !== 'undefined' && document.hidden)) return finish();
          const a = audio();
          context = a;
          // На другом мониторе касание может не разблокировать главное окно. Срок запуска не даёт зависнуть здесь.
          if (a.state === 'suspended') await a.resume?.();
          await awaitResume();
          if (stopped || mine !== epoch || (typeof document !== 'undefined' && document.hidden)) return finish();
          if (a.state !== undefined && a.state !== 'running') return halt();
          for (const s of active) {
            s.onended = null;
            try { s.stop(); } catch { /* уже кончился */ }
          }
          active.clear();
          let t = a.currentTime + 0.02;
          const dest = (out?.() ?? a.destination) as AudioNode;
          gain = a.createGain?.() ?? null;
          gain?.connect(dest);
          bs.forEach((b, i) => {
            const s = a.createBufferSource();
            s.buffer = b;
            s.connect(gain ?? dest);
            s.start(t);
            t += b.duration + (i < bs.length - 1 ? gaps[i] ?? 0 : 0);
            srcs.push(s);
            active.add(s);
          });
          const last = srcs[srcs.length - 1];
          if (!last) return halt();
          clearTimeout(startTimer);
          started = true;
          last.onended = () => { played = true; active.delete(last); finish(); };
        },
      ).catch(halt);
      return { done, played: () => played, stop: halt,
        pause() {
          if (paused || stopped || played) return;
          paused = true;
          if (!started) { startRemaining = Math.max(0, startRemaining - (Date.now() - startAt)); clearTimeout(startTimer); }
          void context?.suspend?.();
        },
        resume() {
          if (!paused || stopped || played) return;
          paused = false;
          if (!started) { startAt = Date.now(); startTimer = setTimeout(halt, startRemaining); }
          // Контекст мог быть создан, но ещё не успеть запустить источник до паузы.
          // Разблокировать ожидание старта только после фактического resume контекста.
          const release = () => {
            if (paused || stopped) return;
            resumeStart?.();
            resumeStart = null;
          };
          if (context?.resume) void context.resume().then(release, halt);
          else release();
        },
      };
    },
    /** Оборвать всё, что ещё звучит: уход со заставки, сворачивание и закрытие окна. */
    stopAll: hush,
  };
}

/** Языковая модель и живой синтез — по очереди (как в системе): пока работает одно, другое ждёт. */
export function turnstile() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(f: () => Promise<T>): Promise<T> {
      const r = tail.then(f, f);
      tail = r.catch(() => {});
      return r;
    },
  };
}
export type Turnstile = ReturnType<typeof turnstile>;

export interface LiveVoice {
  ready(): boolean;
  /** Связь есть, но выбранная модель ещё может загружаться: `prepare` дождётся её. */
  available?(): boolean;
  /** Сказать фразу: `synthDone` — сервис договорил (синтез свободен), `done` — окно доиграло. */
  say(text: string, voiceId?: string, temperature?: number, cpuThreads?: number): { synthDone: Promise<void>; done: Promise<void>; stop(): void };
}

export interface SpeakerDeps {
  manifest: () => VoiceManifest | null;
  player: ReturnType<typeof clipPlayer>;
  /** Живой голос — только «С ИИ». */
  aiOn: () => boolean;
  live: LiveVoice | null;
  gate: Turnstile;
  /** Живой голос не начал за столько — звучит замена. */
  liveStartMs?: number;
  /** Вместо фразы ИИ звучит замена — субтитр меняется на неё. */
  onSwap?: (l: Line) => void;
  /** Синтез всей фразы до начала звука: ответ модели не играет по кускам. */
  prepare?(text: string, voiceId?: string, signal?: AbortSignal): Promise<void | number | { temperature: number; cpuThreads?: number }>;
  debriefClip?(text: string, voiceId: string): Clip | null;
}

/** Речь стенда по правилам выше (без загрузки — её делает `expoSpeaker`). */
export function stageSpeaker(d: SpeakerDeps): Speaker {
  const silent = silentSpeaker();
  const liveAvailable = () => Boolean(d.live && (d.live.available?.() ?? d.live.ready()));
  const fromClips = (text: string, parts?: string[]): Handle | null => {
    const plan = clipPlan(d.manifest(), text, parts);
    if (!plan) return null;
    const ps = plan.length > 1 && parts ? parts : [text];
    return d.player.play(plan, ps.map(joinGap));
  };
  const swap = (line: Line): Handle | null => {
    const fb = line.fallback;
    const h = fb ? fromClips(fb.text, fb.parts) : null;
    if (h && fb) d.onSwap?.({ ...line, text: fb.text, parts: fb.parts, source: 'prepared', fallback: undefined });
    return h;
  };
  const intro = (text: string, line: Line): Handle => {
    const clip = fromClips(text, line.parts);
    if (!clip) return silent.speak(text, line);
    const began = Date.now();
    let pausedAt: number | null = null, pausedMs = 0;
    let stopped = false;
    let fallback: Handle | null = null;
    const done = clip.done.then(async () => {
      if (stopped || clip.played?.() !== false) return;
      // Файл недоступен: сцена остаётся на экране до своего срока, а не исчезает при ошибке декодирования.
      const remaining = Math.max(0, (line.durationMs ?? readMs(text)) - ((pausedAt ?? Date.now()) - began - pausedMs));
      if (!remaining) return;
      fallback = silent.speak(text, { ...line, durationMs: remaining });
      if (pausedAt !== null) fallback.pause?.();
      await fallback.done;
    });
    return { done, played: clip.played, stop() { stopped = true; clip.stop(); fallback?.stop(); },
      pause() { if (pausedAt !== null) return; pausedAt = Date.now(); clip.pause?.(); fallback?.pause?.(); },
      resume() { if (pausedAt === null) return; pausedMs += Date.now() - pausedAt; pausedAt = null; clip.resume?.(); fallback?.resume?.(); },
    };
  };
  const live = (text: string, line: Line): Handle => {
    let cur: Handle | null = null;
    let stopped = false;
    let finish = () => {};
    const done = new Promise<void>((r) => (finish = r));
    const lv = d.live!;
    const controller = new AbortController();
    let said: ReturnType<LiveVoice['say']> | null = null;
    let markSynth = () => {};
    const synth = new Promise<void>((r) => (markSynth = r));
    const turn = d.gate.run(async () => {
      if (stopped || !liveAvailable()) { markSynth(); return; }
      const saidText = expoSpeechText(text);
      const sampling = await d.prepare?.(saidText, line.voice, controller.signal);
      if (stopped || !lv.ready()) { markSynth(); return; }
      said = typeof sampling === 'number' ? lv.say(saidText, line.voice, sampling) : sampling ? lv.say(saidText, line.voice, sampling.temperature, sampling.cpuThreads) : lv.say(saidText, line.voice);
      said.done.then(finish, finish);
      void said.synthDone.then(markSynth, markSynth);
      return said.synthDone;
    });
    // Разбор — голос маршала, строка за строкой. Четыре секунды годны ответу с готовой заменой.
    // Фразу с образцом нельзя подменять молчанием, пока синтез предыдущей ещё занимает очередь.
    const timer = line.voice || line.source === 'now' ? undefined : setTimeout(() => {
      if (stopped || said) return;
      stopped = true; // не успел — замена; синтез, если ещё встанет в очередь, не начнётся
      markSynth();
      cur = swap(line) ?? silent.speak(text);
      cur.done.then(finish, finish);
    }, d.liveStartMs ?? 4000);
    const onUnsaid = () => {
      if (!said && !stopped) {
        clearTimeout(timer);
        stopped = true;
        markSynth();
        cur = swap(line) ?? silent.speak(text);
        cur.done.then(finish, finish);
      }
    };
    void turn.then(onUnsaid, onUnsaid);
    return {
      done: done.finally(() => { if (timer) clearTimeout(timer); }),
      stop: () => {
        stopped = true;
        controller.abort();
        if (timer) clearTimeout(timer);
        (said as ReturnType<LiveVoice['say']> | null)?.stop();
        cur?.stop();
        markSynth();
        finish();
      },
      synth,
    };
  };
  return {
    speak(text, line) {
      const recording = line?.scene === 'result' && line.voice ? d.debriefClip?.(text, line.voice) : null;
      // Готовый голос командующего имеет приоритет перед живым синтезом.
      const h = recording ? d.player.play([recording], [0]) : line?.prerecordOnly ? silent.speak(text, line)
        : line?.scene === 'intro' ? intro(text, line) : line?.voice && liveAvailable()
        ? live(text, line)
        : line?.source === 'now'
          ? (d.aiOn() && liveAvailable() ? live(text, line) : swap(line) ?? fromClips(text, line.parts) ?? silent.speak(text))
          : fromClips(text, line?.parts) ?? silent.speak(text);
      const gap = line?.gapMs ?? 0;
      if (!gap) return h;
      let wait: Handle | null = null, stopped = false, paused = false;
      let finish = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
        void h.done.then(async () => {
          if (stopped) return;
          wait = silent.speak('', { ...line!, durationMs: gap });
          if (paused) wait.pause?.();
          await wait.done;
          resolve();
        }, resolve);
      });
      return {
        done, played: h.played, synth: h.synth,
        stop() { stopped = true; h.stop(); wait?.stop(); finish(); },
        pause() { paused = true; h.pause?.(); wait?.pause?.(); },
        resume() { paused = false; h.resume?.(); wait?.resume?.(); },
      };
    },
  };
}

/** Живой голос через голосовой сервис системы (`VoiceClient`, роль начальника штаба). */
export function liveVoice(client: VoiceClient, profile: Pick<ReturnType<typeof expoVoiceProfile>, 'ready'>): LiveVoice & { dispose(): void } {
  const waits = new Map<number, { synth: () => void; played: () => void }>();
  const settle = () => {
    for (const w of waits.values()) { w.synth(); w.played(); }
    waits.clear();
  };
  const offs = [
    client.onStatus((status) => { if (status !== 'ready') settle(); }),
    client.onPlayed((id) => {
      const w = waits.get(id);
      // При say-done без PCM клиент вызывает played синхронно, раньше обработчика say-done ниже.
      // Конец воспроизведения подтверждает и завершение синтеза — очередь не должна зависнуть.
      w?.synth();
      w?.played();
      waits.delete(id);
    }),
    client.on('say-done', (m) => {
      const w = waits.get(m.id);
      w?.synth();
      // остановка без звука не должна держать очередь разбора: следующая фраза всё равно произносится
      if (m.stopped) { w?.played(); waits.delete(m.id); }
    }),
    client.on('barge', (m) => {
      const w = waits.get(m.id);
      w?.synth();
      w?.played();
      waits.delete(m.id);
    }),
  ];
  return {
    dispose: () => { offs.forEach((f) => f()); settle(); },
    available: () => client.status === 'ready',
    ready: () => client.status === 'ready' && profile.ready(),
    say(text, voiceId, temperature, cpuThreads) {
      const id = client.newSayId();
      let synth = () => {};
      let played = () => {};
      const synthDone = new Promise<void>((r) => (synth = r));
      // Окончание приходит от проигрывателя, остановки или разрыва связи, а не от таймера синтеза.
      const done = new Promise<void>((r) => { played = r; });
      waits.set(id, { synth, played });
      client.resume();
      if (cpuThreads !== undefined) client.say(id, 'chief', text, undefined, voiceId, temperature, cpuThreads);
      else if (temperature === undefined) client.say(id, 'chief', text, undefined, voiceId);
      else client.say(id, 'chief', text, undefined, voiceId, temperature);
      return { synthDone, done, stop: () => { client.stop(id); waits.delete(id); synth(); played(); } };
    },
  };
}

export type SynthesisOptions = { temperature: number; batchSize: 1 | 2 | 4; cpuThreads?: 1 | 2 | 4 | 8 };
export type VoiceProgress = { done: number; total: number; stage: 'load' | 'warm' | 'synthesis' };
export function expoSpeaker(o: { aiOn: () => boolean; gate: Turnstile; synthesis?: () => SynthesisOptions; onSwap?: (l: Line) => void; onManaged?: (managed: boolean) => void; beforePrepare?: (voiceId: string, signal?: AbortSignal, progress?: (stage: 'load' | 'warm') => void) => Promise<void> }): {
  speaker: Speaker;
  /** Громкость голоса (0–1): предзапись и живой голос, сразу. */
  setVolume(v: number): void;
  /** Заготовка озвучена заранее. */
  voiced(f: { text: string; parts?: string[] }): boolean;
  /** Длительность имеющегося клипа/склейки с паузами, мс; нет записи — null. */
  duration(f: { text: string; parts?: string[] }): number | null;
  /** Синтез фраз голосом `voiceId` после прокрутки, на экране «Готовим итог»: `say` того же текста сыграет готовое. */
  prepare(texts: string[], voiceId: string, signal?: AbortSignal, onProgress?: (p: VoiceProgress) => void): Promise<void>;
  managed(): boolean;
  resume(): void;
  /** Одна реплика с микрофона голосового сервиса; нет речи — null. */
  listen(): Promise<string | null>;
  /** Второе нажатие: отдать сказанное с начала записи и закрыть микрофон. */
  stopListen(): void;
  /** Идёт запись с кнопки. */
  listening(): boolean;
  /** Тот же клиент, что слушает «Говорить»: выбор микрофона. */
  input: VoiceClient;
  /** Оборвать уже звучащее: окно скрыто или закрыто. */
  silence(): void;
  dispose(): void;
} {
  const client = new VoiceClient();
  const profile = expoVoiceProfile(client);
  let managed = false;
  const prepared = new Set<string>();
  const synthesis = (): SynthesisOptions => ({ cpuThreads: 2, ...(o.synthesis?.() ?? { temperature: 0.2, batchSize: 4 }) });
  const preparedKey = (text: string, voiceId: string | undefined, temperature: number) => JSON.stringify([text, voiceId ?? '', temperature]);
  const updateManaged = (value?: boolean) => { if (value === undefined) return; managed = value; o.onManaged?.(value); };
  const offManaged = [
    client.on('ready', (m) => { prepared.clear(); updateManaged(m.tts?.managed ?? false); }),
    client.on('tts_list', (m) => {
      updateManaged(m.managed);
      if (m.resident === false || m.state !== 'ready' || m.error) prepared.clear();
    }),
    client.onStatus((status) => { if (status !== 'ready') prepared.clear(); }),
  ];
  const voiceSettings = () => ({ ...DEFAULT_SETTINGS, ...parseSettings(typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY)) });
  void client.refreshApi();
  client.connect(voiceSettings());
  let heard = '';
  let recording: Promise<string | null> | null = null;
  let endRecording: (() => void) | null = null;
  client.on('utterance', (m) => { heard = m.text.trim(); });
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let volume = 1;
  // 24 кГц — частота синтеза: буферы вдвое меньше, чем на 48 кГц
  const audio = () => {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'playback', sampleRate: 24000 });
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
    }
    return ctx;
  };
  const player = clipPlayer(audio, loadClip, 420, () => (audio(), gain));
  let manifest: VoiceManifest | null = null;
  let debriefVoices: DebriefVoices | null = null;
  let disposed = false;
  const debriefManifestReady = loadDebriefManifest().then((m) => { if (!disposed) debriefVoices = m; });
  const findDebriefClip = (text: string, voiceId: string) => debriefClip(debriefVoices, text, voiceId);
  void loadManifest().then((m) => {
    if (disposed) return;
    manifest = m;
    setPrerecord(m ? 'ready' : 'missing');
    setVoiceGaps(m ? missingClips(m, stageDomains(MAP.days[0], BANK.end)) : []);
    if (m) void player.preload(Object.values(m.clips));
  });
  const live = liveVoice(client, profile);
  const speaker = stageSpeaker({
    manifest: () => manifest, debriefClip: findDebriefClip, player, aiOn: o.aiOn, live, gate: o.gate, onSwap: o.onSwap,
    prepare: async (text, voiceId, signal) => {
      const { temperature, cpuThreads } = synthesis();
      signal?.throwIfAborted();
      if (prepared.has(preparedKey(text, voiceId, temperature))) return { temperature, cpuThreads };
      await profile.wait(signal);
      if (managed) await o.beforePrepare?.(voiceId ?? '', signal);
      if (!await client.prepare('chief', text, voiceId, signal, temperature, cpuThreads)) throw new Error('Не удалось подготовить озвучку');
      return { temperature, cpuThreads };
    },
  });
  const silence = () => {
    player.stopAll();
    client.stop();
    void ctx?.suspend();
  };
  const onHide = () => { if (document.visibilityState === 'hidden') silence(); };
  window.addEventListener('pagehide', silence);
  document.addEventListener('visibilitychange', onHide);
  document.addEventListener('freeze', silence);
  return {
    speaker,
    voiced: (f) => clipPlan(manifest, f.text, f.parts) !== null,
    duration: (f) => {
      const plan = clipPlan(manifest, f.text, f.parts);
      if (!plan) return null;
      const parts = plan.length > 1 && f.parts ? f.parts : [f.text];
      return plan.reduce((sum, clip, i) => sum + clip.ms + (i < plan.length - 1 ? joinGap(parts[i]) * 1000 : 0), 0);
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (gain && ctx) gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
      client.setVolume(volume);
    },
    managed: () => managed,
    async prepare(texts, voiceId, signal, onProgress) {
      const options = synthesis();
      await debriefManifestReady;
      signal?.throwIfAborted();
      if (disposed) throw new Error('Озвучка закрыта');
      const missing = texts.filter((text) => !findDebriefClip(text, voiceId));
      const recorded = texts.length - missing.length;
      if (!missing.length) {
        onProgress?.({ done: recorded, total: texts.length, stage: 'synthesis' });
        return;
      }
      const said = missing.map(expoSpeechText);
      // Вся группа занимает очередь один раз: LLM не получает GPU между пакетами.
      await o.gate.run(async () => {
        if (disposed) throw new Error('Озвучка закрыта');
        signal?.throwIfAborted();
        prepared.clear();
        let done = recorded;
        const report = (stage: VoiceProgress['stage']) => onProgress?.({ done, total: texts.length, stage });
        report('load');
        await profile.wait(signal);
        if (managed) await o.beforePrepare?.(voiceId, signal, report);
        if (disposed) throw new Error('Озвучка закрыта');
        signal?.throwIfAborted();
        report('synthesis');
        const ok = await client.prepareBatch('chief', said, voiceId, signal, {
          ...options,
          onProgress: (ready) => { done = recorded + ready; report('synthesis'); },
        });
        if (!ok) throw new Error('Не удалось подготовить озвучку');
        signal?.throwIfAborted();
        if (disposed) throw new Error('Озвучка закрыта');
        for (const text of said) prepared.add(preparedKey(text, voiceId, options.temperature));
      });
    },
    resume: () => { client.resume(); void ctx?.resume(); },
    /** Запись с нажатия до повторного нажатия. В вопрос — только эта речь, без склейки с тем, что было раньше. */
    listen(): Promise<string | null> {
      if (recording) return recording;
      const before = heard;
      const mine = new Set<number>();
      let acc = '';
      recording = new Promise((resolve) => {
        if (disposed) { resolve(null); return; }
        let settled = false;
        let quiet = 0;
        const fresh = (text: string) => (before && (text === before || text.startsWith(`${before} `)) ? text.slice(before.length).trim() : text);
        const offSpeech = client.on('speech', (m) => { if (m.state === 'start') window.clearTimeout(quiet); });
        const off = client.on('utterance', (m) => {
          const text = m.text.trim();
          if (!text) return;
          const part = fresh(text);
          if (m.continues != null && mine.has(m.continues)) acc = part;
          else if (part) acc = acc ? `${acc} ${part}` : part;
          mine.add(m.id);
          // договорил и замолчал — кнопка отжимается сама; новая речь в эту паузу запись не закрывает
          window.clearTimeout(quiet);
          if (acc) quiet = window.setTimeout(() => endRecording?.(), 1500);
        });
        const finish = (text: string | null) => {
          if (settled) return;
          settled = true;
          recording = null;
          window.clearTimeout(quiet);
          off();
          offSpeech();
          void client.setEnabled(false);
          resolve(text);
        };
        endRecording = () => {
          window.clearTimeout(quiet);
          void client.setEnabled(false);
          window.setTimeout(() => finish(acc.trim() || null), 500);
        };
        void client.setEnabled(true).then(() => client.start(voiceSettings())).catch(() => finish(null));
      });
      return recording;
    },
    stopListen() { endRecording?.(); },
    listening: () => recording !== null,
    input: client,
    silence,
    dispose: () => {
      disposed = true;
      window.removeEventListener('pagehide', silence);
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('freeze', silence);
      silence();
      live.dispose();
      offManaged.forEach((f) => f());
      profile.dispose();
      client.close();
      void ctx?.close();
    },
  };
}
