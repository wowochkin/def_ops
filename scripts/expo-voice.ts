/**
 * Предзапись голоса выставочного стенда (`npm run expo:prepare -- --voice`): все заготовленные тексты стенда и куски
 * их склейки (`voiceTexts`) озвучиваются голосом начальника штаба голосовым сервисом (`render` — синтез в файл, ничего
 * не звучит) и сжимаются в Ogg Opus. Ключ клипа — хеш озвучиваемого текста, голоса (образец) и модели озвучки:
 * повторный запуск озвучивает только новое и изменённое. Клипы и манифест — `<папка данных>/expo/voice/`, в репозиторий
 * не входят.
 *
 * Автопроверка каждого клипа: файл есть и не пуст, длительность разумна для длины текста, распознавание речи сервисом
 * совпадает с текстом (доля ошибок по словам в допуске); не прошёл — синтезируется заново (до трёх попыток).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { joinGap, stageDomains, voiceTexts, type Clip, type VoiceManifest } from '../apps/editor/src/expo/prerecord';
import { speakable } from '../apps/editor/src/voice/speech';

export interface ClipCheck extends Clip {
  said: string; heard: string; wer: number; cer: number; ok: boolean;
  /** Выбран в студии (`npm run expo:voice-studio`): подготовка его не переозвучивает. */
  manual?: boolean; approved?: boolean; engine?: string;
  /** Другие дубли студии — на выбор. */
  takes?: ClipCheck[];
}
export interface Manifest extends VoiceManifest { clips: Record<string, ClipCheck> }

const words = (s: string) => s.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\d]+/gu) ?? [];

/** Доля ошибок по словам — как `wer` сервиса голоса (services/voice/voices.py). */
export function wer(expected: string, heard: string): number {
  const a = words(expected), b = words(heard);
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  a.forEach((x, i) => {
    const cur = [i + 1];
    b.forEach((y, j) => cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (x === y ? 0 : 1))));
    prev = cur;
  });
  return prev[b.length] / a.length;
}

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}
const letters = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\d]/gu, '');
/** Доля ошибок по буквам без пробелов: слитно или раздельно распознанное слово («на котёл», «Александр Плац») — не ошибка. */
export const cer = (said: string, heard: string) => lev(letters(said), letters(heard)) / Math.max(1, letters(said).length);

/** Распознавание пишет числа цифрами и сокращениями («2,5 млн») — к словам, как в озвучиваемом тексте. */
export const heardText = (heard: string) =>
  speakable(heard.replace(/(\d+),5\s*(млн|тыс)\.?/g, (_m, n: string, u: string) => `${n} с половиной ${u === 'млн' ? 'миллионов' : 'тысяч'}`), { full: true });

/** Допуск распознавания: одна ошибка на короткую фразу, иначе 20 % слов (имена собственные распознаются хуже). */
export const werOk = (said: string, w: number) => w * words(said).length <= Math.max(1, Math.ceil(words(said).length * 0.2)) + 1e-9;
/** Распознанное совпадает с текстом: по словам в допуске или по буквам — не больше 8 % ошибок. */
export const heardOk = (said: string, w: number, c: number) => werOk(said, w) || c <= 0.08;
/** Длительность разумна: от 25 до 200 мс на знак озвучиваемого текста (обычная речь — 65–85). */
export const msOk = (said: string, ms: number) => ms >= 300 && ms >= said.length * 25 && ms <= said.length * 200 + 1500;

export function dataDir(arg?: string): string {
  if (arg) return arg;
  if (process.env.DEFOPS_DATA_DIR) return process.env.DEFOPS_DATA_DIR;
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/ru.defops.desktop');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? homedir(), 'ru.defops.desktop');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'ru.defops.desktop');
}

/** Голос начальника штаба: id образца и отпечаток его звука (перезаписанный образец — новые клипы). */
export function chiefVoice(data: string): string {
  const roles = JSON.parse(readFileSync(join(data, 'voice/roles.json'), 'utf8')) as Record<string, string>;
  const id = roles.chief;
  if (!id) throw new Error('у начальника штаба нет голоса (voice/roles.json)');
  const ref = join(data, 'voice/voices', id, 'ref.wav');
  const stamp = existsSync(ref) ? createHash('sha256').update(readFileSync(ref)).digest('hex').slice(0, 12) : 'встроенный';
  return `${id}:${stamp}`;
}

