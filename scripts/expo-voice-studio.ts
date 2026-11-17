/**
 * Студия предзаписи стенда (`npm run expo:voice-studio`, http://127.0.0.1:47700) — вне основного приложения:
 * прослушать фразы, отправить неудачную на ещё один дубль, выбрать лучший дубль, сменить модель озвучки, отметить
 * одобренные. Выбранный вручную дубль подготовка (`expo:prepare -- --voice`) больше не переозвучивает.
 * Нужна запущенная голосовая служба (её поднимает приложение). Служба общая: сменённая здесь модель — и у живого
 * голоса приложения; при выходе из студии (Ctrl+C) возвращается прежняя.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { voiceEnvironment, voicePython } from '../apps/desktop/server/voice-platform.mjs';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cer, chiefVoice, clipKey, dataDir, EmptyVoiceClipError, encode, heardOk, heardText, msOk, service, STRESS_PATH, voiceStamp, wer, type ClipCheck, type Manifest,
} from './expo-voice';
import { padding, recognizer, trimContext } from './expo-debrief-context';
import { BANK } from '../apps/editor/src/expo/bank';
import { situationVoice, stageDomains, voiceTexts } from '../apps/editor/src/expo/prerecord';
import { markFor, markStress, plainStress, stressed, type StressMark } from '../apps/editor/src/expo/stress';
import { speakable } from '../apps/editor/src/voice/speech';
import { buildLexicon } from './expo-voice-lexicon';
import { dictionaryEntry, updateDictionary, type StudioDictionary } from './expo-voice-dictionary';
import { PAGE } from './expo-voice-studio-page';

const PORT = Number(process.env.PORT ?? 47700);
const data = dataDir(process.argv.includes('--data') ? process.argv[process.argv.indexOf('--data') + 1] : undefined);
const dir = join(data, 'expo/voice');
const mpath = join(dir, 'manifest.json');
const debriefDir = join(import.meta.dirname, '../apps/editor/public/expo-debrief');
const debriefPath = join(debriefDir, 'manifest.json');
const debriefTakes = join(data, 'expo/debrief-takes');
const debriefEngine = 'qwen3-ru-stress';
type StudioClip = Pick<ClipCheck, 'file' | 'ms'> & Omit<Partial<ClipCheck>, 'takes'> & { takes?: StudioClip[] };
type DebriefCatalog = { version: 1; voices: Record<string, Record<string, StudioClip>> };
const cache = join(tmpdir(), 'expo-voice-studio');
mkdirSync(cache, { recursive: true });
const stressPath = process.env.EXPO_STRESS_PATH ?? STRESS_PATH;
const loadStress = (): StudioDictionary => JSON.parse(readFileSync(stressPath, 'utf8'));
const saveStress = (d: StudioDictionary) => {
  writeFileSync(`${stressPath}.tmp`, `${JSON.stringify(d, null, 1)}\n`);
  renameSync(`${stressPath}.tmp`, stressPath);
};
const previews: string[] = [];
if (!existsSync(mpath)) throw new Error(`нет предзаписи (${mpath}) — сначала npm run expo:prepare -- --voice`);

const load = () => JSON.parse(readFileSync(mpath, 'utf8')) as Manifest;
function saveJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`);
  renameSync(temporary, path);
}

function debriefVoice(value: unknown) {
  if (value == null) return undefined;
  if (value === 'zhukov-14s' || value === 'konev-12s') return value;
  throw new Error('Выберите голос Жукова или Конева.');
}

function recordings(frontVoice?: string) {
  if (!frontVoice) {
    const manifest = load();
    const clips: Record<string, StudioClip> = manifest.clips;
    return { clips, folder: join(dir, 'clips'), save: () => saveJson(mpath, manifest) };
  }
  const manifest = existsSync(debriefPath)
    ? JSON.parse(readFileSync(debriefPath, 'utf8')) as DebriefCatalog
    : { version: 1, voices: {} } as DebriefCatalog;
  const clips = manifest.voices[frontVoice] ?? {};
  const folder = join(debriefDir, 'clips');
  return { clips, folder, save: () => saveJson(debriefPath, manifest), voices: manifest.voices };
}

const VOICE_URL = process.env.VOICE_URL ?? 'ws://127.0.0.1:47645/ws';
/** Служба не запущена (приложение закрыто) — студия поднимает её сама и гасит при выходе. */
let own: ChildProcess | null = null;
async function connect() {
  try { return await service(VOICE_URL); } catch { /* запускаем свою */ }
  const vdir = join(import.meta.dirname, '../services/voice');
  const py = voicePython(vdir);
  if (!existsSync(py)) throw new Error(`голосовой службы нет и запустить её нечем (${py}) — services/voice/setup.sh`);
  console.log('Голосовая служба не запущена — запускаю (загрузка моделей 1–3 мин)…');
  own = spawn(py, ['server.py', '--data', join(data, 'voice')], { cwd: vdir, env: voiceEnvironment(), windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });
  own.on('exit', (c) => { if (c) console.error(`голосовая служба завершилась (код ${c})`); own = null; });
  const until = Date.now() + 300_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    try { return await service(VOICE_URL); } catch (e) { if (!own || Date.now() > until) throw e; }
  }
}
const scenario = JSON.parse(readFileSync(join(import.meta.dirname, '..', BANK.scenario), 'utf8')) as { start: string; hours: number };
/** Фразы каталога, которых нет в манифесте: в студии их тоже видно и можно озвучить. */
const missingTexts = () => {
  const have = new Set(Object.keys(load().clips));
  return voiceTexts(stageDomains(scenario.start, scenario.hours)).filter((t) => !have.has(t));
};
const sampleFiles = () => {
  const s = join(dir, 'samples');
  return existsSync(s) ? readdirSync(s).filter((f) => f.endsWith('.ogg')) : [];
};

