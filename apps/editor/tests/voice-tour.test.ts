import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SECTIONS } from '../src/sections';
import { act, actions, getAction, listed, register } from '../src/voice/registry';
import { readAloud, stopReading } from '../src/voice/dictation';
import { systemText, toTools } from '../src/voice/llm';
import { shellActions } from '../src/voice/actions/shell';
import { tourActions, IN_GAME, type TourControl } from '../src/voice/actions/tour';
import { commandActions, releaseCommand, releaseReplay, replayActions } from '../src/voice/actions/command';
import { releaseStaff, staffActions } from '../src/voice/actions/staff';
import { releaseTurn, turnActions } from '../src/voice/actions/turn';
import { releaseScreen, screenActions } from '../src/voice/actions/screen';
import { COMMAND_BY_VOICE } from '../src/voice/tours/intro';
import { currentTab, TABS, tabActions, type TabSection } from '../src/voice/actions/tabs';
import { Dispatcher, helpText, paramsFit } from '../src/voice/dispatch';
import { TOURS, type Tour } from '../src/voice/tours';
import {
  bindTourVoice, tourStandby, settleSpeech, GAME_ENDED, GAME_STARTED, INTRO_HOW_OFF, setReplaySource, startTourFor, INTRO_KEY, INTRO_STOPPED, OFFER_MS, offer, onVoiceReady, PROPOSE, READY_FIRST, speakChief, TourEngine, tourControl, tourEngine,
  type SpeechEnd, type TourDeps,
} from '../src/voice/tour';
import { padFor, placeCaption, TourLayer, type Rect } from '../src/voice/TourLayer';
import { SayGate } from '../src/voice/panel-state';

const SRC = resolve(__dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
});

/**
 * Все значения data-tour в исходниках: буквальные и по шаблону `префикс-${…}` — `<раздел>-tab-${…}` по вкладкам
 * раздела (voice/actions/tabs.ts), остальные — по разделам.
 */
