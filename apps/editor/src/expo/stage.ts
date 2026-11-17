/**
 * Голос и ИИ главного окна в сборе: речь (`expoSpeaker`), очередь голоса, карточки ИИ, исполнитель эффектов
 * (`aiRunner`). «С ИИ» — модель LM Studio через `/llm/v1` (как в полном режиме), пока рабочий режим стенда — «С ИИ»;
 * иначе всё — из заготовок. Заготовки звучат из предзаписи; модель и живой синтез работают по очереди (`turnstile`).
 * Фонового рассказа нет: голос — только о сцене на экране и в ответ посетителю (`voiceQueue`). Договорён пункт брифинга —
 * режиссёру `briefDone` (следующий пункт). На заставке голос говорит по кругу, с паузой между фразами
 * (`attractCall` в настройках — значение по умолчанию и длина паузы), только пока окно перед посетителем;
 * закрытие, сворачивание и уход с окна обрывают фразу. Кнопка на заставке глушит круг до перезапуска.
 */
import { loadLlm } from '../shared';
import { cardSmith, COMMENT_QUERY, COMMENT_TOKENS, draftReply, staffAnswer, staffParts, type Ask } from './ai';
import { aiRunner, type AiFrame } from './ai-runner';
import { BANK, cardErrors, placeTitle } from './bank';
import type { DirectorState, Effect } from './director';
import { MATCH_WORDS } from './prerecord';
import type { ModelHooks, ModelFrame } from './model';
import { EXPO_DEFAULTS, type ExpoSettings } from './settings';
import { debriefUtterances, operationDebrief } from './debrief';
import { dayMonth } from './score';
import type { StatKind } from './stats';
import { expoSpeaker, silentSpeaker, turnstile, type SynthesisOptions } from './speaker';
import { attractLoopDue, attractShown, voiceQueue } from './voice-queue';
import { FRONT_NAMES } from './scenes';
import { INTRO_KEYS } from './intro-story';
import { GpuHandoff } from './gpu-handoff';

/** Пауза после фразы пункта брифинга до следующего пункта, мс. */
const BRIEF_GAP_MS = 1200;
const MUTED_COMMENT_READ_MS = 3500;

export interface StageDeps {
  aiOn: () => boolean;
  /** Настройки — громкость голоса (меню оператора, вкладка «Звук»); нет — полная громкость. */
  snapshot: () => { state: DirectorState; model: ModelFrame; settings?: Pick<ExpoSettings, 'volume'> & Partial<Pick<ExpoSettings, 'attractCall' | 'generation'>> };
  dispatch: Parameters<typeof aiRunner>[0]['dispatch'];
  onFrame: (f: AiFrame) => void;
  count: (k: StatKind) => void;
}

