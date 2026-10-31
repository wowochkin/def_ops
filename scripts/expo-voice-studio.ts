/**
 * Студия предзаписи стенда (`npm run expo:voice-studio`, http://127.0.0.1:47700) — вне основного приложения:
 * прослушать фразы, отправить неудачную на ещё один дубль, выбрать лучший дубль, сменить модель озвучки, отметить
 * одобренные. Выбранный вручную дубль подготовка (`expo:prepare -- --voice`) больше не переозвучивает.
 * Нужна запущенная голосовая служба (её поднимает приложение). Служба общая: сменённая здесь модель — и у живого
 * голоса приложения; при выходе из студии (Ctrl+C) возвращается прежняя.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cer, chiefVoice, clipKey, dataDir, encode, heardOk, heardText, msOk, service, wer, type ClipCheck, type Manifest,
} from './expo-voice';

const PORT = Number(process.env.PORT ?? 47700);
const data = dataDir(process.argv.includes('--data') ? process.argv[process.argv.indexOf('--data') + 1] : undefined);
const dir = join(data, 'expo/voice');
const mpath = join(dir, 'manifest.json');
if (!existsSync(mpath)) throw new Error(`нет предзаписи (${mpath}) — сначала npm run expo:prepare -- --voice`);

const load = () => JSON.parse(readFileSync(mpath, 'utf8')) as Manifest;
const save = (m: Manifest) => { writeFileSync(`${mpath}.tmp`, `${JSON.stringify(m, null, 1)}\n`); renameSync(`${mpath}.tmp`, mpath); };

const svc = await service(process.env.VOICE_URL ?? 'ws://127.0.0.1:47645/ws');
const live = svc.engine;
const voice = chiefVoice(data);
let busy: string | null = null;

/** Ещё один дубль текущей моделью: в takes; лучше прежнего по проверке — не выбирается сам, выбирает человек. */
async function regen(text: string): Promise<ClipCheck> {
  const m = load();
  const c = m.clips[text];
  if (!c) throw new Error('нет такой фразы');
  const n = (c.takes?.length ?? 0) + 1;
  const file = `${clipKey(c.said, voice, `${svc.engine}#${Date.now()}`)}.ogg`;
  const r = await svc.render(c.said);
  if (r.error || !r.path) throw new Error(`синтез: ${r.error ?? 'нет файла'}`);
  const ms = encode(r.path, join(dir, 'clips', file));
  rmSync(r.path, { force: true });
  const heard = heardText(r.heard ?? '');
  const w = Math.round(wer(c.said, heard) * 100) / 100, ce = Math.round(cer(c.said, heard) * 100) / 100;
  const take: ClipCheck = { file, ms, said: c.said, heard: r.heard ?? '', wer: w, cer: ce, ok: msOk(c.said, ms) && heardOk(c.said, w, ce), engine: svc.engine };
  const fresh = load(); // за время синтеза манифест мог измениться
  const fc = fresh.clips[text];
  fc.takes = [...(fc.takes ?? []), take];
  save(fresh);
  console.log(`дубль ${n}: ${take.ok ? '✓' : '✗'} WER ${w} — ${text}`);
  return take;
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
      const f = join(dir, 'clips', url.pathname.slice(7).replace(/[^0-9a-f.]/g, ''));
      if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'audio/ogg', 'cache-control': 'no-store' });
      res.end(readFileSync(f));
      return;
    }
    if (url.pathname === '/api/state') { json({ engine: svc.engine, live, engines: svc.engines, busy, clips: load().clips }); return; }
    if (req.method !== 'POST') { json({ error: 'нет такого адреса' }, 404); return; }
    const b = await body(req);
    if (busy) { json({ error: `служба занята: ${busy}` }, 409); return; }
    if (url.pathname === '/api/engine') {
      busy = `загрузка модели ${b.id}`;
      try { await svc.setEngine(String(b.id)); } finally { busy = null; }
      json({ engine: svc.engine });
    } else if (url.pathname === '/api/regen') {
      busy = `дубль «${String(b.text).slice(0, 40)}…»`;
      try { json(await regen(String(b.text))); } finally { busy = null; }
    } else if (url.pathname === '/api/pick') { pick(String(b.text), String(b.file)); json({ ok: true }); }
    else if (url.pathname === '/api/approve') { approve(String(b.text), !!b.on); json({ ok: true }); }
    else json({ error: 'нет такого адреса' }, 404);
  } catch (e) {
    json({ error: (e as Error).message }, 500);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Студия предзаписи: http://127.0.0.1:${PORT} (модель сейчас ${svc.engine}; Ctrl+C — выход)`));

process.on('SIGINT', async () => {
  if (svc.engine !== live) {
    console.log(`Возвращаю модель живого голоса: ${live}…`);
    await svc.setEngine(live).catch((e) => console.error((e as Error).message));
  }
  svc.close();
  process.exit(0);
});

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
button{cursor:pointer}#status{margin-left:auto;font-size:14px;color:#cfc}
</style>
<header>
 <b>Студия предзаписи</b>
 <label>Модель озвучки <select id="engine"></select></label><button id="setEngine">Сменить</button>
 <label>Показать <select id="filter"><option value="all">все</option><option value="bad">не прошли проверку</option><option value="todo">не одобренные</option></select></label>
 <span id="count"></span><span id="status"></span>
</header>
<main id="list"></main>
<script>
const $ = (s) => document.querySelector(s);
let st = null;
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
async function api(p, b) {
  const r = await fetch(p, b ? { method: 'POST', body: JSON.stringify(b) } : undefined);
  const j = await r.json();
  if (j.error) { alert(j.error); throw new Error(j.error); }
  return j;
}
function status(t) { $('#status').textContent = t || ''; }
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
    + '<label class="meta"><input type="checkbox" data-approve="' + esc(text) + '"' + (c.approved ? ' checked' : '') + '> одобрено</label></div>'
    + '<div>' + take(text, c, true) + (c.takes || []).map((t) => take(text, t, false)).join('')
    + '<button data-regen="' + esc(text) + '">Ещё дубль (' + esc(st.engine) + ')</button></div></div>').join('');
}
async function load() {
  st = await api('/api/state');
  $('#engine').innerHTML = st.engines.map((e) => '<option value="' + e.id + '"' + (e.id === st.engine ? ' selected' : '') + ' title="' + esc(e.note) + '">' + esc(e.title) + '</option>').join('');
  status(st.busy || ('сейчас: ' + st.engine + (st.engine !== st.live ? ' (живой голос вернётся к ' + st.live + ' при выходе)' : '')));
  render();
}
$('#filter').onchange = render;
$('#setEngine').onclick = async () => { status('загружаю модель… (до нескольких минут)'); await api('/api/engine', { id: $('#engine').value }).catch(() => {}); load(); };
document.addEventListener('click', async (e) => {
  const b = e.target;
  if (b.dataset.regen) { b.disabled = true; b.textContent = 'озвучиваю…'; await api('/api/regen', { text: b.dataset.regen }).catch(() => {}); load(); }
  if (b.dataset.pick) { await api('/api/pick', { text: b.dataset.text, file: b.dataset.pick }); load(); }
});
document.addEventListener('change', async (e) => {
  const b = e.target;
  if (b.dataset.approve) { await api('/api/approve', { text: b.dataset.approve, on: b.checked }); st.clips[b.dataset.approve].approved = b.checked; render(); }
});
load();
</script>`;
