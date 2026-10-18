import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SECTIONS } from '../src/sections';
import { act, actions, register } from '../src/voice/registry';
import { shellActions } from '../src/voice/actions/shell';
import { tourActions, type TourControl } from '../src/voice/actions/tour';
import { Dispatcher } from '../src/voice/dispatch';
import { TOURS, type Tour } from '../src/voice/tours';
import {
  bindTourVoice, settleSpeech, INTRO_HOW_OFF, INTRO_KEY, INTRO_STOPPED, OFFER_MS, offer, onVoiceReady, PROPOSE, READY_FIRST, speakChief, TourEngine, tourControl, tourEngine,
  type SpeechEnd, type TourDeps,
} from '../src/voice/tour';
import { padFor, placeCaption, TourLayer, type Rect } from '../src/voice/TourLayer';
import { SayGate } from '../src/voice/panel-state';

const SRC = resolve(__dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
});

/** Все значения data-tour в исходниках: буквальные и по шаблону `префикс-${…}` (по разделам). */
function tourTargets(): Set<string> {
  const out = new Set<string>();
  for (const f of files(SRC)) {
    const t = readFileSync(f, 'utf-8');
    for (const m of t.matchAll(/data-tour="([^"]+)"/g)) out.add(m[1]);
    for (const m of t.matchAll(/data-tour=\{`([^`$]*)\$\{[^}]+\}`\}/g)) SECTIONS.forEach((s) => out.add(m[1] + s.id));
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
    const missing = TOURS.flatMap((t) => t.steps.flatMap((s) => [s.target, s.via].filter((x): x is string => !!x && !have.has(x)).map((x) => `${t.id}: ${x}`)));
    expect(missing).toEqual([]);
    expect(have.has('rail-replay')).toBe(true);
  });

  it('каждое prepare — существующее обратимое действие реестра', () => {
    const all = [...shellActions(), ...tourActions(fakeControl())];
    for (const t of TOURS) for (const s of t.steps) {
      if (!s.prepare) continue;
      const a = all.find((x) => x.id === s.prepare!.action);
      expect(a, `${t.id}: ${s.prepare.action}`).toBeDefined();
      expect(a!.irreversible).toBeFalsy();
    }
  });

  it('тексты звучат как есть: без цифр и латиницы; вступление — две-три минуты речи', () => {
    for (const t of TOURS) for (const s of t.steps) for (const x of [s.text, s.more, s.unavailable]) {
      if (x) expect(x, `${t.id}: ${s.title}`).not.toMatch(/[0-9A-Za-z]/);
    }
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

  it('элемента нет — подсказка, когда он появится (unavailable), шаг помечен missing', async () => {
    const { e, said } = rig([T], { present: (t) => t !== 'b' });
    await e.start('t');
    await flush();
    e.next();
    await flush();
    expect(e.state).toMatchObject({ index: 1, missing: true });
    expect(said.at(-1)!.text).toBe('появится после расчёта');
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