const svc = await connect();
const live = svc.engine;
const voice = chiefVoice(data);
let busy: string | null = null;

/** Текст для озвучки по словарю ударений — как у подготовки. */
const sayOf = (text: string, engine = svc.engine, dictionary = loadStress()) => stressed(speakable(text, { full: true }), engine, dictionary);

async function renderTake(said: string, output: string, sample: string | undefined, debrief: boolean) {
  const expected = plainStress(said);
  for (let attempt = 0; attempt < 3; attempt++) {
    const padded = debrief && attempt === 2 && expected.length < 95;
    const prompt = attempt === 1 ? said.replace(/ — /g, ', ') : said;
    const r = await svc.render(padded ? `${prompt}${/[.!?…]$/.test(prompt) ? '' : '.'} ${padding}` : prompt, sample);
    if (r.error || !r.path) throw new Error(`Синтез: ${r.error ?? 'нет файла'}`);
    const trimmed = `${output}.wav`;
    try {
      if (r.audio_s === 0) throw new EmptyVoiceClipError();
      if (!padded) return { ms: encode(r.path, output), heard: r.heard ?? '' };

      const asr = recognizer();
      try {
        const heard = await trimContext(r.path, trimmed, padding, asr);
        if (heard && cer(expected, heardText(heard)) <= 0.13) {
          const ms = encode(trimmed, output);
          if (msOk(expected, ms)) return { ms, heard };
          rmSync(output, { force: true });
        }
      } finally { asr.close(); }
    } catch (error) {
      if (!(error instanceof EmptyVoiceClipError)) throw error;
    } finally {
      rmSync(r.path, { force: true });
      rmSync(trimmed, { force: true });
    }
    console.warn(`Пустой или неполный дубль ${attempt + 1}/3 — ${expected}`);
  }
  throw new Error('Модель не произнесла фразу после трёх попыток. Текущий дубль сохранён.');
}

/**
 * Ещё один дубль текущей моделью. own — свой текст для озвучки (с «+» перед ударной), иначе по словарю.
 * Дубль — в takes, выбирает человек; main — сразу основным (переозвучка по словарю).
 */
