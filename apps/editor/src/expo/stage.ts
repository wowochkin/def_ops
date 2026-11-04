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
import { dictate } from '../voice/standalone';
import { cardSmith, draftReply, staffAnswer, staffParts, type Ask } from './ai';
import { aiRunner, type AiFrame } from './ai-runner';
import { BANK, cardErrors } from './bank';
import type { DirectorState, Effect } from './director';
import { MATCH_WORDS } from './prerecord';
import type { ModelHooks, ModelFrame } from './model';
import type { ExpoSettings } from './settings';
import { operationDebrief } from './debrief';
import { dayMonth } from './score';
import type { StatKind } from './stats';
import { expoSpeaker, turnstile } from './speaker';
import { attractLoopDue, attractShown, voiceQueue } from './voice-queue';
import { FRONT_NAMES } from './scenes';

/** Пауза после фразы пункта брифинга до следующего пункта, мс. */
const BRIEF_GAP_MS = 1200;

export interface StageDeps {
  aiOn: () => boolean;
  /** Настройки — громкость голоса (меню оператора, вкладка «Звук»); нет — полная громкость. */
  snapshot: () => { state: DirectorState; model: ModelFrame; settings?: Pick<ExpoSettings, 'volume'> & Partial<Pick<ExpoSettings, 'attractCall'>> };
  dispatch: Parameters<typeof aiRunner>[0]['dispatch'];
  onFrame: (f: AiFrame) => void;
  count: (k: StatKind) => void;
}

export function createStage(d: StageDeps) {
  const gate = turnstile();
  const llmAsk: Ask = (system, text, signal, onText) => gate.run(async () => {
    if (signal.aborted) throw signal.reason ?? new Error('отменено');
    // Та же модель, что в полной версии для голоса: пусто — основная. Запрос как у голоса (reasoning_effort),
    // без шаблона «размышление», из‑за которого сервер пишет длинный черновик чужой моделью.
    const s = loadLlm();
    const model = s.voiceModel || s.model;
    const thinking = s.voiceThinking ?? 'off';
    const url = new URL('/llm/v1/chat/completions', location.origin).href;
    const stop = new AbortController();
    const linked = AbortSignal.any([signal, stop.signal]);
    const card = text.includes('"orders"');
    const r = await fetch.bind(globalThis)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: linked,
      body: JSON.stringify({
        ...(model ? { model } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        temperature: 0.6, top_p: 0.8, max_tokens: thinking === 'off' ? 500 : 900, stream: true,
        reasoning_effort: thinking === 'off' ? 'none' : thinking,
      }),
    });
    if (!r.ok || !r.body) throw new Error(`сервер модели ответил ${r.status}`);
    let content = '', reasoning = '', picked = '', buf = '';
    let halt = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const stopNow = () => { halt = true; clearTimeout(idle); stop.abort(); void reader.cancel().catch(() => {}); };
    // экран — вместе с недописанным словом; голос — как только предложение закончено, не дожидаясь продолжения
    const watch = () => {
      if (card) return;
      const main = staffParts(content);
      const alt = staffParts(reasoning);
      const quote = draftReply(reasoning);
      const done = main.done || quote || alt.done;
      const live = main.live || quote || alt.live;
      if (live) onText?.(live);
      if (done) picked = done;
      const n = done ? done.split(/(?<=[.!?])\s+/).filter(Boolean).length : 0;
      const growing = (main.live && main.live !== main.done) || (alt.live && alt.live !== alt.done);
      clearTimeout(idle);
      if (n >= 1 && !growing) stopNow();
    };
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done || halt) break;
        buf += dec.decode(chunk.value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const payload = line.startsWith('data:') ? line.slice(5).trim() : '';
          if (!payload || payload === '[DONE]') continue;
          let j: { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[] };
          try { j = JSON.parse(payload); } catch { continue; }
          const d = j.choices?.[0]?.delta;
          if (!d) continue;
          if (d.content) content += d.content;
          const rs = d.reasoning_content ?? d.reasoning;
          if (rs) reasoning += rs;
          watch();
          if (halt) break;
        }
      }
    } catch (e) {
      if (!picked) throw e;
    } finally {
      clearTimeout(idle);
    }
    if (picked) return picked;
    const say = staffAnswer(content) || draftReply(reasoning) || staffAnswer(reasoning);
    if (say) return say;
    const raw = (content || reasoning).trim();
    if (card && raw.includes('{')) return raw;
    throw new Error('пустой ответ');
  });
  const voice = expoSpeaker({ aiOn: d.aiOn, gate, onSwap: (l) => runner?.onLine(l) });
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
    const picked = last && last.choice !== 'delay' ? (v?.cards.find((c) => c.id === last.choice)?.title ?? BANK.cards.find((c) => c.id === last.choice)?.title) : undefined;
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
      picked && `Посетитель выбрал: «${picked}».`,
      v?.reveal && `${v.reveal.text}; исторический вариант — «${v.reveal.historical.title}».`,
      v?.feed.length && `Последние события хода: ${v.feed.slice(-3).join('; ')}.`,
      v && `Оценка: скорость — ${v.scales.notes.speed}; цена — ${v.scales.notes.cost}; замысел — ${v.scales.notes.intent}.`,
    ].filter(Boolean).join('\n');
    return { text, vars };
  };
  let runner: ReturnType<typeof aiRunner> | null = null;
  let resultSpeaking = false;
  const queue = voiceQueue(voice.speaker, {
    onLine: (l) => {
      runner?.onLine(l);
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
    },
  });
  runner = aiRunner({
    queue, ask, facts, dispatch: d.dispatch, onFrame: d.onFrame,
    count: (k) => d.count(k),
    voiced: voice.voiced,
    debrief: () => {
      const v = d.snapshot().model.view;
      const brief = v ? operationDebrief(v) : null;
      if (brief) d.dispatch({ t: 'hold', ms: 240_000 });
      return brief;
    },
    listen: () => new Promise<string | null>((res) => {
      if (!d.aiOn()) return res(null);
      let last = '';
      dictate({ onText: (t) => (last = t), onEnd: () => res(last || null) });
    }),
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
    decided: (s, _n, choice) => {
      const last = s.view.decisions.at(-1);
      const hist = !!last && last.choice === last.historical;
      void runner?.decided(choice === 'delay' ? 'delay' : hist ? 'historical' : 'own');
    },
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
      if (e.e === 'ask') voice.resume();
      if (e.e === 'say' || e.e === 'scene' || e.e === 'newSession' || e.e === 'ask' || e.e === 'listen' || e.e === 'deal') runner?.handle(e);
    },
    /** Тик часов: громкость голоса из настроек (смена — сразу); на заставке — круг фраз, если голос включён и окно перед посетителем. */
    tick() {
      const snap = d.snapshot();
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
    resume: () => voice.resume(),
    dispose() {
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
