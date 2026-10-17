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
import { INTRO_KEY, OFFER_MS, offer, onVoiceReady, PROPOSE, READY_FIRST, TourEngine, TourLayer, tourEngine, type SpeechEnd, type TourDeps } from '../src/voice/tour';

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

  it('вступление и панель голоса — поверх любого раздела: смена раздела их не прерывает', async () => {
    const { e, setSection } = rig([T]);
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
