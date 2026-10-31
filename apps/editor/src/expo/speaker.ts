/**
 * Чем говорит стенд. Заготовленные фразы — всегда из предзаписи (`prerecord.ts`): клипы заранее декодированы, куски
 * склейки ставятся в звук встык через WebAudio, с паузой по знаку. Живой голос (голосовой сервис системы, голос
 * начальника штаба) — только для текста, составленного ИИ сейчас, и только в режиме «С ИИ»; сервиса нет или он не
 * успевает начать — звучит заготовка на замену из предзаписи. Синтез речи окна не берём никогда: чужой голос на стенде
 * хуже тишины. Тишина с субтитрами — только для фразы без предзаписи (предзапись не подготовлена).
 */
import { VoiceClient } from '../voice/client';
import { speakable } from '../voice/speech';
import { setPrerecord } from './health';
import { clipPlan, joinGap, loadClip, loadManifest, type Clip, type VoiceManifest } from './prerecord';
import type { Line, Speaker } from './voice-queue';

/** Сколько читать фразу вслух, мс. */
export const readMs = (text: string) => 1500 + text.length * 65;

type Handle = ReturnType<Speaker['speak']>;

export function silentSpeaker(): Speaker {
  return {
    speak(text) {
      let t: ReturnType<typeof setTimeout>;
      let finish = () => {};
      const done = new Promise<void>((r) => { finish = r; t = setTimeout(r, readMs(text)); });
      return { done, stop: () => { clearTimeout(t); finish(); } };
    },
  };
}