export function createStage(d: StageDeps) {
  const commentsOn = () => d.snapshot().settings?.generation?.comments !== false;
  const debriefOn = () => {
    const snap = d.snapshot();
    return (snap.state.phase.kind === 'result' ? snap.state.phase.narrated : undefined) ?? snap.settings?.generation?.debrief ?? true;
  };
  let commentVoiced = true;
  let commentSynthesis: SynthesisOptions | null = null;
  let debriefSynthesis: { session: number; options: SynthesisOptions; voiced: boolean } | null = null;
  const synthesis = (): SynthesisOptions => {
    const snap = d.snapshot();
    const phase = snap.state.phase;
    if (debriefSynthesis?.session === snap.state.session && (phase.kind === 'result' || (phase.kind === 'turn' && phase.preparing)))
      return { ...debriefSynthesis.options };
    if (commentSynthesis && phase.kind === 'turn' && phase.commenting) return { ...commentSynthesis };
    const generation = snap.settings?.generation;
    return { temperature: generation?.temperature ?? EXPO_DEFAULTS.generation.temperature, batchSize: generation?.batchSize ?? EXPO_DEFAULTS.generation.batchSize, cpuThreads: generation?.cpuThreads ?? EXPO_DEFAULTS.generation.cpuThreads };
  };
  const gate = turnstile();
  // запрос модели, начатый до хода карты, обрывается на входе в прокрутку: иначе поток читает ответ, пока армии идут
  let llmGen = 0;
  const requests = new Set<AbortController>();
  let debriefJob: AbortController | null = null;
  let sceneVersion = 0;
  let commentJob: Extract<Effect, { e: 'commentChoice' }> | null = null;
  const cancelWork = () => {
    llmGen++;
    for (const request of requests) request.abort();
    debriefJob?.abort();
    debriefJob = null;
    commentJob = null;
    commentSynthesis = null;
  };
  let gpu: GpuHandoff;
  const llmAsk: Ask = (system, text, signal, onText) => {
    // Захватываем поколение ДО ожидания очереди: запрос прежней сцены не должен стартовать после карты.
    const gen = llmGen;
    const stop = new AbortController();
    requests.add(stop);
    return gate.run(async () => {
    if (gen !== llmGen || stop.signal.aborted) throw new Error('сцена сменилась');
    if (signal.aborted) throw signal.reason ?? new Error('отменено');
    // Выставочный режим использует основной выбор раздела «ИИ».
    // Голосовой override полной версии не меняет языковую модель стенда.
    const phase = d.snapshot().state.phase;
    if (voice.managed?.() && phase.kind === 'turn' && phase.step === 'scroll' && !phase.commenting) throw new Error('Дождитесь окончания карты');
    const selectedModel = loadLlm().model.trim();
    await gpu.llm(AbortSignal.any([signal, stop.signal]));
    if (gen !== llmGen || stop.signal.aborted) throw new Error('сцена сменилась');
    const s = loadLlm();
    if (voice.managed?.() && s.model.trim() !== selectedModel) throw new Error('Выбор языковой модели изменился');
    const model = voice.managed?.() ? (gpu.chatModel() ?? s.model.trim()) : s.model.trim();
    if (!model) throw new Error('Выберите языковую модель в разделе «ИИ» основного приложения');
    const commenting = text.endsWith(COMMENT_QUERY);
    const thinking = commenting ? 'off' : s.voiceThinking ?? 'off';
    const url = new URL('/llm/v1/chat/completions', location.origin).href;
    const linked = AbortSignal.any([signal, stop.signal]);
    const card = text.includes('"orders"');
    const r = await fetch.bind(globalThis)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-defops-llm-model': encodeURIComponent(model || ''), 'x-defops-llm-role': 'expo-voice' },
      signal: linked,
      body: JSON.stringify({
        model,
        // Стенд работает весь день: JIT-модель не выгружается по короткому Idle TTL LM Studio.
        ttl: 86400,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        temperature: 0.6, top_p: 0.8, max_tokens: commenting ? COMMENT_TOKENS : thinking === 'off' ? 500 : 900, stream: true,
        reasoning_effort: thinking === 'off' ? 'none' : thinking,
      }),
    });
    if (!r.ok || !r.body) throw new Error(`сервер модели ответил ${r.status}`);
    let content = '', reasoning = '', buf = '';
    let halt = false, tokenLimit = false;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const stopNow = () => { halt = true; stop.abort(); void reader.cancel().catch(() => {}); };
    // Прогресс вопроса можно показывать сразу; точка в первом предложении не завершает запрос.
    const watch = () => {
      if (card) return;
      const main = staffParts(content);
      const alt = staffParts(reasoning);
      const quote = draftReply(reasoning);
      const live = main.live || quote || alt.live;
      if (live) onText?.(live);
    };
    try {
      while (!halt) {
        if (gen !== llmGen) { stopNow(); break; }
        const chunk = await reader.read();
        if (chunk.done || halt || gen !== llmGen) break;
        buf += dec.decode(chunk.value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const payload = line.startsWith('data:') ? line.slice(5).trim() : '';
          if (payload === '[DONE]') { halt = true; break; }
          if (!payload) continue;
          let j: { choices?: { finish_reason?: string; delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[] };
          try { j = JSON.parse(payload); } catch { continue; }
          const choice = j.choices?.[0];
          if (choice?.finish_reason === 'length') tokenLimit = true;
          const d = choice?.delta;
          if (!d) continue;
          if (d.content) content += d.content;
          const rs = d.reasoning_content ?? d.reasoning;
          if (rs) reasoning += rs;
          watch();
          if (halt) break;
        }
      }
    } finally {
      // [DONE] завершает ответ и при ещё открытом HTTP-потоке.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const say = staffAnswer(content) || draftReply(reasoning) || staffAnswer(reasoning);
    if (say) return say;
    if (commenting) {
      const text = staffParts(content).live;
      // Лимит токенов может остановить первое предложение: не передаём TTS половину последнего слова.
      if (text) return tokenLimit ? `${text.replace(/\s+\S*$/, '')}…` : text;
    }
    const raw = (content || reasoning).trim();
    if (card && raw.includes('{')) return raw;
    throw new Error('пустой ответ');
    }).finally(() => { requests.delete(stop); });
  };
  const voice = expoSpeaker({ aiOn: d.aiOn, gate, synthesis, onSwap: (l) => runner?.onLine(l), onManaged: (managed) => d.dispatch({ t: 'gpuManaged', managed }), beforePrepare: async (voiceId, signal, progress) => { progress?.('load'); await gpu.tts(voiceId, signal); } });
  gpu = new GpuHandoff({ managed: () => voice.managed?.() === true, model: () => loadLlm().model, resource: (op, voiceId) => voice.input.ttsResource(op, voiceId) });
  const preload = () => { if (commentsOn() && d.aiOn() && voice.managed?.()) void gpu.llm().catch((e) => console.warn('Подготовка модели:', e)); };
  /** Фразы заставки по кругу. Рассказ об операции — несколько фраз подряд, без паузы между ними. */
  const ATTRACT_BEATS = [
    ['attract-call'],
    ['attract-berlin-1', 'attract-berlin-2', 'attract-berlin-3', 'attract-berlin-4', 'attract-berlin-5', 'attract-berlin-6', 'attract-berlin-7', 'attract-berlin-8', 'attract-berlin-9'],
    ['attract-stand'],
    ['attract-ai'],
    ['attract-app'],
  ];
  let attractOn = false;
  let attractI = 0;
  let quietSince: number | null = null;
  let volume: number | null = null;
  const ask = () => llmAsk;
  const askCards = () => (d.aiOn() ? llmAsk : null);
  const facts = () => {
    const { state, model } = d.snapshot();
    const v = model.view;
    const f = state.front ? BANK.fronts[state.front] : null;
    const p = state.phase;
    const turn = f && p.kind === 'turn' ? f.turns.find((t) => t.n === p.n) : undefined;
    const last = v?.decisions.at(-1);
    const aim = last?.choice.startsWith('aim:') ? placeTitle(last.choice.slice(4)) : '';
    const picked = aim ? `удар на ${aim}` : last && last.choice !== 'delay' ? (v?.cards.find((c) => c.id === last.choice)?.title ?? BANK.cards.find((c) => c.id === last.choice)?.title) : undefined;
    const vars = {
      front: state.front ? FRONT_NAMES[state.front] : undefined,
      marshal: f?.marshal,
      turn: turn?.title,
      date: v ? dayMonth(v.time) : undefined,
      title: picked,
      rank: v?.final?.rank,
      matches: v?.final ? MATCH_WORDS[v.final.matches] : undefined,
      event: v?.feed.at(-1)?.match(/ — (.+?) \(/)?.[1],
    };
    const text = [
      vars.front && `Фронт: ${vars.front}, командующий — маршал ${vars.marshal}.`,
      turn && `Перелом: ${turn.title}. ${turn.situation}`,
      v && `Время хода: ${vars.date}.`,
      v?.cards.length && `Варианты на экране: ${v.cards.map((c) => `«${c.title}»`).join(', ')}.`,
      aim && `Посетитель выбрал собственное направление: удар на ${aim}. Это не исторический вариант и не карточка с экрана.`,
      !aim && picked && `Посетитель выбрал: «${picked}».`,
      v?.reveal && (aim
        ? `На экране: ${v.reveal.text}. Историческое решение этого перелома было другим — «${v.reveal.historical.title}»; его не выбирали.`
        : `${v.reveal.text}; исторический вариант — «${v.reveal.historical.title}».`),
      v?.feed.length && `Последние события хода: ${v.feed.slice(-3).join('; ')}.`,
      v && `Оценка: скорость — ${v.scales.notes.speed}; цена — ${v.scales.notes.cost}; замысел — ${v.scales.notes.intent}.`,
    ].filter(Boolean).join('\n');
    return { text, vars };
  };
  let runner: ReturnType<typeof aiRunner> | null = null;
  let resultSpeaking = false;
  const silent = silentSpeaker();
  const queue = voiceQueue({ speak(text, line) {
    const snap = d.snapshot();
    const mutedComment = commentJob && line?.scene === `turn-${commentJob.n}-scroll` && !commentVoiced;
    if (mutedComment) return silent.speak(text, { ...line, durationMs: MUTED_COMMENT_READ_MS });
    const debriefRecordedOnly = line?.scene === 'result' && !(debriefSynthesis?.session === snap.state.session ? debriefSynthesis.voiced : snap.settings?.generation?.debriefVoice !== false);
    return voice.speaker.speak(text, debriefRecordedOnly ? { ...line, prerecordOnly: true } : line);
  } }, {
    onLine: (l) => {
      runner?.onLine(l);
      if (l?.scene === 'intro') {
        const index = l.mark ? INTRO_KEYS.indexOf(l.mark) : -1;
        d.dispatch({ t: 'introVoice', playing: true, ...(index < 0 ? {} : { line: index + 1 }) });
      }
      if (l?.scene === 'result') {
        resultSpeaking = true;
        d.dispatch({ t: 'hold', ms: 240_000 });
      } else if (!l && resultSpeaking) {
        resultSpeaking = false;
        d.dispatch({ t: 'spoken' });
      }
    },
    onDone: (l) => {
      const m = l.scene?.match(/^briefing-(\d+)$/);
      // пауза между пунктами доклада — чтобы цифры на экране успели прочитать
      if (m) setTimeout(() => d.dispatch({ t: 'briefDone', point: Number(m[1]) }), BRIEF_GAP_MS);
      if (l.scene === 'intro' && l.mark === INTRO_KEYS.at(-1)) d.dispatch({ t: 'introDone' });
    },
  });
  runner = aiRunner({
    queue, ask, facts, dispatch: d.dispatch, onFrame: d.onFrame,
    count: (k) => d.count(k),
    voiced: voice.voiced,
    duration: voice.duration,
    now: () => d.snapshot().state.now,
    debrief: () => {
      if (!debriefOn()) return null;
      const v = d.snapshot().model.view;
      const brief = v ? operationDebrief(v) : null;
      if (brief) d.dispatch({ t: 'hold', ms: 240_000 });
      return brief;
    },
    listen: () => (d.aiOn() ? voice.listen() : Promise.resolve(null)),
    stopListen: () => voice.stopListen(),
  });
  const smith = cardSmith({
    ask: askCards,
    check: (card, c) => cardErrors(card, new Set(c.armies), new Set(c.places)),
    perCardMs: 30_000,
    wait: 6_000,
  });
  const hooks: ModelHooks = {
    smith,
    want: 4,
    decided: () => {},
  };
  /** Окно перед посетителем. В проверках без страницы круг не отключается. */
  const pageShown = () => typeof document === 'undefined' || attractShown({
    hidden: document.hidden,
    focused: typeof document.hasFocus !== 'function' || document.hasFocus(),
  });
  /** Круг заставки обрывается сразу: фраза не договаривается и следующая не встаёт в очередь. */
  const stopAttract = () => {
    if (attractOn) {
      queue.clear();
      voice.silence();
      if (d.snapshot().state.phase.kind === 'attract') runner?.handle({ e: 'scene', key: 'attract-quiet' });
    }
    attractOn = false;
    quietSince = null;
    attractI = 0;
  };
  let introPausedAt: number | null = null;
  const introPause = (paused: boolean, at: number) => {
    if (paused && introPausedAt === null) {
      introPausedAt = at;
      queue.pause();
    } else if (!paused && introPausedAt !== null) {
      runner?.shiftIntroClock(Math.max(0, at - introPausedAt));
      introPausedAt = null;
      queue.resume();
    }
  };
  const onBlur = () => { if (d.snapshot().state.phase.kind === 'attract') stopAttract(); };
  const onHide = () => { if (typeof document !== 'undefined' && document.hidden) onBlur(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    // закрытие окна приложения зовёт это до уничтожения страницы: pagehide в окне бывает не успевает
    (window as Window & { __expoHush?: () => void }).__expoHush = () => { queue.clear(); voice.silence(); stopAttract(); };
  }
  return {
    hooks,
    handle(e: Effect) {
      if (e.e === 'introPause') { introPause(e.paused, e.at); return; }
      if (e.e === 'scene' && e.key !== 'intro' && introPausedAt !== null) {
        queue.clear();
        introPause(false, d.snapshot().state.now);
      }
      if (e.e === 'newSession' || (e.e === 'scene' && e.key === 'attract')) debriefSynthesis = null;
      if (e.e === 'scene' || e.e === 'newSession') { sceneVersion++; cancelWork(); }
      if (e.e === 'newSession' || (e.e === 'scene' && e.key === 'attract')) gpu.cancel();
      if (e.e === 'scene' && e.key.endsWith('-choose')) preload();
      if (e.e === 'scene' && e.key.endsWith('-scroll') && voice.managed?.()) {
        const session = d.snapshot().state.session;
        const version = sceneVersion;
        const key = e.key;
        const isCurrent = () => { const state = d.snapshot().state; return sceneVersion === version && state.session === session && state.phase.kind === 'turn' && state.phase.step === 'scroll' && key === `turn-${state.phase.n}-scroll`; };
        d.dispatch({ t: 'gpuWait' });
        void gpu.idle().then(
          () => { if (isCurrent()) d.dispatch({ t: 'gpuReady' }); },
          (error: unknown) => { if (isCurrent()) d.dispatch({ t: 'gpuFailed', error: error instanceof Error ? error.message : String(error) }); },
        );
      }
      if (e.e === 'scene' && e.key === 'intro') {
        const wasAttract = attractOn;
        stopAttract();
        if (!wasAttract) { queue.clear(); voice.silence(); }
        voice.resume();
      }
      if (e.e === 'scene' && e.key.endsWith('-scroll')) { queue.clear(); voice.silence(); }
      if (e.e === 'listen' && !voice.listening()) {
        queue.clear();
        voice.silence();
        d.dispatch({ t: 'timerHold' });
      }
      if (e.e === 'ask' || e.e === 'listen') voice.resume();
      if (e.e === 'commentChoice') {
        const snap = d.snapshot();
        const p = snap.state.phase;
        if (p.kind !== 'turn' || p.step !== 'scroll' || p.n !== e.n || snap.state.session !== e.session || p.commenting?.token !== e.token || commentJob) return;
        if (!commentsOn()) { d.dispatch({ t: 'commentDone', n: e.n, session: e.session, token: e.token }); return; }
        commentSynthesis = synthesis();
        commentVoiced = snap.settings?.generation?.commentVoice !== false;
        commentJob = e;
        voice.resume();
        const last = snap.model.view?.decisions.at(-1);
        const finish = () => {
          const now = d.snapshot().state;
          if (commentJob !== e || now.session !== e.session || now.phase.kind !== 'turn' || now.phase.n !== e.n || now.phase.commenting?.token !== e.token) return;
          commentJob = null;
          commentSynthesis = null;
          if (e.n < 3) preload();
          d.dispatch({ t: 'commentDone', n: e.n, session: e.session, token: e.token });
        };
        const kind = last?.choice === 'delay' ? 'delay' : last?.choice === last?.historical ? 'historical' : 'own';
        // Promise включает ожидание текста, подготовку аудио и фактический конец его воспроизведения.
        void Promise.resolve().then(() => commentJob === e && last?.n === e.n ? runner?.decided(kind, `turn-${e.n}-scroll`) : undefined).then(finish, finish);
        return;
      }
      if (e.e === 'prepareDebrief') {
        const snap = d.snapshot();
        const p = snap.state.phase;
        if (p.kind !== 'turn' || p.n !== 3 || !p.preparing || debriefJob) return;
        if (!debriefOn()) { d.dispatch({ t: 'debriefReady' }); return; }
        debriefSynthesis = { session: snap.state.session, options: synthesis(), voiced: snap.settings?.generation?.debriefVoice !== false };
        if (!debriefSynthesis.voiced) { d.dispatch({ t: 'debriefReady' }); return; }
        const job = new AbortController();
        debriefJob = job;
        const session = snap.state.session;
        const v = snap.model.view;
        const brief = v ? operationDebrief(v) : null;
        const started = snap.state.now;
        const ready = brief ? voice.prepare(debriefUtterances(brief.paragraphs), brief.voice, job.signal, (progress) => {
          if (!job.signal.aborted && debriefJob === job && d.snapshot().state.session === session) d.dispatch({ t: 'debriefProgress', ...progress, started });
        }) : Promise.resolve();
        const finish = () => {
          const now = d.snapshot().state;
          if (job.signal.aborted || debriefJob !== job || now.session !== session) return;
          debriefJob = null;
          if (now.phase.kind === 'turn' && now.phase.preparing) d.dispatch({ t: 'debriefReady' });
        };
        void ready.then(finish, (error: unknown) => {
          if (job.signal.aborted || debriefJob !== job || d.snapshot().state.session !== session) return;
          // Даже при отказе синтеза можно показать весь текст и воспроизвести готовые клипы.
          if (debriefSynthesis?.session === session) debriefSynthesis.voiced = false;
          console.warn('Озвучка итогового разбора:', error);
          finish();
        });
        return;
      }
      if (e.e === 'say' && e.key === 'result' && !debriefOn()) return;
      if (e.e === 'say' || e.e === 'scene' || e.e === 'newSession' || e.e === 'ask' || e.e === 'listen' || e.e === 'deal') runner?.handle(e);
    },
    /** Тик часов: громкость голоса из настроек (смена — сразу); на заставке — круг фраз, если голос включён и окно перед посетителем. */
    tick() {
      const snap = d.snapshot();
      if (snap.state.phase.kind === 'intro') introPause(snap.state.paused, snap.state.pausedAt ?? snap.state.now);
      const v = snap.settings?.volume.voice ?? 1;
      if (v !== volume) voice.setVolume((volume = v));
      const want = snap.state.phase.kind === 'attract' && snap.state.voice;
      if (!want || !pageShown()) {
        stopAttract();
        return;
      }
      if (!attractOn) {
        attractOn = true;
        runner?.handle({ e: 'scene', key: 'attract' });
        quietSince = Date.now();
      }
      if (queue.busy()) { quietSince = null; return; }
      quietSince ??= Date.now();
      const pause = attractI === 0 ? 1_500 : (snap.settings?.attractCall?.pause ?? 8) * 1000;
      if (!attractLoopDue({ now: Date.now(), quietSince, pauseMs: pause, on: true, busy: false })) return;
      const beat = ATTRACT_BEATS[attractI % ATTRACT_BEATS.length];
      attractI += 1;
      quietSince = null;
      for (const key of beat) runner?.handle({ e: 'say', key, priority: 'scene', scene: 'attract' });
    },
    resume: () => { if (!d.snapshot().state.paused) voice.resume(); },
    input: voice.input,
    dispose() {
      sceneVersion++;
      cancelWork();
      gpu.cancel();
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onHide);
        const w = window as Window & { __expoHush?: () => void };
        if (w.__expoHush) delete w.__expoHush;
      }
      queue.clear();
      voice.dispose();
    },
  };
}
