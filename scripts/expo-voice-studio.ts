/**
 * Студия предзаписи стенда (`npm run expo:voice-studio`, http://127.0.0.1:47700) — вне основного приложения:
 * прослушать фразы, отправить неудачную на ещё один дубль, выбрать лучший дубль, сменить модель озвучки, отметить
 * одобренные. Выбранный вручную дубль подготовка (`expo:prepare -- --voice`) больше не переозвучивает.
 * Нужна запущенная голосовая служба (её поднимает приложение). Служба общая: сменённая здесь модель — и у живого
 * голоса приложения; при выходе из студии (Ctrl+C) возвращается прежняя.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cer, chiefVoice, clipKey, dataDir, encode, heardOk, heardText, loadStress, msOk, service, STRESS_PATH, wer, type ClipCheck, type Manifest,
} from './expo-voice';
import { markFor, markStress, plainStress, stressed, type StressMark } from '../apps/editor/src/expo/stress';
import { speakable } from '../apps/editor/src/voice/speech';

const PORT = Number(process.env.PORT ?? 47700);
const data = dataDir(process.argv.includes('--data') ? process.argv[process.argv.indexOf('--data') + 1] : undefined);
const dir = join(data, 'expo/voice');
const mpath = join(dir, 'manifest.json');
const cache = join(tmpdir(), 'expo-voice-studio');
mkdirSync(cache, { recursive: true });
if (!existsSync(mpath)) throw new Error(`нет предзаписи (${mpath}) — сначала npm run expo:prepare -- --voice`);

const load = () => JSON.parse(readFileSync(mpath, 'utf8')) as Manifest;
const save = (m: Manifest) => { writeFileSync(`${mpath}.tmp`, `${JSON.stringify(m, null, 1)}\n`); renameSync(`${mpath}.tmp`, mpath); };

const VOICE_URL = process.env.VOICE_URL ?? 'ws://127.0.0.1:47645/ws';
/** Служба не запущена (приложение закрыто) — студия поднимает её сама и гасит при выходе. */
let own: ChildProcess | null = null;
async function connect() {
  try { return await service(VOICE_URL); } catch { /* запускаем свою */ }
  const vdir = join(import.meta.dirname, '../services/voice');
  const py = join(vdir, '.venv/bin/python');
  if (!existsSync(py)) throw new Error(`голосовой службы нет и запустить её нечем (${py}) — services/voice/setup.sh`);
  console.log('Голосовая служба не запущена — запускаю (загрузка моделей 1–3 мин)…');
  own = spawn(py, ['server.py', '--data', join(data, 'voice')], { cwd: vdir, stdio: ['ignore', 'ignore', 'inherit'] });
  own.on('exit', (c) => { if (c) console.error(`голосовая служба завершилась (код ${c})`); own = null; });
  const until = Date.now() + 300_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    try { return await service(VOICE_URL); } catch (e) { if (!own || Date.now() > until) throw e; }
  }
}
const svc = await connect();
const live = svc.engine;
const voice = chiefVoice(data);
let busy: string | null = null;

/** Текст для озвучки по словарю ударений — как у подготовки. */
const sayOf = (text: string) => stressed(speakable(text, { full: true }), svc.engine, loadStress());

/**
 * Ещё один дубль текущей моделью. own — свой текст для озвучки (с «+» перед ударной), иначе по словарю.
 * Дубль — в takes, выбирает человек; main — сразу основным (переозвучка по словарю).
 */
async function regen(text: string, own?: string, main = false): Promise<ClipCheck> {
  const c = load().clips[text];
  if (!c) throw new Error('нет такой фразы');
  const { say, said } = own ? { say: own, said: markStress(own, markFor(svc.engine, loadStress())) } : sayOf(text);
  const file = `${clipKey(said, voice, `${svc.engine}#${Date.now()}`)}.ogg`;
  const r = await svc.render(said);
  if (r.error || !r.path) throw new Error(`синтез: ${r.error ?? 'нет файла'}`);
  const ms = encode(r.path, join(dir, 'clips', file));
  rmSync(r.path, { force: true });
  const heard = heardText(r.heard ?? '');
  const w = Math.round(wer(said, heard) * 100) / 100, ce = Math.round(cer(said, heard) * 100) / 100;
  const take: ClipCheck = {
    file, ms, said, say, heard: r.heard ?? '', wer: w, cer: ce, ok: msOk(said, ms) && heardOk(said, w, ce), engine: svc.engine,
    ...(own ? { override: true } : {}),
  };
  const fresh = load(); // за время синтеза манифест мог измениться
  const fc = fresh.clips[text];
  if (main) {
    const { takes, ...prev } = fc;
    fresh.clips[text] = { ...take, approved: fc.approved, manual: fc.manual, takes: [...(takes ?? []), prev] };
  } else fc.takes = [...(fc.takes ?? []), take];
  save(fresh);
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
  const d = loadStress();
  const added: string[] = [];
  for (const w of say.match(/[\p{L}+]*\+[\p{L}+]*/gu) ?? []) {
    const plain = plainStress(w);
    if (!plain || !/\+[аеёиоуыэюя]/i.test(w)) continue;
    d.words[plain[0].toUpperCase() + plain.slice(1)] = w[0].toUpperCase() + w.slice(1);
    added.push(w);
  }
  writeFileSync(STRESS_PATH, `${JSON.stringify(d, null, 1)}\n`);
  return added;
}