async function regen(text: string, own?: string, main = false, frontVoice?: string): Promise<ClipCheck> {
  if (!Object.hasOwn(recordings(frontVoice).clips, text) && (frontVoice || !missingTexts().includes(text))) throw new Error('нет такой фразы');
  if (frontVoice && svc.engine !== debriefEngine) throw new Error('Для итогов выберите модель Qwen3-TTS с ударениями и нажмите «Сменить».');
  const { say, said } = own ? { say: own, said: markStress(own, markFor(svc.engine, loadStress())) } : sayOf(text);
  // обстановка Жукова и Конева — их образец; остальное — начальник штаба. Без образца служба
  // для модели с ударениями всегда берёт образец штаба.
  const sample = frontVoice ?? situationVoice(text);
  const clipVoice = sample ? voiceStamp(data, sample) : voice;
  if (frontVoice && clipVoice.endsWith(':встроенный')) throw new Error(`Нет образца голоса ${frontVoice}.`);
  const file = `${clipKey(said, clipVoice, `${svc.engine}#${randomUUID()}`)}.ogg`;
  const target = frontVoice ? debriefTakes : join(dir, 'clips');
  mkdirSync(target, { recursive: true });
  const { ms, heard: recognized } = await renderTake(said, join(target, file), sample ?? undefined, !!frontVoice);
  const heard = heardText(recognized);
  const w = Math.round(wer(said, heard) * 100) / 100, ce = Math.round(cer(said, heard) * 100) / 100;
  const take: ClipCheck = {
    file, ms, said, say, heard: recognized, wer: w, cer: ce, ok: msOk(said, ms) && heardOk(said, w, ce), engine: svc.engine,
    ...(own ? { override: true } : {}),
  };
  const fresh = recordings(frontVoice); // за время синтеза манифест мог измениться
  const fc = fresh.clips[text];
  if (!fc) fresh.clips[text] = take;
  else if (main && !frontVoice) {
    const { takes, ...prev } = fc;
    fresh.clips[text] = { ...take, approved: fc.approved, manual: fc.manual, takes: [...(takes ?? []), prev] };
  } else fc.takes = [...(fc.takes ?? []), take];
  fresh.save();
  console.log(`${main ? 'по словарю' : 'дубль'}: ${take.ok ? '✓' : '✗'} WER ${w} — ${say}`);
  return take;
}

/** Фразы, у которых текст для озвучки по словарю изменился (кроме заданных вручную). */
function affected(): string[] {
  const m = load();
  return Object.entries(m.clips).filter(([t, c]) => !c.override && sayOf(t).said !== c.said).map(([t]) => t);
}

/** Добавить ударения из текста с «+» в словарь: каждое слово с «+» — как есть. */
function addStress(say: string): string[] {
  let d = loadStress();
  const added: string[] = [];
  for (const w of say.match(/[\p{L}+]*\+[\p{L}+]*/gu) ?? []) {
    const plain = plainStress(w);
    if (!plain || !/\+[аеёиоуыэюя]/i.test(w)) continue;
    d = updateDictionary(d, plain[0].toUpperCase() + plain.slice(1), w);
    added.push(w);
  }
  saveStress(d);
  return added;
}

/** Выбрать дубль: он становится основным, прежний основной — среди дублей. */
function pick(text: string, file: string, frontVoice?: string) {
  const catalog = recordings(frontVoice);
  const c = Object.hasOwn(catalog.clips, text) ? catalog.clips[text] : undefined;
  const i = c?.takes?.findIndex((t) => t.file === file) ?? -1;
  if (!c || i < 0) throw new Error('нет такого дубля');
  const t = c.takes![i];
  const { takes: _t, manual: _m, approved: _a, ...main } = c;
  const rest = c.takes!.filter((_, j) => j !== i);
  catalog.clips[text] = { ...t, manual: true, approved: c.approved, takes: [...rest, main] };
  if (!frontVoice) { catalog.save(); return; }

  if (!msOk(speakable(text, { full: true }), t.ms)) throw new Error('Длительность дубля не подходит для этой реплики.');
  const previous = join(catalog.folder, main.file);
  const selected = join(catalog.folder, file);
  copyFileSync(previous, join(debriefTakes, main.file));
  const alreadyPublished = existsSync(selected);
  if (!alreadyPublished) copyFileSync(join(debriefTakes, file), selected);
  try { catalog.save(); }
  catch (error) { if (!alreadyPublished) rmSync(selected, { force: true }); throw error; }
  const stillUsed = Object.values(catalog.voices!).some((lines) => Object.values(lines).some((clip) => clip.file === main.file));
  if (!stillUsed) rmSync(previous, { force: true });
}