export const clipKey = (said: string, voice: string, engine: string) => createHash('sha256').update(`${said}\n${voice}\n${engine}`).digest('hex').slice(0, 24);

const FILTER = [
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02', 'areverse',
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03', 'afade=t=in:d=0.025', 'areverse',
  'afade=t=in:d=0.01',
].join(',');

export function encode(wav: string, ogg: string): number {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', FILTER, '-ac', '1', '-c:a', 'libopus', '-b:a', '40k', '-f', 'ogg', ogg]);
  return durationMs(ogg);
}

const durationMs = (f: string) =>
  Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()) * 1000);

/** Подключение к голосовому сервису: синтез в файл с распознаванием. */
export async function service(url: string) {
  const ws = new WebSocket(url);
  const waits = new Map<number, (m: Record<string, unknown>) => void>();
  let ready: (m: Record<string, unknown>) => void = () => {};
  let fail: (e: Error) => void = () => {};
  let ttsWait: ((m: Record<string, unknown>) => void) | null = null;
  const hello = new Promise<Record<string, unknown>>((res, rej) => { ready = res; fail = rej; });
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    const m = JSON.parse(e.data) as Record<string, unknown>;
    if (m.type === 'ready') ready(m);
    else if (m.type === 'rendered') { waits.get(m.id as number)?.(m); waits.delete(m.id as number); }
    else if (m.type === 'tts_list' && m.state === 'ready') ttsWait?.(m);
    else if (m.type === 'error') console.error(`  сервис: ${m.text}`);
  };
  ws.onerror = () => fail(new Error(`голосовой сервис не отвечает (${url})`));
  const h = await Promise.race([hello, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('сервис не готов за 120 с')), 120_000))]);
  let id = 0;
  return {
    engine: String((h.tts as { current?: string } | undefined)?.current ?? 'unknown'),
    /** Модели озвучки службы: id, название, пояснение. */
    engines: ((h.tts as { engines?: { id: string; title: string; note: string }[] } | undefined)?.engines ?? []),
    /** Сменить модель озвучки (загрузка — до нескольких минут); не загрузилась — ошибка с причиной службы. */
    async setEngine(eid: string): Promise<void> {
      const m = await new Promise<Record<string, unknown>>((res, rej) => {
        const t = setTimeout(() => rej(new Error(`модель озвучки ${eid} не загрузилась за 10 мин`)), 600_000);
        ttsWait = (x) => { clearTimeout(t); ttsWait = null; res(x); };
        ws.send(JSON.stringify({ type: 'tts', op: 'set', id: eid }));
      });
      if (m.current !== eid) throw new Error(`модель озвучки ${eid} не загрузилась: ${m.error ?? 'причина не названа'}`);
      this.engine = eid;
    },
    render(text: string): Promise<{ path?: string; audio_s?: number; heard?: string; error?: string }> {
      const rid = ++id;
      return new Promise((res) => {
        waits.set(rid, res as never);
        ws.send(JSON.stringify({ type: 'render', id: rid, role: 'chief', text, asr: true }));
      });
    },
    close: () => ws.close(),
  };
}

export interface VoiceReport { total: number; ok: number; made: number; failed: string[]; dir: string }

/** Проверка готовой предзаписи без сервиса: у каждого текста есть клип, файл на месте, проверки пройдены. */
export function auditVoice(texts: string[], m: Manifest | null, dir: string): string[] {
  const bad: string[] = [];
  for (const t of texts) {
    const c = m?.clips[t];
    const f = c && join(dir, 'clips', c.file);
    if (!c || !f || !existsSync(f) || statSync(f).size < 200) bad.push(`нет клипа: «${t}»`);
    else if (!c.ok || !msOk(c.said, c.ms) || !heardOk(c.said, c.wer, c.cer)) bad.push(`не прошёл проверку (${c.ms} мс, WER ${c.wer}, CER ${c.cer}): «${t}» — слышно «${c.heard}»`);
  }
  return bad;
}