/** Выбрать дубль: он становится основным, прежний основной — среди дублей. */
function pick(text: string, file: string) {
  const m = load();
  const c = m.clips[text];
  const i = c?.takes?.findIndex((t) => t.file === file) ?? -1;
  if (!c || i < 0) throw new Error('нет такого дубля');
  const t = c.takes![i];
  const { takes: _t, ...main } = c;
  const rest = c.takes!.filter((_, j) => j !== i);
  m.clips[text] = { ...t, manual: true, approved: c.approved, takes: [...rest, { ...main, manual: undefined, approved: undefined }] };
  save(m);
}

function approve(text: string, on: boolean) {
  const m = load();
  if (!m.clips[text]) throw new Error('нет такой фразы');
  m.clips[text].approved = on;
  if (on) m.clips[text].manual = true;
  save(m);
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
    if (url.pathname.startsWith('/clips/')) {
      // браузеру — M4A: Safari не играет Ogg Opus в <audio>; клипы стенда остаются Ogg
      const name = url.pathname.slice(7);
      const f = join(dir, 'clips', name);
      if (!/^[0-9a-f]{8,64}\.ogg$/.test(name) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
      const m4a = join(cache, name.replace(/\.ogg$/, '.m4a'));
      if (!existsSync(m4a)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-c:a', 'aac', '-b:a', '96k', m4a]);
      res.writeHead(200, { 'content-type': 'audio/mp4', 'cache-control': 'no-store' });
      res.end(readFileSync(m4a));
      return;
    }
    if (url.pathname === '/api/state') {
      const st = loadStress();
      json({ engine: svc.engine, live, engines: svc.engines, busy, clips: load().clips, mark: markFor(svc.engine, st), words: st.words, affected: affected().length });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stress/word') { json({ added: addStress(String((await body(req)).say)) }); return; }
    if (req.method === 'POST' && url.pathname === '/api/stress/mark') {
      const b = await body(req);
      const d = loadStress();
      d.mark[svc.engine] = String(b.mark) as StressMark;
      writeFileSync(STRESS_PATH, `${JSON.stringify(d, null, 1)}\n`);
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
      try { json(await regen(String(b.text), typeof b.say === 'string' && b.say.trim() ? b.say.trim() : undefined)); } finally { busy = null; }
    } else if (url.pathname === '/api/restress') {
      // переозвучка затронутых словарём — в фоне, ход виден в шапке
      const list = affected();
      json({ count: list.length });
      void (async () => {
        try {
          for (const [i, t] of list.entries()) { busy = `по словарю ${i + 1} из ${list.length}`; await regen(t, undefined, true); }
        } catch (e) { console.error((e as Error).message); } finally { busy = null; }
      })();
    } else if (url.pathname === '/api/pick') { pick(String(b.text), String(b.file)); json({ ok: true }); }
    else if (url.pathname === '/api/approve') { approve(String(b.text), !!b.on); json({ ok: true }); }
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

const PAGE = `<!doctype html><meta charset="utf-8"><title>Студия предзаписи</title>
<style>
body{font:15px system-ui;margin:0;background:#f6f5f2;color:#222}
header{position:sticky;top:0;background:#1d2a24;color:#eee;padding:12px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;z-index:1}
header select,header button{font:inherit;padding:4px 8px}
main{padding:12px 20px}
.row{background:#fff;border-radius:6px;padding:10px 14px;margin:8px 0;display:grid;grid-template-columns:40px 1fr 360px;gap:12px}
.row.bad{background:#fdecec}.row.ok-approved{background:#eaf6ea}
.meta{color:#777;font-size:13px}.take{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px}
.take.main{font-weight:600}audio{height:32px;width:220px}
.say{display:flex;gap:6px;margin:6px 0}.say input{flex:1;font:inherit;padding:3px 6px}
button{cursor:pointer}#status{margin-left:auto;font-size:14px;color:#cfc}
</style>
<header>
 <b>Студия предзаписи</b>
 <label>Модель озвучки <select id="engine"></select></label><button id="setEngine">Сменить</button>
 <label title="Как модель понимает ударение — проверьте на слух и выберите">Ударение для модели <select id="mark"><option value="acute">знак над гласной (а́)</option><option value="plus">плюс перед гласной (+а)</option><option value="upper">заглавная гласная (А)</option></select></label>
 <button id="restress">Переозвучить по словарю</button>
 <label>Показать <select id="filter"><option value="all">все</option><option value="bad">не прошли проверку</option><option value="todo">не одобренные</option></select></label>
 <span id="count"></span><span id="status"></span>
</header>
<main id="list"></main>
<script>
const $ = (s) => document.querySelector(s);
let st = null;
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
async function api(p, b) {
  const r = await fetch(p, b ? { method: 'POST', body: JSON.stringify(b) } : undefined);
  const j = await r.json();
  if (j.error) { alert(j.error); throw new Error(j.error); }
  return j;
}
function status(t) { $('#status').textContent = t || ''; }
const toPlus = (s) => String(s).replace(/([аеёиоуыэюя])\\u0301/gi, '+$1');
const sayOf = (text) => document.querySelector('[data-say="' + CSS.escape(text) + '"]').value;
function take(text, t, main) {
  return '<div class="take' + (main ? ' main' : '') + '"><audio controls preload="none" src="/clips/' + t.file + '"></audio>'
    + (t.ok ? '✓' : '✗') + ' ' + (t.ms / 1000).toFixed(1) + ' с · WER ' + t.wer + (t.engine ? ' · ' + esc(t.engine) : '')
    + (main ? ' · основной' : ' <button data-pick="' + t.file + '" data-text="' + esc(text) + '">Выбрать</button>') + '</div>';
}
function render() {
  const f = $('#filter').value;
  const items = Object.entries(st.clips).filter(([, c]) => f === 'all' || (f === 'bad' ? !c.ok : !c.approved));
  $('#count').textContent = items.length + ' из ' + Object.keys(st.clips).length;
  $('#list').innerHTML = items.map(([text, c], i) => '<div class="row ' + (!c.ok ? 'bad' : c.approved ? 'ok-approved' : '') + '">'
    + '<div>' + (i + 1) + '</div><div>' + esc(text)
    + (c.said !== text ? '<div class="meta">сказано: ' + esc(c.said) + '</div>' : '')
    + '<div class="meta">услышано: ' + esc(c.heard) + '</div>'
    + '<div class="say"><input data-say="' + esc(text) + '" value="' + esc(c.say || toPlus(c.said)) + '" title="«+» перед ударной гласной: Х+альбе">'
    + '<button data-own="' + esc(text) + '">Озвучить этот текст</button><button data-dict="' + esc(text) + '">Ударения → в словарь</button></div>'
    + '<label class="meta"><input type="checkbox" data-approve="' + esc(text) + '"' + (c.approved ? ' checked' : '') + '> одобрено</label></div>'
    + '<div>' + take(text, c, true) + (c.takes || []).map((t) => take(text, t, false)).join('')
    + '<button data-regen="' + esc(text) + '">Ещё дубль (' + esc(st.engine) + ')</button></div></div>').join('');
}
async function load() {
  st = await api('/api/state');
  $('#engine').innerHTML = st.engines.map((e) => '<option value="' + e.id + '"' + (e.id === st.engine ? ' selected' : '') + ' title="' + esc(e.note) + '">' + esc(e.title) + '</option>').join('');
  $('#mark').value = st.mark;
  $('#restress').textContent = 'Переозвучить по словарю (' + st.affected + ')';
  $('#restress').disabled = !st.affected || !!st.busy;
  status(st.busy || ('сейчас: ' + st.engine + (st.engine !== st.live ? ' (живой голос вернётся к ' + st.live + ' при выходе)' : '')));
  render();
  if (st.busy) setTimeout(load, 3000);
}
$('#mark').onchange = async () => { await api('/api/stress/mark', { mark: $('#mark').value }); load(); };
$('#restress').onclick = async () => { await api('/api/restress', {}); load(); };
$('#filter').onchange = render;
$('#setEngine').onclick = async () => { status('загружаю модель… (до нескольких минут)'); await api('/api/engine', { id: $('#engine').value }).catch(() => {}); load(); };
document.addEventListener('click', async (e) => {
  const b = e.target;
  if (b.dataset.regen) { b.disabled = true; b.textContent = 'озвучиваю…'; await api('/api/regen', { text: b.dataset.regen }).catch(() => {}); load(); }
  if (b.dataset.pick) { await api('/api/pick', { text: b.dataset.text, file: b.dataset.pick }); load(); }
  if (b.dataset.own) { b.disabled = true; b.textContent = 'озвучиваю…'; await api('/api/regen', { text: b.dataset.own, say: sayOf(b.dataset.own) }).catch(() => {}); load(); }
  if (b.dataset.dict) {
    const r = await api('/api/stress/word', { say: sayOf(b.dataset.dict) });
    alert(r.added.length ? 'В словарь: ' + r.added.join(', ') + '. «Переозвучить по словарю» — все фразы с этими словами.' : 'Нет слов с «+» перед гласной');
    load();
  }
});
document.addEventListener('change', async (e) => {
  const b = e.target;
  if (b.dataset.approve) { await api('/api/approve', { text: b.dataset.approve, on: b.checked }); st.clips[b.dataset.approve].approved = b.checked; render(); }
});
load();
</script>`;