function approve(text: string, on: boolean, frontVoice?: string) {
  const m = recordings(frontVoice);
  if (!Object.hasOwn(m.clips, text)) throw new Error('нет такой фразы');
  m.clips[text].approved = on;
  if (on) m.clips[text].manual = true;
  m.save();
}

const body = (req: import('node:http').IncomingMessage) => new Promise<Record<string, unknown>>((res) => {
  let s = '';
  req.on('data', (d) => { s += d; });
  req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (v: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)); };
  try {
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
    if (url.pathname.startsWith('/dictionary-audio/')) {
      const name = url.pathname.slice('/dictionary-audio/'.length);
      if (!/^dictionary-[0-9a-f-]+\.m4a$/.test(name) || !previews.includes(name)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'audio/mp4', 'cache-control': 'no-store' });
      res.end(readFileSync(join(cache, name)));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/lexicon') {
      json(buildLexicon(loadStress(), Object.keys(load().clips)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/lexicon/entry') {
      const b = await body(req);
      try {
        const updated = updateDictionary(loadStress(), b.word, b.say);
        saveStress(updated);
        json({ ok: true });
      } catch (e) { json({ error: (e as Error).message }, 400); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/lexicon/preview') {
      if (busy) { json({ error: `Служба занята: ${busy}` }, 409); return; }
      const b = await body(req);
      let entry: ReturnType<typeof dictionaryEntry>;
      try { entry = dictionaryEntry(b.word, b.say); }
      catch (e) { json({ error: (e as Error).message }, 400); return; }
      const sample = typeof b.voiceId === 'string' && b.voiceId ? b.voiceId : undefined;
      if (sample && !['zhukov-14s', 'konev-12s'].includes(sample)) { json({ error: 'Выберите голос штаба, Жукова или Конева.' }, 400); return; }
      const text = typeof b.text === 'string' && b.text.trim() ? b.text.trim() : `Проверяем произношение: ${entry.word}.`;
      if (text.length > 1200) { json({ error: 'Для проверки используйте фразу не длиннее 1200 знаков.' }, 400); return; }
      const dictionary = updateDictionary(loadStress(), entry.word, entry.say ?? '');
      const said = stressed(speakable(text, { full: true }), svc.engine, dictionary).said;
      busy = `проверка произношения «${entry.word}»`;
      try {
        const r = await svc.render(said, sample);
        if (r.error || !r.path) throw new Error(r.error ?? 'Сервис не вернул звук.');
        const name = `dictionary-${randomUUID()}.m4a`;
        try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', r.path, '-c:a', 'aac', '-b:a', '128k', join(cache, name)]); }
        finally { rmSync(r.path, { force: true }); }
        previews.push(name);
        while (previews.length > 20) rmSync(join(cache, previews.shift()!), { force: true });
        json({ url: `/dictionary-audio/${name}`, said, engine: svc.engine });
      } finally { busy = null; }
      return;
    }
    if (url.pathname.startsWith('/samples/')) {
      const name = decodeURIComponent(url.pathname.slice(9));
      const f = join(dir, 'samples', name);
      if (!/^[\w.-]+\.ogg$/.test(name) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
      const m4a = join(cache, `sample-${name.replace(/\.ogg$/, '.m4a')}`);
      if (!existsSync(m4a)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-c:a', 'aac', '-b:a', '96k', m4a]);
      res.writeHead(200, { 'content-type': 'audio/mp4', 'cache-control': 'no-store' });
      res.end(readFileSync(m4a));
      return;
    }
    const isDebriefClip = url.pathname.startsWith('/debrief-clips/');
    if (isDebriefClip || url.pathname.startsWith('/clips/')) {
      // браузеру — M4A: Safari не играет Ogg Opus в <audio>; клипы стенда остаются Ogg
      const name = url.pathname.split('/')[2];
      if (!/^[0-9a-f]{8,64}\.ogg$/.test(name) || url.pathname.split('/').length !== 3) { res.writeHead(404); res.end(); return; }
      const published = join(isDebriefClip ? debriefDir : dir, 'clips', name);
      const f = isDebriefClip && !existsSync(published) ? join(debriefTakes, name) : published;
      if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
      const m4a = join(cache, `${isDebriefClip ? 'debrief-' : ''}${name.replace(/\.ogg$/, '.m4a')}`);
      if (!existsSync(m4a)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-c:a', 'aac', '-b:a', '96k', m4a]);
      res.writeHead(200, { 'content-type': 'audio/mp4', 'cache-control': 'no-store' });
      res.end(readFileSync(m4a));
      return;
    }
    if (url.pathname === '/api/state') {
      const st = loadStress();
      const frontVoice = debriefVoice(url.searchParams.get('debrief'));
      const { clips } = recordings(frontVoice);
      const voiceOf: Record<string, string> = {};
      for (const t of Object.keys(clips)) {
        const v = frontVoice ?? situationVoice(t);
        if (v) voiceOf[t] = v;
      }
      const missing = frontVoice ? [] : missingTexts();
      const dictSay: Record<string, string> = {};
      for (const t of new Set([...Object.keys(clips), ...missing])) dictSay[t] = sayOf(t, frontVoice ? debriefEngine : svc.engine, st).say;
      json({ engine: svc.engine, live, engines: svc.engines, busy, clips, mark: markFor(svc.engine, st), words: st.words, affected: frontVoice ? 0 : affected().length, missing, samples: frontVoice ? [] : sampleFiles(), voiceOf, dictSay });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stress/word') { json({ added: addStress(String((await body(req)).say)) }); return; }
    if (req.method === 'POST' && url.pathname === '/api/stress/mark') {
      const b = await body(req);
      const d = loadStress();
      d.mark[svc.engine] = String(b.mark) as StressMark;
      saveStress(d);
      json({ ok: true });
      return;
    }
    if (req.method !== 'POST') { json({ error: 'нет такого адреса' }, 404); return; }
    const b = await body(req);
    if (busy) { json({ error: `служба занята: ${busy}` }, 409); return; }
    if (url.pathname === '/api/engine') {
      busy = `загрузка модели ${b.id}`;
      try { await svc.setEngine(String(b.id)); } finally { busy = null; }
      json({ engine: svc.engine });
    } else if (url.pathname === '/api/regen') {
      busy = `дубль «${String(b.text).slice(0, 40)}…»`;
      try {
        json(await regen(
          String(b.text),
          typeof b.say === 'string' && b.say.trim() ? b.say.trim() : undefined,
          b.main !== false,
          debriefVoice(b.debrief),
        ));
      } finally { busy = null; }
    } else if (url.pathname === '/api/restress') {
      // переозвучка затронутых словарём — в фоне, ход виден в шапке
      const list = affected();
      json({ count: list.length });
      void (async () => {
        try {
          for (const [i, t] of list.entries()) { busy = `по словарю ${i + 1} из ${list.length}`; await regen(t, undefined, true); }
        } catch (e) { console.error((e as Error).message); } finally { busy = null; }
      })();
    } else if (url.pathname === '/api/pick') { pick(String(b.text), String(b.file), debriefVoice(b.debrief)); json({ ok: true }); }
    else if (url.pathname === '/api/approve') { approve(String(b.text), !!b.on, debriefVoice(b.debrief)); json({ ok: true }); }
    else json({ error: 'нет такого адреса' }, 404);
  } catch (e) {
    json({ error: (e as Error).message }, 500);
  }
}).on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Порт ${PORT} занят — студия, видимо, уже запущена: http://127.0.0.1:${PORT} (другой порт — PORT=…)` : e.message);
  svc.close();
  own?.kill('SIGTERM');
  process.exit(1);
}).listen(PORT, '127.0.0.1', () => console.log(`Студия предзаписи: http://127.0.0.1:${PORT} (модель сейчас ${svc.engine}; Ctrl+C — выход)`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, quit);
async function quit() {
  if (svc.engine !== live) {
    console.log(`Возвращаю модель живого голоса: ${live}…`);
    await svc.setEngine(live).catch((e) => console.error((e as Error).message));
  }
  svc.close();
  own?.kill('SIGTERM');
  process.exit(0);
}