function tourTargets(): Set<string> {
  const out = new Set<string>();
  for (const f of files(SRC)) {
    const t = readFileSync(f, 'utf-8');
    for (const m of t.matchAll(/data-tour="([^"]+)"/g)) out.add(m[1]);
    for (const m of t.matchAll(/data-tour=\{`([^`$]*)\$\{[^}]+\}`\}/g)) {
      const tab = /^(\w+)-tab-$/.exec(m[1])?.[1];
      const ids = tab === 'cmd' ? CMD_TABS : tab ? (TABS[tab as TabSection] ?? []).map((x) => x.id) : SECTIONS.map((s) => s.id);
      ids.forEach((id) => out.add(m[1] + id));
    }
  }
  return out;
}

/** Вкладки командования (CommandView.tsx, `cmd-tab-${k}`). */
const CMD_TABS = ['reports', 'intel', 'decision', 'orders', 'journal', 'umpire'];

/** Действия командования и переигровки с пустой обстановкой — только чтобы взять их описания (id, say, params). */
function gameActions() {
  const none = () => ({}) as never;
  const list = [...commandActions(none), ...staffActions(none), ...turnActions(none), ...screenActions(none), ...replayActions(none)];
  releaseCommand(none); releaseStaff(none); releaseTurn(none); releaseScreen(none); releaseReplay(none);
  return list;
}
const normSay = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[«»?!.…:]/g, '').replace(/\s+/g, ' ').trim();
/** Все фразы `say` действий: реестров командования, тура и буквальные `say: [...]` в исходниках (useAction в разделах). */
function allSay(): Set<string> {
  const out = new Set<string>();
  for (const a of [...gameActions(), ...tourActions(fakeControl()), ...shellActions()]) a.say?.forEach((x) => out.add(normSay(x)));
  for (const f of files(SRC)) {
    for (const m of readFileSync(f, 'utf-8').matchAll(/say: \[([^\]]*)\]/g)) for (const q of m[1].matchAll(/'([^'$]+)'/g)) out.add(normSay(q[1]));
  }
  return out;
}

const fakeControl = (): TourControl => ({
  active: () => false, hasMore: () => false, paused: () => false, section: () => 'editor', has: () => false,
  start: async () => {}, next() {}, back() {}, repeat() {}, more() {}, pause() {}, resume() {}, stop() {}, introOn() {}, introOff() {},
});

describe('описания туров', () => {
  it('каждый target (и via) шага есть в исходниках как data-tour', () => {
    const have = tourTargets();
    const missing = TOURS.flatMap((t) => t.steps.flatMap((s) => [s.target, s.via, s.alt?.target].filter((x): x is string => !!x && !have.has(x)).map((x) => `${t.id}: ${x}`)));
    expect(missing).toEqual([]);
    expect(have.has('rail-replay')).toBe(true);
  });

  it('каждое prepare — существующее обратимое действие реестра с подходящими параметрами', () => {
    const all = [...shellActions(), ...tourActions(fakeControl()), ...tabActions(), ...gameActions()];
    for (const t of TOURS) for (const s of t.steps) {
      if (!s.prepare) continue;
      const a = all.find((x) => x.id === s.prepare!.action);
      expect(a, `${t.id}: ${s.prepare.action}`).toBeDefined();
      expect(a!.irreversible).toBeFalsy();
      expect(paramsFit(a!, s.prepare.params), `${t.id}: ${s.prepare.action} ${JSON.stringify(s.prepare.params)}`).toBe(true);
    }
  });

  it('тексты звучат как есть: без цифр и латиницы (что пишется иначе, чем звучит, — в speech); вступление — две-три минуты речи', () => {
    for (const t of TOURS) for (const s of t.steps) for (const x of [s.speech ?? s.text, s.more, s.unavailable, s.alt?.text, s.alt?.more]) {
      if (x) expect(x, `${t.id}: ${s.title}`).not.toMatch(/[0-9A-Za-z]/);
    }
    for (const t of TOURS) for (const s of t.steps) if (s.speech) expect(s.text, `${t.id}: ${s.title}`).not.toBe(s.speech);
    const intro = TOURS.find((t) => t.id === 'intro')!;
    const words = intro.steps.map((s) => s.text).join(' ').split(/\s+/).length;
    // ≈ 2 слова в секунду: от двух до трёх минут
    expect(words).toBeGreaterThan(200);
    expect(words).toBeLessThan(380);
    // разделы колонки — по очереди, все семь
    for (const s of SECTIONS) expect(intro.steps.some((x) => x.target === `rail-${s.id}`), s.id).toBe(true);
    expect(intro.steps[0].text).toMatch(/штабных игр по операциям Великой Отечественной войны с участием искусственного интеллекта/);
  });
});

/** Подставная речь: каждая фраза ждёт, пока тест скажет, чем она кончилась. */
function rig(tours: Tour[], o: { section?: string; present?: (t: string) => boolean } = {}) {
  const said: { text: string; end(r: SpeechEnd): void; cancelled: boolean }[] = [];
  const acted: [string, unknown][] = [];
  let section = o.section ?? 'editor';
  const deps: TourDeps = {
    tours,
    section: () => section,
    act: async (id, p) => { acted.push([id, p]); if (id === 'shell.open') section = (p as { section: string }).section; },
    exists: o.present ?? (() => true),
    speak: (text) => {
      let end!: (r: SpeechEnd) => void;
      const rec = { text, end: (r: SpeechEnd) => end(r), cancelled: false };
      said.push(rec);
      return { done: new Promise<SpeechEnd>((r) => { end = r; }), cancel: () => { rec.cancelled = true; end('stopped'); } };
    },
    sleep: () => Promise.resolve(),
  };
  const e = new TourEngine(deps);
  return { e, said, acted, setSection: (s: string) => { section = s; e.onSection(s); } };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const T: Tour = {
  id: 't', section: 'intro', title: 'Тест',
  steps: [
    { target: 'a', title: 'А', text: 'первый' },
    { target: 'b', title: 'Б', text: 'второй', more: 'подробнее о втором', unavailable: 'появится после расчёта', via: 'a' },
    { target: 'c', title: 'В', text: 'третий' },
  ],
};
const R: Tour = {
  id: 'r', section: 'replay', title: 'Переигровка',
  steps: [
    { target: 'a', title: 'А', text: 'в переигровке' },
    { target: 'b', title: 'Б', text: 'в картах', prepare: { action: 'shell.open', params: { section: 'maps' } } },
  ],
};

describe('движок тура', () => {
  it('договорил — следующий шаг; последний — конец', async () => {
    const { e, said } = rig([T]);
    const ends: string[] = [];
    await e.start('t', { onEnd: (r) => ends.push(r) });
    await flush();
    expect(e.state?.index).toBe(0);
    expect(said.at(-1)!.text).toBe('первый');
    said.at(-1)!.end('played');
    await flush();
    expect(e.state?.index).toBe(1);
    said.at(-1)!.end('played');
    await flush();
    said.at(-1)!.end('played');
    await flush();
    expect(e.state).toBeNull();
    expect(ends).toEqual(['done']);
  });

  it('элемента нет — к тексту шага добавлено, почему его не видно (unavailable), шаг помечен missing', async () => {
    const { e, said } = rig([T], { present: (t) => t !== 'b' });
    await e.start('t');
    await flush();
    e.next();
    await flush();
    expect(e.state).toMatchObject({ index: 1, missing: true });
    expect(said.at(-1)!.text).toBe('второй появится после расчёта');
  });

  it('перебили — пауза, «дальше» и «назад» листают, «подробнее» — свой текст', async () => {
    const { e, said } = rig([T]);
    await e.start('t');
    await flush();
    said.at(-1)!.end('stopped');
    await flush();
    expect(e.state?.phase).toBe('paused');
    e.next();
    await flush();
    expect(e.state).toMatchObject({ index: 1, phase: 'speaking' });
    e.more();
    expect(said.at(-2)!.cancelled).toBe(true);
    expect(said.at(-1)!.text).toBe('подробнее о втором');
    e.back();
    await flush();
    expect(e.state?.index).toBe(0);
    e.back();
    await flush();
    expect(e.state?.index).toBe(0);
  });

  it('голоса нет — шаг ждёт кнопки, сам не листается', async () => {
    const { e, said } = rig([T]);
    await e.start('t');
    await flush();
    said.at(-1)!.end('silent');
    await flush();
    expect(e.state).toMatchObject({ index: 0, phase: 'waiting' });
  });

  it('«хватит» — тур закончен, речь остановлена, поздний конец фразы ничего не листает', async () => {
    const { e, said } = rig([T]);
    const ends: string[] = [];
    await e.start('t', { onEnd: (r) => ends.push(r) });
    await flush();
    const first = said.at(-1)!;
    e.stop();
    expect(e.state).toBeNull();
    expect(first.cancelled).toBe(true);
    expect(ends).toEqual(['stopped']);
    first.end('played');
    await flush();
    expect(e.state).toBeNull();
  });

  it('тур раздела: открывает свой раздел; уход в другой — остановлен; переход по prepare — продолжен', async () => {
    const r = rig([R], { section: 'editor' });
    await r.e.start('r');
    expect(r.acted[0]).toEqual(['shell.open', { section: 'replay' }]);
    await flush();
    r.e.next(); // шаг сам открывает «Карты»
    await flush();
    r.setSection('maps');
    expect(r.e.state?.index).toBe(1);
    expect(r.acted.at(-1)).toEqual(['shell.open', { section: 'maps' }]);

    const q = rig([R], { section: 'replay' });
    const ends: string[] = [];
    await q.e.start('r', { onEnd: (x) => ends.push(x) });
    await flush();
    q.setSection('knowledge');
    expect(q.e.state).toBeNull();
    expect(ends).toEqual(['section']);
    expect(q.said.at(-1)!.text).toMatch(/Тур остановлен/);
  });

  it('тур по панели голоса — поверх любого раздела: смена раздела его не прерывает', async () => {
    const { e, setSection } = rig([{ ...T, section: 'voice' }]);
    await e.start('t');
    await flush();
    setSection('maps');
    expect(e.state?.index).toBe(0);
  });
});

describe('действия тура голосом', () => {
  let offs: (() => void)[] = [];
  let said: string[] = [];
  let t = 0;
  let run: ReturnType<typeof rig>;
  beforeEach(() => {
    said = []; t = 1_000_000;
    run = rig([T]);
    const e = run.e;
    const c: TourControl = {
      active: () => !!e.state, hasMore: () => !!e.step?.more, paused: () => e.state?.phase === 'paused', section: () => 'editor',
      has: (s) => e.has(s), start: (s) => e.start(s), next: () => e.next(), back: () => e.back(), repeat: () => e.repeat(),
      more: () => e.more(), pause: () => e.pause(), resume: () => e.resume(), stop: () => e.stop(), introOn() {}, introOff() {},
    };
    offs = [...tourActions(c), ...shellActions({ section: () => 'editor', open: () => {} })].map(register);
  });
  afterEach(() => { offs.forEach((o) => o()); run.e.stop(); });
  const mk = () => new Dispatcher({ now: () => t, say: (s) => { said.push(s); }, section: () => 'editor' });

  it('вне тура «дальше» недоступно, и в «что можно сказать» его нет', async () => {
    expect(await act('tour.next')).toBe('Тур сейчас не идёт.');
    const d = mk();
    d.spoke();
    expect(await d.utterance('дальше', 1)).not.toBe('done');
  });

  it('«Штаб, покажи раздел» без тура раздела — честно; «дальше» в окне разговора, «Штаб, назад», «Штаб, хватит»', async () => {
    const d = mk();
    expect(await d.utterance('Штаб, покажи раздел', 1)).toBe('done');
    expect(said.at(-1)).toMatch(/тура пока нет/);
    await run.e.start('t');
    await flush();
    d.spoke();
    expect(await d.utterance('дальше', 2)).toBe('done');
    await flush();
    expect(run.e.state?.index).toBe(1);
    expect(await d.utterance('Штаб, назад', 3)).toBe('done');
    await flush();
    expect(run.e.state?.index).toBe(0);
    expect(await d.utterance('Штаб, хватит', 4)).toBe('done');
    expect(run.e.state).toBeNull();
    expect(actions('editor').find((a) => a.id === 'tour.next')!.available()).not.toBe(true);
  });
});

describe('предложение штаба', () => {
  afterEach(() => vi.useRealTimers());
  it('«Скажите: да» — 15 с после того, как договорил; без голоса предложения нет', async () => {
    vi.useFakeTimers();
    let yes = 0;
    const ok = await offer('Пройти калибровку? Скажите: да.', () => { yes++; }, () => ({ done: Promise.resolve('played' as SpeechEnd), cancel() {} }));
    expect(ok).toBe(true);
    expect(await act('tour.yes')).toBeUndefined();
    expect(yes).toBe(1);
    // снова: «да» после 15 с ничего не делает
    await offer('Показать раздел? Скажите: да.', () => { yes++; }, () => ({ done: Promise.resolve('played' as SpeechEnd), cancel() {} }));
    vi.advanceTimersByTime(OFFER_MS + 1);
    await expect(act('tour.yes')).rejects.toThrow();
    expect(yes).toBe(1);
    const silent = await offer('…', () => { yes++; }, () => ({ done: Promise.resolve('silent' as SpeechEnd), cancel() {} }));
    expect(silent).toBe(false);
    await expect(act('tour.yes')).rejects.toThrow();
  });
});

describe('предложение штаба: фраза снята — «да» ничего не запускает', () => {
  afterEach(() => vi.useRealTimers());
  it('фраза остановлена («стоп», новая реплика) — tour.yes не регистрируется, как и без голоса', async () => {
    let yes = 0;
    const ok = await offer('Показать раздел? Скажите «да».', () => { yes++; }, () => ({ done: Promise.resolve('stopped' as SpeechEnd), cancel() {} }));
    expect(ok).toBe(false);
    expect(getAction('tour.yes')).toBeUndefined();
    expect(getAction('tour.no')).toBeUndefined();
    expect(getAction('tour.offer.repeat')).toBeUndefined();
    expect(yes).toBe(0);
  });
});

describe('предложение штаба: ответ на «да» и открытое окно', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const played = () => ({ done: Promise.resolve('played' as SpeechEnd), cancel() {} });

  it('после «да» штаб говорит ответ действия (или причину, почему нельзя)', async () => {
    await offer('Рассчитать операцию сейчас? Скажите «да» — и начну.', async () => 'Считаю: Берлинская операция.', played);
    expect(await act('tour.yes')).toBe('Считаю: Берлинская операция.');
  });

  it('открыто окно (например, «Принять командование») — предложение снято, «да» идёт окну', async () => {
    let yes = 0;
    await offer('Показать раздел? Скажите «да» — и покажу.', () => { yes++; }, played);
    vi.stubGlobal('document', { querySelector: (sel: string) => (/modal-bg/.test(sel) ? {} : null) });
    expect(actions('replay').find((a) => a.id === 'tour.yes')?.available()).not.toBe(true);
    vi.unstubAllGlobals();
    // снято насовсем: окно закрыли — «да» уже не к предложению
    expect(actions('replay').find((a) => a.id === 'tour.yes')).toBeUndefined();
    expect(yes).toBe(0);
  });
});

describe('слой тура', () => {
  it('идёт тур — притемнение, рамка и подпись с «Скажите: …»; «хватит» — слоя нет совсем', async () => {
    expect(renderToStaticMarkup(createElement(TourLayer, { section: 'editor' }))).toBe('');
    void tourEngine.start('intro');
    const html = renderToStaticMarkup(createElement(TourLayer, { section: 'editor' }));
    expect(html).toContain('tour-frame');
    expect(html.match(/class="tour-dim"/g)).toHaveLength(4);
    expect(html).toContain('Штабные игры с искусственным интеллектом');
    expect(html).toMatch(/data-action="tour.next"/);
    expect(html).toMatch(/data-action="tour.stop"/);
    tourEngine.stop();
    expect(renderToStaticMarkup(createElement(TourLayer, { section: 'editor' }))).toBe('');
  });
});

describe('голос готов (voice:ready-first) — вступление', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  });
  afterEach(() => { tourEngine.stop(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('вступление включено: событие отменено, идёт вступление, после него — voice:propose', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const e = new CustomEvent(READY_FIRST, { cancelable: true });
    onVoiceReady(e, (n) => sent.push(n));
    expect(e.defaultPrevented).toBe(true);
    expect(tourEngine.state?.tour.id).toBe('intro');
    tourEngine.stop();
    vi.runAllTimers();
    expect(sent).toEqual([PROPOSE]);
  });

  it('вступление выключено: событие не отменено (калибровку предлагает панель), тура нет', () => {
    store.set(INTRO_KEY, 'off');
    const sent: string[] = [];
    const e = new CustomEvent(READY_FIRST, { cancelable: true });
    onVoiceReady(e, (n) => sent.push(n));
    expect(e.defaultPrevented).toBe(false);
    expect(tourEngine.state).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('фраза шага снята из очереди панели — тур не висит', () => {
  afterEach(() => vi.useRealTimers());
  it('supersede (gate.drop) и выключение голоса переводят шаг на паузу', async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    let live = true;
    let id = 100;
    const gate2 = new SayGate((i) => { sent.push(i); }, () => 0, () => false, (ids) => ids.forEach((i) => settleSpeech(i, 'stopped')));
    const unbind = bindTourVoice({ client: { newSayId: () => ++id }, send: (i, t) => gate2.say(i, t), stop: (i) => { gate2.drop(i); }, live: () => live });
    const e = new TourEngine({ tours: [T], section: () => 'editor', act: async () => {}, exists: () => true, speak: speakChief, sleep: () => Promise.resolve() });
    gate2.speech(true); // человек говорит — фраза шага ждёт в очереди
    await e.start('t');
    await flush();
    expect(e.state?.phase).toBe('speaking');
    expect(sent).toEqual([]);
    gate2.drop(); // новая обращённая реплика не про тур
    await flush();
    expect(e.state?.phase).toBe('paused');
    expect(sent).toEqual([]);
    // голос выключили, пока шаг звучал: проверка «жив ли голос» ставит паузу
    gate2.speech(false);
    e.next();
    await flush();
    expect(e.state).toMatchObject({ index: 1, phase: 'speaking' });
    live = false;
    vi.advanceTimersByTime(600);
    await flush();
    expect(e.state?.phase).toBe('paused');
    unbind();
  });
});

describe('вступление: уход и смена тура', () => {
  it('сменился раздел — вступление остановлено с фразой, onEnd получает section', async () => {
    const intro: Tour = { ...T, id: 'intro', section: 'intro' };
    const { e, said, setSection } = rig([intro]);
    const ends: string[] = [];
    await e.start('intro', { onEnd: (r) => ends.push(r) });
    await flush();
    setSection('maps');
    expect(e.state).toBeNull();
    expect(ends).toEqual(['section']);
    expect(said.at(-1)!.text).toBe(INTRO_STOPPED);
  });
  it('новый тур посреди вступления — onEnd вступления (предложение калибровки) после нового', async () => {
    const intro: Tour = { ...T, id: 'intro', section: 'intro' };
    const other: Tour = { ...T, id: 'voice', section: 'voice' };
    const { e } = rig([intro, other]);
    const ends: string[] = [];
    await e.start('intro', { onEnd: (r) => ends.push(`intro:${r}`) });
    await e.start('voice');
    expect(ends).toEqual([]);
    e.stop();
    expect(ends).toEqual(['intro:stopped']);
  });
});

describe('подпись тура', () => {
  const vw = 1440, vh = 900, cap = { width: 620, height: 260 };
  const panel: Rect = { left: 986, top: 164, width: 440, height: 640 };
  const hits = (p: { left: number; top: number }, r: Rect) =>
    p.left < r.left + r.width && p.left + cap.width > r.left && p.top < r.top + r.height && p.top + cap.height > r.top;
  it('не закрывает элемент посередине экрана и панель голоса', () => {
    const mid: Rect = { left: 300, top: 360, width: 400, height: 180 }; // 40–60 % высоты
    const p = placeCaption(cap, [mid, panel], vw, vh, panel);
    expect(hits(p, mid) || hits(p, panel)).toBe(false);
  });
  it('элемент внизу слева — подпись сверху; колонка — снизу слева', () => {
    const low: Rect = { left: 100, top: 700, width: 500, height: 150 };
    expect(placeCaption(cap, [low, panel], vw, vh, panel).top).toBe(16);
    const rail: Rect = { left: -1, top: -1, width: 70, height: 902 };
    expect(placeCaption(cap, [rail, panel], vw, vh, panel)).toEqual({ left: 84, top: vh - 16 - cap.height });
  });
  it('элемент на всю ширину слева внизу и сверху — правее, левее панели', () => {
    const a: Rect = { left: 80, top: 0, width: 200, height: 900 };
    const p = placeCaption(cap, [a, panel], vw, vh, panel);
    expect(hits(p, a) || hits(p, panel)).toBe(false);
    expect(p.left + cap.width).toBeLessThanOrEqual(panel.left);
  });
  it('у кнопок колонки проём почти по кнопке', () => {
    expect(padFor('rail-replay')).toBeLessThanOrEqual(1);
    expect(padFor('voice-feed')).toBe(8);
    // вкладки командования стоят вплотную: рамка не должна задевать соседнюю
    expect(padFor('cmd-tab-reports')).toBeGreaterThanOrEqual(2);
    expect(padFor('cmd-tab-reports')).toBeLessThanOrEqual(3);
  });
});

describe('«хватит» во вступлении и выключение голосом', () => {
  let offs: (() => void)[] = [];
  let said: string[] = [];
  beforeEach(() => { said = []; offs = [...tourActions(tourControl), ...shellActions({ section: () => 'editor', open: () => {} })].map(register); });
  afterEach(() => { offs.forEach((o) => o()); tourEngine.stop(); vi.unstubAllGlobals(); });
  const mk = () => new Dispatcher({ now: () => 0, say: (s) => { said.push(s); }, section: () => 'editor' });

  it('«Стоп, хватит» во вступлении — тур окончен, штаб говорит, как выключить вступление (а не «Хорошо.»)', async () => {
    const spoken: string[] = [];
    const unbind = bindTourVoice({ client: { newSayId: () => spoken.length + 1 }, send: (_i, t) => { spoken.push(t); }, stop() {}, live: () => true });
    void tourEngine.start('intro');
    await flush();
    expect(await mk().utterance('Штаб, стоп, хватит', 1)).toBe('done');
    expect(tourEngine.state).toBeNull();
    expect(spoken.at(-1)).toBe(INTRO_HOW_OFF);
    expect(said).toEqual([]);
    unbind();
  });

  it('«Штаб, без вступления», «выключи вступление» — вступление выключено', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem() {} });
    expect(await mk().utterance('Штаб, без вступления', 1)).toBe('done');
    expect(store.get(INTRO_KEY)).toBe('off');
    store.clear();
    expect(await mk().utterance('Штаб, выключи вступление', 2)).toBe('done');
    expect(store.get(INTRO_KEY)).toBe('off');
    expect(await mk().utterance('Штаб, включи вступление', 3)).toBe('done');
    expect(store.get(INTRO_KEY)).toBe('on');
  });

  it('подпись вступления: «Больше не показывать»; строка-подсказка — только на паузе', () => {
    void tourEngine.start('intro');
    let html = renderToStaticMarkup(createElement(TourLayer, { section: 'editor' }));
    expect(html).toMatch(/data-action="tour.introOff"[^>]*>Больше не показывать/);
    expect(html).not.toContain('tour-hint');
    expect(html).toContain('Пропустить вступление — скажите «хватит»');
    tourEngine.pause();
    html = renderToStaticMarkup(createElement(TourLayer, { section: 'editor' }));
    expect(html).toContain('tour-hint');
  });
});

describe('туры разделов', () => {
  const SECTION_TOURS = ['editor', 'modeling', 'maps', 'library', 'knowledge', 'staff'];

  it('у разделов есть туры: от шести до двенадцати шагов, шаг — одна-три фразы, честный шаг о голосе', () => {
    for (const id of SECTION_TOURS) {
      const t = TOURS.find((x) => x.section === id);
      expect(t, id).toBeDefined();
      expect(t!.steps.length, id).toBeGreaterThanOrEqual(6);
      expect(t!.steps.length, id).toBeLessThanOrEqual(12);
      for (const s of t!.steps) {
        // фразы — по концу предложения (кавычки с вопросом внутри — не конец)
        const n = s.text.split(/(?<=[.!?…])\s+(?=[А-ЯЁ«])/).length;
        expect(n, `${id}: ${s.title}`).toBeLessThanOrEqual(3);
      }
      const honest = t!.steps.filter((s) => /Здесь голосом можно: перейти в другой раздел.*пройти этот тур.*остальное — мышью/.test(s.text));
      expect(honest.length, id).toBe(1);
      // в разделах с вкладками — и переключить вкладку
      if (id in TABS) expect(honest[0].text, id).toMatch(/переключить вкладку/);
      expect(t!.steps.some((s) => s.example), id).toBe(true);
    }
  });

  it('туры разделов с вкладками проходят все вкладки, переключая их сами (обратимо)', () => {
    for (const sec of Object.keys(TABS) as TabSection[]) {
      const t = TOURS.find((x) => x.section === sec)!;
      const opened = t.steps.filter((s) => s.prepare?.action === `${sec}.tab`).map((s) => (s.prepare!.params as { tab: string }).tab);
      // моделирование и знания — каждая вкладка; карты — обе
      expect(new Set(opened), sec).toEqual(new Set(TABS[sec].map((x) => x.id)));
    }
  });

  it('элементы, которых может не быть (инспектор, кнопки загрузки карт, вопросы к модели), — с объяснением и тем, что к ним ведёт', () => {
    const need = ['editor-inspector', 'maps-ohm', 'knowledge-ask', 'lib-design'];
    for (const target of need) {
      const s = TOURS.flatMap((t) => t.steps).find((x) => x.target === target)!;
      expect(s, target).toBeDefined();
      expect(s.unavailable, target).toBeTruthy();
      expect(s.via, target).toBeTruthy();
    }
  });

  it('подсветка «Знаков» — внутри страницы справочника (iframe того же источника)', () => {
    const lib = readFileSync(join(SRC, 'library-page.tsx'), 'utf-8');
    const t = TOURS.find((x) => x.section === 'library')!;
    const inside = t.steps.filter((s) => lib.includes(`data-tour="${s.target}"`)).map((s) => s.target);
    expect(inside.length).toBeGreaterThanOrEqual(4);
  });
});

describe('вкладки и туры разделов голосом', () => {
  let offs: (() => void)[] = [];
  let said: string[] = [];
  let started: string[] = [];
  let events: { name: string; tab: string }[] = [];
  let cur = 'editor';
  let game = false;
  const store = new Map<string, string>();
  beforeEach(() => {
    said = []; started = []; events = []; store.clear();
    const w = new EventTarget();
    for (const n of ['def_ops.modeling.open', 'def_ops.kb.tab', 'def_ops.maps.tab']) {
      w.addEventListener(n, (e) => events.push({ name: n, tab: (e as CustomEvent<{ tab: string }>).detail.tab }));
    }
    vi.stubGlobal('window', w);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    cur = 'editor';
    game = false;
    const c: TourControl = { ...fakeControl(), section: () => cur, has: (s) => TOURS.some((x) => x.section === s || x.id === s), start: async (s) => { started.push(s); }, inGame: () => game };
    offs = [...tabActions(), ...tourActions(c), ...shellActions({ section: () => 'editor', open: () => {} })].map(register);
  });
  afterEach(() => { offs.forEach((o) => o()); vi.unstubAllGlobals(); });
  const mk = (section: string) => new Dispatcher({ now: () => 0, say: (s) => { said.push(s); }, section: () => section });

  it('«Штаб, открой вкладку Калибровка» в моделировании — вкладка открыта, запомнена, штаб докладывает', async () => {
    expect(await mk('modeling').utterance('Штаб, открой вкладку Калибровка.', 1)).toBe('done');
    expect(events).toEqual([{ name: 'def_ops.modeling.open', tab: 'calibrate' }]);
    expect(store.get('def_ops.modeling.tab')).toBe('calibrate');
    expect(said.at(-1)).toBe('Открыта вкладка «Калибровка» — подбор правил по истории. Микрофон калибруют словами «Штаб, калибровка».');
  });

  it('короткие формы в своём разделе: «Штаб, открой калибровку / настройку / полноту / театры / документы / очередь на проверку»', async () => {
    expect(await mk('modeling').utterance('Штаб, открой калибровку', 1)).toBe('done');
    expect(await mk('modeling').utterance('Штаб, открой настройку', 2)).toBe('done');
    expect(await mk('modeling').utterance('Штаб, открой модели', 3)).toBe('done');
    expect(await mk('knowledge').utterance('Штаб, открой полноту', 4)).toBe('done');
    expect(await mk('knowledge').utterance('Штаб, открой документы', 5)).toBe('done');
    expect(await mk('knowledge').utterance('Штаб, открой очередь на проверку', 6)).toBe('done');
    expect(await mk('maps').utterance('Штаб, открой театры', 7)).toBe('done');
    expect(events.map((e) => e.tab)).toEqual(['calibrate', 'tune', 'models', 'coverage', 'docs', 'queue', 'theatres']);
    // «открой модели» не стало «открой моделирование», в другом разделе «открой калибровку» вкладку не трогает
    events = [];
    expect(await mk('editor').utterance('Штаб, открой калибровку', 8)).not.toBe('done');
    expect(events).toEqual([]);
  });

  it('вкладки знаний и карт; «вкладка …» без глагола; вкладки из двух слов', async () => {
    expect(await mk('knowledge').utterance('Штаб, вкладка документы', 1)).toBe('done');
    expect(await mk('knowledge').utterance('Штаб, открой вкладку «На проверку»', 2)).toBe('done');
    expect(await mk('maps').utterance('Штаб, открой вкладку Театры', 3)).toBe('done');
    expect(await mk('modeling').utterance('Штаб, открой вкладку агентная модель', 4)).toBe('done');
    expect(events).toEqual([
      { name: 'def_ops.kb.tab', tab: 'docs' }, { name: 'def_ops.kb.tab', tab: 'queue' },
      { name: 'def_ops.maps.tab', tab: 'theatres' }, { name: 'def_ops.modeling.open', tab: 'agents' },
    ]);
    expect(store.get('def_ops.maps.tab')).toBe('theatres');
  });

  it('вкладка другого раздела голосом не открывается; «Штаб, калибровка» — по-прежнему калибровка микрофона', async () => {
    expect(await mk('editor').utterance('Штаб, открой вкладку Калибровка', 1)).not.toBe('done');
    expect(events).toEqual([]);
    const calib: string[] = [];
    (window as unknown as EventTarget).addEventListener('voice:open', (e) => calib.push((e as CustomEvent<string>).detail));
    expect(await mk('modeling').utterance('Штаб, калибровка', 2)).toBe('done');
    expect(calib).toEqual(['calibrate']);
    expect(events).toEqual([]);
  });

  it('кнопка вкладки и модель — общее действие с параметром; неизвестная вкладка не открывается', async () => {
    await act('knowledge.tab', { tab: 'coverage' });
    expect(events.at(-1)).toEqual({ name: 'def_ops.kb.tab', tab: 'coverage' });
    expect(await act('maps.tab', { tab: 'nope' })).toBe('Нет такой вкладки.');
    expect(actions('modeling').find((a) => a.id === 'maps.tab')).toBeUndefined();
  });

  it('«Штаб, тур по картам / знаниям / ИИ / знакам / моделированию / переигровке» — тур раздела; «покажи раздел» — текущего', async () => {
    const d = mk('editor');
    expect(await d.utterance('Штаб, тур по картам', 1)).toBe('done');
    expect(await d.utterance('Штаб, тур по знаниям', 2)).toBe('done');
    expect(await d.utterance('Штаб, тур по ИИ', 3)).toBe('done');
    expect(await d.utterance('Штаб, тур по знакам', 4)).toBe('done');
    expect(await d.utterance('Штаб, тур по моделированию', 5)).toBe('done');
    expect(await d.utterance('Штаб, покажи раздел', 6)).toBe('done');
    expect(await d.utterance('Штаб, тур по переигровке', 7)).toBe('done');
    expect(await d.utterance('Штаб, тур по командованию', 8)).toBe('done');
    expect(started).toEqual(['maps', 'knowledge', 'staff', 'library', 'modeling', 'editor', 'replay', 'command']);
  });

  it('в игре: «покажи раздел» в переигровке — тур по командованию; «тур по переигровке» — честно, тура нет на экране', async () => {
    game = true;
    cur = 'replay';
    const d = mk('replay');
    expect(await d.utterance('Штаб, покажи раздел', 1)).toBe('done');
    expect(await d.utterance('Штаб, тур по командованию', 2)).toBe('done');
    expect(started).toEqual(['command', 'command']);
    expect(await d.utterance('Штаб, тур по переигровке', 3)).toBe('done');
    expect(started).toHaveLength(2);
    expect(said.at(-1)).toBe(IN_GAME);
    const lines = listed(actions('replay')).flatMap((a) => (a.hint ? [a.hint] : a.say ?? []));
    expect(lines.filter((p) => /тур по/.test(p))).toEqual(['штаб, тур по командованию']);
  });

  it('в ответах штаба — фраза нужной вкладки, а не строка-перечень', async () => {
    const d = mk('modeling');
    expect(await d.utterance('Штаб, а можешь открыть вкладку калибровка?', 1)).toBe('done');
    expect(said.at(-1)).toBe('Да, скажите: «штаб, открой вкладку калибровка».');
    await d.utterance('Штаб, открой вкладку калибровко', 2);
    expect(said.at(-1)).toMatch(/^Не понял вас\. Можно сказать.*«штаб, открой вкладку калибровка»/);
    expect(said.join(' ')).not.toMatch(/…:/);
    expect(helpText('modeling')).not.toMatch(/…/);
  });

  it('модели ярлыки не видны: в Моделировании инструменты без дублей', () => {
    const tools = toTools(actions('modeling')).map((t) => t.function.name);
    expect(tools).toContain('modeling__tab');
    expect(tools).toContain('tour__start');
    expect(tools.filter((n) => /^tour__of__|^modeling__tab__/.test(n))).toEqual([]);
    expect(new Set(tools).size).toBe(tools.length);
    const sys = systemText(actions('modeling'), 'modeling');
    expect(sys).not.toMatch(/tour__of__|modeling__tab__/);
    expect(sys).toMatch(/тур по картам/);
  });

  it('«Что можно сказать»: вкладки одной строкой, из «тур по …» — только текущий раздел; не длиннее прежнего + две строки', () => {
    // как в панели голоса: строка действия — его подсказка (hint) или фразы
    const lines = (sec: string) => listed(actions(sec)).filter((a) => a.hint || a.say?.length);
    const phrases = (sec: string) => lines(sec).flatMap((a) => (a.hint ? [a.hint] : a.say!));
    // прежний список (до туров разделов и вкладок): действия оболочки и тура без ярлыков и вкладок
    const before = lines('modeling').filter((a) => !/\.tab$/.test(a.id)).length;
    expect(lines('modeling').length).toBeLessThanOrEqual(before + 2);
    expect(phrases('modeling')).toContain('штаб, открой вкладку …: Модели, Сравнение, Настройка, Калибровка, Агентная модель, Операции, Ассистент');
    expect(phrases('editor').filter((p) => /тур по/.test(p))).toEqual(['штаб, тур по редактору']);
    cur = 'modeling';
    expect(phrases('modeling').filter((p) => /тур по/.test(p))).toEqual(['штаб, тур по моделированию']);
    cur = 'replay';
    expect(phrases('replay').filter((p) => /тур по/.test(p))).toEqual(['штаб, тур по переигровке']);
    expect(phrases('editor').some((p) => /вкладк/.test(p))).toBe(false);
  });
});

describe('тур возвращает вкладку, открытую до него', () => {
  const store = new Map<string, string>();
  let offs: (() => void)[] = [];
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    offs = [...tabActions(), ...shellActions({ section: () => 'modeling', open: () => {} })].map(register);
  });
  afterEach(() => { offs.forEach((o) => o()); vi.unstubAllGlobals(); });
  const engine = (speak: TourDeps['speak']) => new TourEngine({
    tours: TOURS, section: () => 'modeling', act, exists: () => true, speak, sleep: () => Promise.resolve(),
    tabOf: (a) => (a === 'modeling.tab' ? currentTab('modeling') : a === 'maps.tab' ? currentTab('maps') : a === 'knowledge.tab' ? currentTab('knowledge') : null),
  });

  it('тур по моделированию прошёл все вкладки — открыта и запомнена прежняя', async () => {
    store.set('def_ops.modeling.tab', 'compare');
    const e = engine(() => ({ done: Promise.resolve('played'), cancel() {} }));
    await e.start('modeling');
    for (let i = 0; i < 20 && e.state; i++) await flush();
    expect(e.state).toBeNull();
    expect(store.get('def_ops.modeling.tab')).toBe('compare');
  });

  it('человек сам сменил вкладку во время тура — после «хватит» она остаётся', async () => {
    store.set('def_ops.modeling.tab', 'compare');
    const e = engine(() => ({ done: new Promise<SpeechEnd>(() => {}), cancel() {} }));
    await e.start('modeling');
    await flush();
    e.next();
    await flush();
    expect(store.get('def_ops.modeling.tab')).toBe('models');
    await act('modeling.tab', { tab: 'ops' });
    e.stop();
    await flush();
    expect(store.get('def_ops.modeling.tab')).toBe('ops');
  });

  it('«хватит» посреди тура — прежняя вкладка; тур по картам — тоже', async () => {
    store.set('def_ops.maps.tab', 'base');
    const e = engine(() => ({ done: new Promise<SpeechEnd>(() => {}), cancel() {} }));
    await e.start('maps');
    await flush();
    for (let i = 0; i < 6; i++) { e.next(); await flush(); }
    expect(store.get('def_ops.maps.tab')).toBe('theatres');
    e.stop();
    await flush();
    expect(store.get('def_ops.maps.tab')).toBe('base');
  });
});

describe('туры переигровки и командования', () => {
  const tour = (id: string) => TOURS.find((t) => t.id === id)!;
  const sentences = (x: string) => x.split(/(?<=[.!?…])\s+(?=[А-ЯЁ«])/).length;

  it('«Переигровка» и «Командование» — от восьми до двенадцати шагов, шаг — одна-три фразы, честный шаг о голосе', () => {
    for (const id of ['replay', 'command']) {
      const t = tour(id);
      expect(t.section, id).toBe('replay');
      expect(t.steps.length, id).toBeGreaterThanOrEqual(8);
      expect(t.steps.length, id).toBeLessThanOrEqual(12);
      for (const s of t.steps) expect(sentences(s.text), `${id}: ${s.title}`).toBeLessThanOrEqual(3);
      expect(t.steps.filter((s) => /^Здесь голосом можно/.test(s.text)), id).toHaveLength(1);
    }
    expect(tour('replay').game).toBe(false);
    expect(tour('command').game).toBe(true);
    expect(tour('command-entry').game).toBe(false);
    // тур раздела по умолчанию (по разделу) — переигровка, а не командование
    expect(TOURS.find((t) => t.section === 'replay')!.id).toBe('replay');
  });

  it('примеры фраз — `say` существующих действий (в игре — командования)', () => {
    const say = allSay();
    for (const id of ['replay', 'command', 'command-entry']) {
      const ex = tour(id).steps.filter((s) => s.example).map((s) => s.example!);
      expect(ex.length, id).toBeGreaterThanOrEqual(id === 'command-entry' ? 3 : 6);
      for (const e of ex) expect(say.has(normSay(e)), `${id}: ${e}`).toBe(true);
    }
    // командование: примеры — от доклада до хода и разбора
    const cmd = tour('command').steps.map((s) => s.example).join(' | ');
    for (const re of [/доложи обстановку/, /дай три варианта/, /запиши в замысел/, /наступать на/, /проводи ход/, /повтори доклад/, /открой разбор/]) expect(cmd).toMatch(re);
  });

  it('тур по командованию в игре сам открывает вкладки игры (обратимо), подсветка — элементы экрана игры', () => {
    const opened = tour('command').steps.filter((s) => s.prepare?.action === 'command.tab').map((s) => (s.prepare!.params as { tab: string }).tab);
    expect(opened).toEqual(['reports', 'intel', 'decision', 'orders', 'umpire']);
    const cv = readFileSync(join(SRC, 'CommandView.tsx'), 'utf-8');
    for (const t of ['cmd-head', 'cmd-map', 'cmd-advisor', 'cmd-foot', 'cmd-menu']) expect(cv, t).toContain(`data-tour="${t}"`);
  });

  it('шаг «Ход»: при конце игры — итог (победа или поражение) и разбор, а не «проводи ход»; разбор — после первого хода', () => {
    const s = tour('command').steps.find((x) => x.title === 'Ход')!;
    expect(s.alt?.target).toBe('cmd-over');
    expect(s.alt!.text).toMatch(/[Пп]обеда или поражение/);
    expect(s.alt!.text).toMatch(/разбор/);
    expect(`${s.alt!.text} ${s.alt!.example}`).not.toMatch(/проводи ход/);
    expect(readFileSync(join(SRC, 'CommandView.tsx'), 'utf-8')).toContain('data-tour="cmd-over"');
    expect(tour('command').steps.find((x) => x.target === 'cmd-menu')!.text).toMatch(/после первого хода/);
  });

  it('элементы переигровки, которых до расчёта нет (итог, карта, «Принять командование»), — с объяснением и тем, что к ним ведёт', () => {
    for (const target of ['replay-results', 'replay-map', 'replay-tools', 'map-player', 'replay-take']) {
      const s = tour('replay').steps.find((x) => x.target === target)!;
      expect(s, target).toBeDefined();
      expect(s.unavailable, target).toMatch(/после расчёта|вместе с картой/);
      expect(['replay-go', 'replay-main']).toContain(s.via);
    }
  });

  it('тексты честны: вступление и тур командования — «почти всё», а не «всё»; расчёт — без обещанной длительности', () => {
    const cmd = TOURS.find((t) => t.id === 'command')!.steps.map((s) => s.text).join(' ');
    expect(cmd).toMatch(/почти всё, что нужно для игры/);
    expect(cmd).not.toMatch(/(?<!почти )всё, что нужно для игры/);
    expect(COMMAND_BY_VOICE).toMatch(/почти всё, что нужно для игры/);
    const calc = tour('replay').steps.find((x) => x.target === 'replay-go')!;
    expect(calc.text).not.toMatch(/меньше минуты|обычно/);
    expect(calc.text).toMatch(/в фоне.*штаб скажет, когда/);
  });

  it('вступление: в шаге «Как говорить» — что голосом можно в командовании, без рук от запуска до разбора', () => {
    expect(COMMAND_BY_VOICE).toMatch(/почти всё, что нужно для игры/);
    expect(COMMAND_BY_VOICE).not.toMatch(/всё командование/);
    for (const w of ['доклад обстановки', 'советник', 'диктовкой', 'приказы', 'ход с подтверждением', 'посредника', 'разбор']) expect(COMMAND_BY_VOICE).toContain(w);
    const how = TOURS.find((t) => t.id === 'intro')!.steps.find((s) => s.title === 'Как говорить со штабом')!;
    expect(how.text).toContain(COMMAND_BY_VOICE);
  });
});

describe('игра в «Переигровке» и туры', () => {
  const G: Tour = { id: 'g', section: 'replay', game: true, title: 'Игра', steps: [{ target: 'a', title: 'А', text: 'один' }, { target: 'b', title: 'Б', text: 'два' }] };
  const N: Tour = { ...G, id: 'n', game: false };
  const A: Tour = { ...G, id: 'any', game: undefined };

  it('игра началась посреди тура «вне игры» (кончилась посреди тура игры) — тур остановлен с фразой; туры без признака не трогаются', async () => {
    const { e, said } = rig([G, N, A], { section: 'replay' });
    const ends: string[] = [];
    await e.start('n', { onEnd: (r) => ends.push(r) });
    e.onGame(false);
    expect(e.state?.tour.id).toBe('n');
    e.onGame(true);
    expect(e.state).toBeNull();
    expect(ends).toEqual(['section']);
    expect(said.at(-1)!.text).toBe(GAME_STARTED);
    await e.start('g');
    e.onGame(false);
    expect(e.state).toBeNull();
    expect(said.at(-1)!.text).toBe(GAME_ENDED);
    await e.start('any');
    e.onGame(true);
    expect(e.state?.tour.id).toBe('any');
  });

  it('шага нет, а его замена (alt) на экране — показывается замена: подсветка, текст, «подробнее»', async () => {
    const X: Tour = { id: 'x', section: 'intro', title: 'Х', steps: [
      { target: 'foot', title: 'Ход', text: 'проводи ход', alt: { target: 'over', title: 'Итог', text: 'победа', more: 'о разборе' } },
    ] };
    const { e, said } = rig([X], { present: (t) => t === 'over' });
    await e.start('x');
    await flush(); await flush();
    expect(e.state).toMatchObject({ alt: true, missing: false });
    expect(e.step?.title).toBe('Итог');
    expect(said.at(-1)!.text).toBe('победа');
    e.more();
    expect(said.at(-1)!.text).toBe('о разборе');
  });

  it('вступление: на последнем шаге сделали предложенное («покажи переигровку») — вступление закончено, а не остановлено', async () => {
    const intro: Tour = { ...T, id: 'intro', section: 'intro' };
    const { e, said, setSection } = rig([intro]);
    const ends: string[] = [];
    await e.start('intro', { onEnd: (r) => ends.push(r) });
    e.next(); e.next();
    await flush();
    expect(e.state?.index).toBe(2);
    const n = said.length;
    setSection('replay');
    expect(e.state).toBeNull();
    expect(ends).toEqual(['done']);
    expect(said.slice(n).map((x) => x.text)).not.toContain(INTRO_STOPPED);
  });

  describe('«Штаб, тур по командованию» через движок окна', () => {
    let offs: (() => void)[] = [];
    let spoken: { id: number; text: string }[] = [];
    let unbind = () => {};
    const ran: string[] = [];
    let now: { game: boolean; saved: boolean; calculated: boolean } = { game: false, saved: false, calculated: false };
    beforeEach(() => {
      spoken = []; ran.length = 0; now = { game: false, saved: false, calculated: false };
      setReplaySource(() => now);
      let id = 500;
      unbind = bindTourVoice({ client: { newSayId: () => ++id }, send: (i, t) => { spoken.push({ id: i, text: t }); }, stop() {}, live: () => true });
      offs = [
        ...shellActions({ section: () => 'replay', open: () => {} }),
        ...['replay.calc', 'replay.continue', 'replay.takeCommand'].map((id) => ({ id, section: 'global', title: id, describe: id, available: () => true as const, run: async () => { ran.push(id); return `исполнено: ${id}`; } })),
      ].map(register);
    });
    afterEach(() => { tourEngine.stop(); offs.forEach((o) => o()); unbind(); setReplaySource(() => null); });

    const finishTour = async () => {
      for (let i = 0; i < 20 && tourEngine.state; i++) { tourEngine.next(); await flush(); }
      await flush();
    };

    it('вне игры — как туда попасть; дослушали — штаб предлагает рассчитать операцию, «да» — расчёт', async () => {
      await startTourFor('command');
      expect(tourEngine.state?.tour.id).toBe('command-entry');
      const text = tourEngine.state!.tour.steps.map((s) => `${s.text} ${s.example ?? ''}`).join(' ');
      for (const w of ['рассчитай операцию', 'Принять командование', 'принимаю', 'продолжи игру']) expect(text).toContain(w);
      await finishTour();
      const last = spoken.at(-1)!;
      expect(last.text).toBe('Рассчитать операцию сейчас? Скажите «да» — и начну.');
      settleSpeech(last.id, 'played');
      await flush();
      expect(await act('tour.yes')).toBe('исполнено: replay.calc');
      expect(ran).toEqual(['replay.calc']);
    });

    it('вне игры, есть незавершённая — предложение продолжить; рассчитано — открыть «Принять командование»', async () => {
      now = { game: false, saved: true, calculated: true };
      await startTourFor('command');
      await finishTour();
      expect(spoken.at(-1)!.text).toBe('Продолжить незавершённую игру? Скажите «да» — и продолжу.');
      settleSpeech(spoken.at(-1)!.id, 'played');
      await flush();
      await act('tour.yes');
      now = { game: false, saved: false, calculated: true };
      await startTourFor('command');
      await finishTour();
      expect(spoken.at(-1)!.text).toBe('Открыть окно «Принять командование»? Скажите «да» — и открою.');
      settleSpeech(spoken.at(-1)!.id, 'played');
      await flush();
      await act('tour.yes');
      expect(ran).toEqual(['replay.continue', 'replay.takeCommand']);
    });

    it('в игре — тур по экрану игры; «хватит» — без предложения', async () => {
      now = { game: true, saved: false, calculated: true };
      await startTourFor('command');
      expect(tourEngine.state?.tour.id).toBe('command');
      tourEngine.stop();
      await flush();
      expect(spoken.map((s) => s.text).join(' ')).not.toMatch(/Скажите «да»/);
    });
  });
});

describe('итоговый проход: «повтори» в туре, чтение по частям, дежурный режим', () => {
  let offs: (() => void)[] = [];
  let said: string[] = [];
  let t = 0;
  let run: ReturnType<typeof rig>;
  const LONG = 'Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение. Пятое предложение.';
  const played = () => ({ done: Promise.resolve('played' as SpeechEnd), cancel() {} });
  beforeEach(() => {
    said = []; t = 1_000_000;
    run = rig([T]);
    const e = run.e;
    const c: TourControl = {
      active: () => !!e.state, hasMore: () => !!e.step?.more, paused: () => e.state?.phase === 'paused', section: () => 'editor',
      has: (s) => e.has(s), start: (s) => e.start(s), next: () => e.next(), back: () => e.back(), repeat: () => e.repeat(),
      more: () => e.more(), pause: () => e.pause(), resume: () => e.resume(), stop: () => e.stop(), introOn() {}, introOff() {},
    };
    offs = [...tourActions(c), ...shellActions({ section: () => 'editor', open: () => {} })].map(register);
  });
  afterEach(() => { offs.forEach((o) => o()); run.e.stop(); stopReading(); tourStandby(false); vi.useRealTimers(); });
  const mk = () => new Dispatcher({ now: () => t, say: (s) => { said.push(s); }, section: () => 'editor' });

  it('«Штаб, повтори» при идущем туре — шаг говорится снова (а не «Я ещё ничего не говорил»)', async () => {
    const d = mk();
    await run.e.start('t');
    await flush();
    expect(run.said.map((x) => x.text)).toEqual(['первый']);
    expect(await d.utterance('Штаб, повтори', 1)).toBe('done');
    await flush();
    expect(run.said.map((x) => x.text)).toEqual(['первый', 'первый']);
    expect(run.e.state?.index).toBe(0);
    expect(said).toEqual([]);
    for (const w of ['Штаб, ещё раз', 'Штаб, повторите']) await d.utterance(w, 2);
    await flush();
    expect(run.said).toHaveLength(4);
    expect(said).not.toContain('Я ещё ничего не говорил.');
  });

  it('штаб предложил тур — «повтори» повторяет предложение', async () => {
    const d = mk();
    await offer('Показать, что есть в разделе «Редактор»? Скажите «да» — и покажу.', () => {}, played);
    expect(await d.utterance('Штаб, повтори', 1)).toBe('done');
    expect(said.at(-1)).toMatch(/^Показать, что есть в разделе «Редактор»\?/);
    expect(said).toHaveLength(1);
    // предложение снято — действия «повторить предложение» больше нет
    await act('tour.no');
    expect(getAction('tour.offer.repeat')).toBeUndefined();
  });

  it('фраза тура, сказанная мимо разборщика («Тур остановлен…»), — последняя фраза штаба для «повтори»', async () => {
    const d = mk();
    d.noted('Тур остановлен: открыт другой раздел.');
    await d.utterance('Штаб, повтори', 1);
    expect(said.at(-1)).toBe('Тур остановлен: открыт другой раздел.');
  });

  it('начало тура снимает остаток чтения по частям: «дальше» — шаг тура, а не старый текст', async () => {
    readAloud(LONG);
    expect(getAction('read.next')).toBeDefined();
    await run.e.start('t');
    await flush();
    expect(getAction('read.next')).toBeUndefined();
    const d = mk();
    d.spoke();
    expect(await d.utterance('дальше', 1)).toBe('done');
    await flush();
    expect(run.e.state?.index).toBe(1);
    expect(said.join(' ')).not.toMatch(/Третье/);
  });

  it('чтение начато во время тура — «дальше» и «хватит» всё равно тура', async () => {
    await run.e.start('t');
    await flush();
    readAloud(LONG);
    const d = mk();
    d.spoke();
    await d.utterance('дальше', 1);
    await flush();
    expect(run.e.state?.index).toBe(1);
    await d.utterance('хватит', 2);
    expect(run.e.state).toBeNull();
  });

  it('дежурный режим: после «Штаб, отбой» тур на паузе и молчит; пробуждение — пауза остаётся, «продолжай» возобновляет', async () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    const unbind = bindTourVoice({ client: { newSayId: () => spoken.length + 1 }, send: (_i, tx) => { spoken.push(tx); }, stop() {}, live: () => true });
    run.e.stop();
    offs.push(...tourActions(tourControl).map(register)); // действия — на движок окна
    const TG: Tour = { ...T, game: false };
    const d = new Dispatcher({ now: () => t, say: (s) => { said.push(s); }, section: () => 'editor', onStandby: (on) => tourStandby(on) });
    void tourEngine.start(TG);
    await vi.advanceTimersByTimeAsync(1200);
    expect(spoken).toEqual(['первый']);
    expect(await d.utterance('Штаб, отбой', 1)).toBe('done');
    expect(d.standby).toBe(true);
    expect(tourEngine.state?.phase).toBe('paused');
    // между шагами не говорит, предложений нет, «Тур остановлен» не звучит
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken).toEqual(['первый']);
    expect(tourEngine.state).toMatchObject({ index: 0, phase: 'paused' });
    const spy = vi.fn(() => played());
    expect(await offer('Показать раздел? Скажите «да».', () => {}, spy)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(getAction('tour.yes')).toBeUndefined();
    speakChief('Хватит.');
    expect(spoken).toEqual(['первый']);
    // «хватит»/прочее в дежурном не исполняется
    expect(await d.utterance('Штаб, хватит', 2)).toBe('ignored');
    expect(tourEngine.state).not.toBeNull();
    // пробуждение: тур остаётся на паузе
    t += 20_000; // эхо «Дежурю…» кончилось
    expect(await d.utterance('Штаб, на связь', 3)).toBe('done');
    expect(d.standby).toBe(false);
    expect(tourEngine.state).toMatchObject({ index: 0, phase: 'paused' });
    expect(spoken).toEqual(['первый']);
    // «продолжай» — с того же шага
    await d.utterance('Штаб, продолжай', 4);
    await vi.advanceTimersByTimeAsync(1200);
    expect(spoken).toEqual(['первый', 'первый']);
    expect(tourEngine.state?.phase).toBe('speaking');
    unbind();
    tourEngine.stop();
  });

  it('дежурный режим: смена раздела по туру с игрой не пишет «Тур остановлен»', async () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    const unbind = bindTourVoice({ client: { newSayId: () => spoken.length + 1 }, send: (_i, tx) => { spoken.push(tx); }, stop() {}, live: () => true });
    run.e.stop();
    void tourEngine.start({ ...T, game: false });
    await vi.advanceTimersByTimeAsync(1200);
    tourStandby(true);
    tourEngine.onGame(true);
    expect(tourEngine.state).toBeNull();
    expect(spoken).toEqual(['первый']);
    unbind();
  });
});