/** Модель озвучки предзаписи: лучшая по звучанию; для живой речи тяжела, для подготовки заранее — в самый раз. */
export const EXPO_VOICE_ENGINE = 'fish-s2-pro';

export async function prepareVoice(o: { data?: string; url?: string; start: string; hours: number; samples?: boolean; engine?: string }): Promise<VoiceReport> {
  const data = dataDir(o.data);
  const dir = join(data, 'expo/voice');
  mkdirSync(join(dir, 'clips'), { recursive: true });
  const mpath = join(dir, 'manifest.json');
  const old = existsSync(mpath) ? (JSON.parse(readFileSync(mpath, 'utf8')) as Manifest) : null;
  const texts = voiceTexts(stageDomains(o.start, o.hours));
  const voice = chiefVoice(data);
  let svc: Awaited<ReturnType<typeof service>> | null = null;
  try {
    svc = await service(o.url ?? 'ws://127.0.0.1:47645/ws');
  } catch (e) {
    console.log(`${(e as Error).message} — озвучка не обновлена, проверяю готовую.`);
  }
  // предзапись — своей моделью (качество важнее скорости), живой голос службы потом возвращается к выбранной
  const live = svc?.engine;
  const want = o.engine ?? EXPO_VOICE_ENGINE;
  if (svc && live !== want) {
    console.log(`Модель озвучки для предзаписи: ${want} (живой голос — ${live}, вернётся после подготовки).`);
    try { await svc.setEngine(want); } catch (e) { svc.close(); throw e; }
  }
  try {
  const engine = svc?.engine ?? old?.engine ?? 'unknown';
  const m: Manifest = { version: 1, voice, engine, clips: {} };
  let made = 0;
  for (const [i, text] of texts.entries()) {
    const said = speakable(text, { full: true });
    const file = `${clipKey(said, voice, engine)}.ogg`;
    const prev = old?.clips[text];
    if (prev?.manual && prev.said === said && existsSync(join(dir, 'clips', prev.file))) {
      m.clips[text] = prev;
      continue;
    }
    if (prev && prev.file === file && existsSync(join(dir, 'clips', file))) {
      // готовый клип: проверка пересчитывается по сохранённому распознанному (правило проверки могло измениться)
      const heard = heardText(prev.heard);
      const c = { ...prev, wer: Math.round(wer(said, heard) * 100) / 100, cer: Math.round(cer(said, heard) * 100) / 100 };
      c.ok = msOk(said, c.ms) && heardOk(said, c.wer, c.cer);
      if (c.ok) {
        m.clips[text] = c;
        continue;
      }
    }
    if (!svc) continue;
    let best: ClipCheck | null = null;
    for (let attempt = 0; attempt < 3 && !best?.ok; attempt++) {
      const r = await svc.render(said);
      if (r.error || !r.path) { console.error(`  синтез: ${r.error}`); continue; }
      const out = join(dir, 'clips', attempt ? `${file}.try` : file);
      const ms = encode(r.path, out);
      rmSync(r.path, { force: true });
      const heard = heardText(r.heard ?? '');
      const w = Math.round(wer(said, heard) * 100) / 100, ce = Math.round(cer(said, heard) * 100) / 100;
      const c: ClipCheck = { file, ms, said, heard: r.heard ?? '', wer: w, cer: ce, ok: msOk(said, ms) && heardOk(said, w, ce) };
      if (!c.ok) console.log(`    попытка ${attempt + 1}: ${ms} мс, WER ${c.wer}, CER ${c.cer} — слышно «${c.heard}»`);
      if (!best || (c.ok && !best.ok) || (c.ok === best.ok && c.wer < best.wer)) {
        if (attempt) execFileSync('mv', ['-f', out, join(dir, 'clips', file)]);
        best = c;
      } else rmSync(out, { force: true });
    }
    if (!best) continue;
    m.clips[text] = best;
    made++;
    console.log(`  ${i + 1}/${texts.length} ${best.ok ? '✓' : '✗'} ${(best.ms / 1000).toFixed(1)} с, WER ${best.wer.toFixed(2)}, CER ${best.cer.toFixed(2)} — ${text}`);
    writeFileSync(mpath, `${JSON.stringify(m, null, 1)}\n`); // прерванный прогон не теряет сделанное
  }
  if (svc || !old) writeFileSync(mpath, `${JSON.stringify(m, null, 1)}\n`);
  const used = new Set(Object.values(m.clips).flatMap((c) => [c.file, ...(c.takes ?? []).map((t) => t.file)]));
  for (const f of readdirSync(join(dir, 'clips'))) if (!used.has(f)) rmSync(join(dir, 'clips', f), { force: true });
  const failed = auditVoice(texts, svc || !old ? m : old, dir);
  if (o.samples) samples(m, dir);
  listing(m, dir);
  return { total: texts.length, ok: texts.length - failed.length, made, failed, dir };
  } finally {
    if (svc && live && svc.engine !== live) await svc.setEngine(live).catch((e) => console.error(`  ${(e as Error).message}`));
    svc?.close();
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Страница для прослушивания (`index.html` рядом с клипами): каждая фраза — текст, что сказано, что услышано, проверка. */
export function listing(m: Manifest, dir: string) {
  const rows = Object.entries(m.clips).map(([text, c], i) => `<tr class="${c.ok ? '' : 'bad'}"><td>${i + 1}</td>
<td>${esc(text)}${c.said !== text ? `<div class="said">сказано: ${esc(c.said)}</div>` : ''}<div class="heard">услышано: ${esc(c.heard)}</div></td>
<td>${(c.ms / 1000).toFixed(1)} с<br>WER ${c.wer}</td><td><audio controls preload="none" src="clips/${c.file}"></audio></td></tr>`);
  const sm = existsSync(join(dir, 'samples')) ? readdirSync(join(dir, 'samples')).filter((f) => f.endsWith('.ogg')) : [];
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Предзапись стенда</title>
<style>body{font:15px system-ui;margin:24px}td{border-bottom:1px solid #ddd;padding:6px;vertical-align:top}.said,.heard{color:#777;font-size:13px}.bad{background:#fee}</style>
<h1>Предзапись стенда: ${Object.keys(m.clips).length} фраз, модель ${esc(m.engine)}, голос ${esc(m.voice)}</h1>
${sm.length ? `<h2>Примеры склейки</h2>${sm.map((f) => `<p>${esc(f)}<br><audio controls preload="none" src="samples/${f}"></audio></p>`).join('')}` : ''}
<h2>Все фразы</h2><table>${rows.join('\n')}</table>\n`);
}

/** Примеры склейки для прослушивания — так же, как склеивает стенд: клипы встык, пауза по знаку. */
function samples(m: Manifest, dir: string) {
  const out = join(dir, 'samples');
  mkdirSync(out, { recursive: true });
  const sets: [string, string[]][] = [
    ['own-zhukov', ['Вы выбрали: «Обход высот с севера».', 'Маршал Жуков решил иначе.', 'Ход досчитан до 19 апреля.']],
    ['historical-konev', ['Именно так решил маршал Конев.', 'Модель досчитала ход до 25 апреля.']],
    ['own-ai-card', ['Вы выбрали свой вариант.', 'Маршал Конев решил иначе.', 'Ход досчитан до 2 мая.']],
  ];
  for (const [name, parts] of sets) {
    const clips = parts.map((p) => m.clips[p]);
    if (clips.some((c) => !c)) continue;
    const args = ['-y', '-loglevel', 'error'];
    const labels: string[] = [];
    clips.forEach((c, i) => {
      args.push('-i', join(dir, 'clips', c.file));
      labels.push(`[${labels.length}:a]`);
      if (i < clips.length - 1) {
        args.push('-f', 'lavfi', '-t', String(joinGap(parts[i])), '-i', 'anullsrc=r=48000:cl=mono');
        labels.push(`[${labels.length}:a]`);
      }
    });
    args.push('-filter_complex', `${labels.join('')}concat=n=${labels.length}:v=0:a=1`, '-c:a', 'libopus', '-b:a', '48k', join(out, `${name}.ogg`));
    execFileSync('ffmpeg', args);
  }
}