/** Звук, нужный проигрывателю клипов (AudioContext или его подмена в проверках). */
export interface ClipAudio {
  currentTime: number;
  destination: unknown;
  decodeAudioData(b: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  state?: string;
  resume?(): Promise<void>;
}

/**
 * Проигрыватель предзаписи: клипы декодируются заранее (`preload`, в пределах `budgetS` секунд звука — память),
 * фраза ставится в звук, когда готовы буферы всех её кусков, — встык, без зазоров. Буфера нет (вытеснен или не дошёл)
 * — он декодируется тут же (миллисекунды); давно не звучавшие вытесняются сверх бюджета.
 */
export function clipPlayer(audio: () => ClipAudio, load: (file: string) => Promise<ArrayBuffer> = loadClip, budgetS = 420) {
  const bufs = new Map<string, Promise<AudioBuffer>>();
  const secs = new Map<string, number>();
  let total = 0;
  const evict = () => {
    for (const [f, s] of secs) {
      if (total <= budgetS) break;
      secs.delete(f);
      bufs.delete(f);
      total -= s;
    }
  };
  const buffer = (file: string) => {
    let b = bufs.get(file);
    if (b) {
      bufs.delete(file);
      bufs.set(file, b);
      const s = secs.get(file);
      if (s !== undefined) { secs.delete(file); secs.set(file, s); }
      return b;
    }
    b = load(file).then((x) => audio().decodeAudioData(x));
    b.then((x) => { if (bufs.get(file) === b) { secs.set(file, x.duration); total += x.duration; evict(); } }, () => bufs.delete(file));
    bufs.set(file, b);
    return b;
  };
  return {
    /** Декодировать клипы заранее, по одному (окно не замирает), пока хватает бюджета. */
    async preload(clips: Clip[]) {
      let planned = 0;
      for (const c of clips) {
        if ((planned += c.ms / 1000) > budgetS) break;
        await buffer(c.file).catch(() => null);
      }
    },
    /** Сыграть клипы встык; `gaps[i]` — пауза после i-го, с. */
    play(clips: Clip[], gaps: number[]): Handle {
      const srcs: AudioBufferSourceNode[] = [];
      let stopped = false;
      let safety: ReturnType<typeof setTimeout> | undefined;
      let finish = () => {};
      const done = new Promise<void>((r) => (finish = r)).finally(() => clearTimeout(safety));
      void Promise.all(clips.map((c) => buffer(c.file))).then(
        (bs) => {
          if (stopped) return;
          const a = audio();
          if (a.state === 'suspended') void a.resume?.();
          let t = a.currentTime + 0.02;
          bs.forEach((b, i) => {
            const s = a.createBufferSource();
            s.buffer = b;
            s.connect(a.destination as AudioNode);
            s.start(t);
            t += b.duration + (i < bs.length - 1 ? gaps[i] ?? 0 : 0);
            srcs.push(s);
          });
          srcs[srcs.length - 1].onended = () => finish();
          // звук не пошёл (окно ещё не разрешило звук) — очередь всё равно не встаёт
          safety = setTimeout(finish, (t - a.currentTime) * 1000 + 1500);
        },
        () => finish(),
      );
      return {
        done,
        stop: () => {
          stopped = true;
          for (const s of srcs) {
            s.onended = null;
            try { s.stop(); } catch { /* уже кончился */ }
          }
          finish();
        },
      };
    },
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
  /** Сказать фразу: `synthDone` — сервис договорил (синтез свободен), `done` — окно доиграло. */
  say(text: string): { synthDone: Promise<void>; done: Promise<void>; stop(): void };
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
}

/** Речь стенда по правилам выше (без загрузки — её делает `expoSpeaker`). */
export function stageSpeaker(d: SpeakerDeps): Speaker {
  const silent = silentSpeaker();
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
  const live = (text: string, line: Line): Handle => {
    let cur: Handle | null = null;
    let stopped = false;
    let finish = () => {};
    const done = new Promise<void>((r) => (finish = r));
    const lv = d.live!;
    let said: ReturnType<LiveVoice['say']> | null = null;
    let release = () => {};
    const turn = d.gate.run(() => {
      if (stopped || !lv.ready()) return Promise.resolve();
      said = lv.say(speakable(text, { full: true }));
      said.done.then(finish, finish);
      return new Promise<void>((r) => { release = r; said!.synthDone.then(r, r); });
    });
    const timer = setTimeout(() => {
      if (stopped || said) return;
      stopped = true; // не успел — замена; синтез, если ещё встанет в очередь, не начнётся
      cur = swap(line) ?? silent.speak(text);
      cur.done.then(finish, finish);
    }, d.liveStartMs ?? 4000);
    void turn.then(() => {
      if (!said && !stopped) {
        clearTimeout(timer);
        stopped = true;
        cur = swap(line) ?? silent.speak(text);
        cur.done.then(finish, finish);
      }
    });
    return {
      done: done.finally(() => clearTimeout(timer)),
      stop: () => {
        stopped = true;
        clearTimeout(timer);
        (said as ReturnType<LiveVoice['say']> | null)?.stop();
        release();
        cur?.stop();
        finish();
      },
    };
  };
  return {
    speak(text, line) {
      if (line?.source === 'now') {
        if (d.aiOn() && d.live?.ready()) return live(text, line);
        return swap(line) ?? fromClips(text, line.parts) ?? silent.speak(text);
      }
      return fromClips(text, line?.parts) ?? silent.speak(text);
    },
  };
}

/** Живой голос через голосовой сервис системы (`VoiceClient`, роль начальника штаба). */
function liveVoice(client: VoiceClient): LiveVoice & { dispose(): void } {
  const waits = new Map<number, { synth: () => void; played: () => void }>();
  const offs = [
    client.onPlayed((id) => { waits.get(id)?.played(); waits.delete(id); }),
    client.on('say-done', (m) => waits.get(m.id)?.synth()),
  ];
  return {
    dispose: () => offs.forEach((f) => f()),
    ready: () => client.status === 'ready',
    say(text) {
      const id = client.newSayId();
      let synth = () => {};
      let played = () => {};
      const synthDone = new Promise<void>((r) => (synth = r));
      const done = new Promise<void>((r) => {
        played = r;
        // сервис не доложил о конце — очередь не встаёт
        setTimeout(() => { synth(); r(); }, readMs(text) * 2 + 5000);
      });
      waits.set(id, { synth, played });
      client.say(id, 'chief', text);
      return { synthDone, done, stop: () => { client.stop(id); waits.delete(id); synth(); played(); } };
    },
  };
}

export function expoSpeaker(o: { aiOn: () => boolean; gate: Turnstile; onSwap?: (l: Line) => void }): {
  speaker: Speaker;
  /** Заготовка озвучена заранее. */
  voiced(f: { text: string; parts?: string[] }): boolean;
  resume(): void;
  dispose(): void;
} {
  const client = new VoiceClient();
  void client.refreshApi();
  client.connect();
  let ctx: AudioContext | null = null;
  // 24 кГц — частота синтеза: буферы вдвое меньше, чем на 48 кГц
  const audio = () => (ctx ??= new AudioContext({ latencyHint: 'playback', sampleRate: 24000 }));
  const player = clipPlayer(audio);
  let manifest: VoiceManifest | null = null;
  let disposed = false;
  void loadManifest().then((m) => {
    if (disposed) return;
    manifest = m;
    setPrerecord(m ? 'ready' : 'missing');
    if (m) void player.preload(Object.values(m.clips));
  });
  const live = liveVoice(client);
  const speaker = stageSpeaker({ manifest: () => manifest, player, aiOn: o.aiOn, live, gate: o.gate, onSwap: o.onSwap });
  return {
    speaker,
    voiced: (f) => clipPlan(manifest, f.text, f.parts) !== null,
    resume: () => { client.resume(); void ctx?.resume(); },
    dispose: () => { disposed = true; live.dispose(); client.close(); void ctx?.close(); },
  };
}
