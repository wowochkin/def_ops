/** Страница студии: записи и проверяемый словарь произношения. */
export const PAGE = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Студия предзаписи</title>
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
[hidden]{display:none!important}button,input,select{font:inherit}button:disabled{cursor:default;opacity:.6}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #9c781c;outline-offset:3px}
.studio-tabs{display:flex;gap:4px}.studio-tabs button{border:1px solid #738078;background:transparent;color:#eee;padding:7px 16px;border-radius:4px}.studio-tabs button[aria-selected="true"]{background:#eee9db;color:#1d2a24;border-color:#eee9db;font-weight:650}.recording-controls{display:contents}body[data-tab="lexicon"] .recording-controls{display:none}body[data-tab="lexicon"] #status{display:none}
.debrief-controls{display:none}body[data-tab="debrief"] .debrief-controls{display:contents}body[data-tab="debrief"] #restress{display:none}
#lexicon{padding:22px 20px 36px;max-width:1560px;margin:auto}.lex-head{display:flex;gap:24px;align-items:flex-start;justify-content:space-between;margin-bottom:20px}.lex-head h1{font-size:23px;line-height:1.2;margin:0 0 8px}.lex-help{max-width:76ch;color:#59615c;line-height:1.5;margin:0}.lex-help code{color:#1d2a24;font:600 15px system-ui}.lex-coverage{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;max-width:460px}.lex-coverage span{background:#eeece5;padding:7px 10px;border-radius:4px;font-size:13px;white-space:nowrap}.lex-coverage strong{font-variant-numeric:tabular-nums;margin-right:4px}.lex-coverage .missing{background:#faead5;color:#744e14}
.lex-tools{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px;padding-bottom:16px}.lex-tools label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#515b54}.lex-search{flex:1;min-width:230px}.lex-tools input,.lex-tools select,.lex-add input{box-sizing:border-box;border:1px solid #aeb6af;border-radius:4px;padding:9px 10px;background:#fff;color:#222;min-height:38px}.lex-tools select{min-width:160px}.lex-tools button,.lex-add button,.lex-pages button{padding:9px 14px;min-height:38px;border:1px solid #aeb6af;border-radius:4px;background:#fff;color:#263d30}.lex-results{font-size:13px;color:#626b65;margin:0 0 10px;min-height:20px}.lex-status{min-height:20px;font-size:13px;line-height:1.45;margin:7px 0 0;overflow-wrap:anywhere}.lex-status.error{color:#a12424}.lex-status.success{color:#23673d}
.lex-table-wrap{overflow-x:auto;border:1px solid #d5d9d2;border-radius:6px;background:#fff}.lex-table{border-collapse:collapse;width:100%;min-width:960px;text-align:left;table-layout:fixed}.lex-table th{background:#eeeee7;font-size:12px;font-weight:600;color:#4d5950;padding:10px 12px}.lex-table td{padding:12px;vertical-align:top;border-top:1px solid #e0e3dc;overflow-wrap:anywhere}.lex-table th:nth-child(1){width:16%}.lex-table th:nth-child(2){width:11%}.lex-table th:nth-child(3){width:29%}.lex-table th:nth-child(4){width:24%}.lex-table th:nth-child(5){width:20%}.lex-table tr[data-status="missing"] td:first-child{box-shadow:inset 3px 0 #b9802d}.lex-table tr[data-status="explicit"] td:first-child{box-shadow:inset 3px 0 #4d8b5e}.lex-word{font-weight:650;font-size:16px;color:#243a2d}.lex-kind{font-size:12px;color:#727b75;margin-top:5px}.lex-badge{display:inline-block;border-radius:3px;padding:4px 6px;background:#e6eee7;color:#2c603b;font-size:12px;line-height:1.3}.lex-badge.missing{background:#faead5;color:#805515}.lex-badge.derived{background:#e6edf1;color:#436374}.lex-badge.inherent{background:#efefeb;color:#62675d}.lex-source{font-size:12px;line-height:1.45;color:#646b65}.lex-example{display:block;width:100%;min-width:0;margin-top:8px;padding:6px;background:#f7f7f3;border:1px solid #d5d9d2;border-radius:3px;color:#4e5850;font-size:12px;text-overflow:ellipsis}.lex-example-text{font-size:12px;line-height:1.45;margin:6px 0 0;color:#646b65}.lex-stress{box-sizing:border-box;width:100%;min-height:36px;padding:7px 8px;border:1px solid #aeb6af;border-radius:4px;background:#fff}.lex-stress[aria-invalid="true"]{border-color:#b9463c}.lex-accent{font-size:12px;margin-top:6px;color:#4d6253;min-height:18px}.lex-accent strong{font-size:14px;color:#203e2b}.lex-actions{display:flex;flex-wrap:wrap;gap:6px}.lex-actions button{font-size:12px;min-height:34px;padding:6px 9px;border:1px solid #a9b3aa;border-radius:4px;background:#fff;color:#263d30}.lex-actions button:first-child{background:#263d30;border-color:#263d30;color:#fff}.lex-player{display:block;width:100%;max-width:250px;margin-top:8px;height:32px}.lex-pages{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}.lex-pages span{font-size:13px;color:#626b65}.lex-add{margin-top:24px;padding:16px 18px;background:#eeeee7;border-radius:6px}.lex-add summary{cursor:pointer;font-weight:600;color:#263d30}.lex-add form{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px;margin-top:14px}.lex-add label{display:flex;flex-direction:column;gap:5px;flex:1;min-width:220px;font-size:13px}.lex-add .lex-help{margin-top:12px;font-size:13px}.lex-empty{padding:36px!important;text-align:center;color:#626b65}.lex-refresh{white-space:nowrap}
@media(max-width:760px){header{padding:12px;gap:10px}.studio-tabs{margin-left:auto}.studio-tabs button{padding:7px 12px}main,#lexicon{padding:14px 12px}.lex-head{display:block}.lex-coverage{justify-content:flex-start;margin-top:14px;max-width:none}.lex-tools{gap:10px}.lex-tools label{flex:1 1 calc(50% - 10px);min-width:140px}.lex-tools select{min-width:0;width:100%}.lex-search{flex-basis:100%!important}.lex-pages{flex-wrap:wrap}.lex-pages span{order:3;width:100%;text-align:center}.row{grid-template-columns:24px 1fr}.row>div:last-child{grid-column:2}.say{flex-wrap:wrap}.say input{min-width:160px}.take{flex-wrap:wrap}}
</style>
<body data-tab="records"><header>
 <b>Студия предзаписи</b>
 <nav class="studio-tabs" aria-label="Разделы студии" role="tablist"><button id="tab-records" role="tab" aria-selected="true" aria-controls="list">Записи</button><button id="tab-debrief" role="tab" aria-selected="false" aria-controls="list" tabindex="-1">Итоги</button><button id="tab-lexicon" role="tab" aria-selected="false" aria-controls="lexicon" tabindex="-1">Словарь</button></nav>
 <div class="recording-controls">
 <label>Модель озвучки <select id="engine"></select></label><button id="setEngine">Сменить</button>
 <label title="Как модель понимает ударение — проверьте на слух и выберите">Ударение для модели <select id="mark"><option value="acute">знак над гласной (а́)</option><option value="plus">плюс перед гласной (+а)</option><option value="upper">заглавная гласная (А)</option></select></label>
 <button id="restress">Переозвучить по словарю</button>
 <div class="debrief-controls"><label>Голос <select id="debrief-voice"><option value="zhukov-14s">Жуков</option><option value="konev-12s">Конев</option></select></label><label>Поиск <input id="debrief-search" type="search" placeholder="Текст реплики"></label></div>
 <label>Показать <select id="filter"><option value="all">все</option><option value="bad">не прошли проверку</option><option value="todo">не одобренные</option></select></label>
 <span id="count"></span></div><span id="status"></span>
</header>
<main id="list" role="tabpanel" aria-labelledby="tab-records"></main>
<section id="lexicon" role="tabpanel" aria-labelledby="tab-lexicon" hidden>
 <div class="lex-head"><div><h1>Словарь произношения</h1><p class="lex-help">Поставьте <code>+</code> перед ударной гласной: <code>Торг+ау</code>. Прослушайте слово или фразу, затем сохраните нужное произношение.</p><p class="lex-help">Сохранённые ударения используются при новой озвучке. Готовые записи обновляются кнопкой «Переозвучить по словарю». В установленном приложении словарь обновляется вместе с новой сборкой.</p></div><div id="lex-coverage" class="lex-coverage" aria-label="Покрытие словаря"></div></div>
 <div class="lex-tools"><label class="lex-search">Поиск<input id="lex-search" type="search" placeholder="Слово, название или источник" autocomplete="off"></label><label>Ударение<select id="lex-status-filter"><option value="missing">Без ударения</option><option value="explicit">Задано</option><option value="derived">По форме</option><option value="all">Все</option></select></label><label>Тип<select id="lex-kind-filter"><option value="all">Все типы</option><option value="place">Названия</option><option value="word">Слова</option></select></label><label>Голос проверки<select id="lex-preview-voice"><option value="">Начальник штаба</option><option value="zhukov-14s">Жуков</option><option value="konev-12s">Конев</option></select></label><button id="lex-refresh" class="lex-refresh" type="button">Обновить</button><button id="lex-add-open" type="button">Добавить слово</button></div>
 <p id="lex-results" class="lex-results" role="status" aria-live="polite">Словарь ещё не загружен</p>
 <div class="lex-table-wrap"><table class="lex-table"><thead><tr><th scope="col">Слово</th><th scope="col">Ударение</th><th scope="col">Где встречается</th><th scope="col">Произношение</th><th scope="col">Проверка и сохранение</th></tr></thead><tbody id="lex-rows"></tbody></table></div>
 <nav class="lex-pages" aria-label="Страницы словаря"><button id="lex-prev" type="button">← Назад</button><span id="lex-page-label"></span><button id="lex-next" type="button">Далее →</button></nav>
 <details class="lex-add"><summary>Добавить слово или название</summary><form id="lex-add-form"><label>Слово<input id="lex-add-word" required autocomplete="off" placeholder="Торгау"></label><label>Произношение · необязательно<input id="lex-add-say" autocomplete="off" placeholder="Торг+ау"></label><button type="submit">Добавить в словарь</button></form><p class="lex-help">Если ударение пока неизвестно, оставьте произношение пустым. Слово появится в списке «Без ударения».</p><p id="lex-add-message" class="lex-status" role="status" aria-live="polite"></p></details>
</section>
<script>
const $ = (s) => document.querySelector(s);
let st = null;
let loadVersion = 0;
const debriefVoice = () => document.body.dataset.tab === 'debrief' ? $('#debrief-voice').value : undefined;
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
  return '<div class="take' + (main ? ' main' : '') + '"><audio controls preload="none" src="/' + (debriefVoice() ? 'debrief-clips' : 'clips') + '/' + t.file + '"></audio>'
    + (t.ok === undefined ? '' : t.ok ? '✓ ' : '✗ ') + (t.ms / 1000).toFixed(1) + ' с' + (t.wer === undefined ? '' : ' · WER ' + t.wer) + (t.engine ? ' · ' + esc(t.engine) : '')
    + (main ? ' · основной' : ' <button data-pick="' + t.file + '" data-text="' + esc(text) + '">Выбрать</button>') + '</div>';
}
function render() {
  if (!st) return;
  const debrief = debriefVoice();
  const f = $('#filter').value;
  const search = debrief ? $('#debrief-search').value.trim().toLocaleLowerCase('ru') : '';
  const items = Object.entries(st.clips).filter(([text, c]) => text.toLocaleLowerCase('ru').includes(search)
    && (f === 'all' || (f === 'bad' ? c.ok === false : !c.approved)));
  const missing = f === 'all' ? (st.missing || []) : [];
  $('#count').textContent = (items.length + missing.length) + ' из ' + (Object.keys(st.clips).length + (st.missing || []).length);
  const samples = (st.samples || []).map((name) => '<p>' + esc(name) + '<br><audio controls preload="none" src="/samples/' + encodeURIComponent(name) + '"></audio></p>').join('');
  const gap = missing.map((text) => '<div class="row bad"><div>—</div><div>' + esc(text) + '<div class="meta">записи нет</div></div><div><button data-regen="' + esc(text) + '">Озвучить</button></div></div>').join('');
  const help = debrief ? '<p class="meta">Предзапись итогового разбора. Прослушайте новый дубль и нажмите «Выбрать», чтобы включить его в следующую сборку.'
    + (st.engine !== 'qwen3-ru-stress' ? ' Для нового дубля выберите Qwen3-TTS с ударениями.' : '') + '</p>' : '';
  const empty = debrief && !items.length ? '<p>По выбранным условиям записей нет.</p>' : '';
  $('#list').innerHTML = help + empty + (samples ? '<h2>Склейки</h2>' + samples : '') + gap + items.map(([text, c], i) => '<div class="row ' + (c.ok === false ? 'bad' : c.approved ? 'ok-approved' : '') + '">'
    + '<div>' + (i + 1) + '</div><div>' + esc(text)
    + (st.voiceOf && st.voiceOf[text] ? '<div class="meta">голос ' + esc(st.voiceOf[text]) + '</div>' : '')
    + (c.say && c.say !== text ? '<div class="meta">в синтез: ' + esc(c.say) + '</div>' : '')
    + (c.heard ? '<div class="meta">услышано: ' + esc(c.heard) + '</div>' : '')
    + '<div class="say"><input data-say="' + esc(text) + '" value="' + esc(c.override ? (c.say || toPlus(c.said)) : (st.dictSay?.[text] || c.say || toPlus(c.said))) + '" title="«+» перед ударной гласной: Х+альбе. Поле — текущий словарь, если текст не задан вручную.">'
    + '<button data-own="' + esc(text) + '">Озвучить этот текст</button><button data-dict="' + esc(text) + '">Ударения → в словарь</button></div>'
    + '<label class="meta"><input type="checkbox" data-approve="' + esc(text) + '"' + (c.approved ? ' checked' : '') + '> одобрено</label></div>'
    + '<div>' + take(text, c, true) + (c.takes || []).map((t) => take(text, t, false)).join('')
    + '<button data-regen="' + esc(text) + '">Ещё дубль (' + esc(st.engine) + ')</button></div></div>').join('');
}
async function load() {
  if (document.body.dataset.tab === 'lexicon') return;
  const version = ++loadVersion;
  const voice = debriefVoice();
  const state = await api('/api/state' + (voice ? '?debrief=' + voice : ''));
  if (version !== loadVersion || voice !== debriefVoice() || document.body.dataset.tab === 'lexicon') return;
  st = state;
  $('#engine').innerHTML = st.engines.map((e) => '<option value="' + e.id + '"' + (e.id === st.engine ? ' selected' : '') + ' title="' + esc(e.note) + '">' + esc(e.title) + '</option>').join('');
  $('#mark').value = st.mark;
  $('#restress').textContent = 'Переозвучить по словарю (' + st.affected + ')';
  $('#restress').disabled = !st.affected || !!st.busy;
  status(st.busy || ('сейчас: ' + st.engine + (st.engine !== st.live ? ' (живой голос вернётся к ' + st.live + ' при выходе)' : '')));
  render();
  if (st.busy) setTimeout(load, 3000);
}
function refreshCatalog() {
  st = null;
  $('#list').textContent = 'Загружаем записи…';
  $('#count').textContent = '';
  void load();
}
$('#debrief-voice').onchange = refreshCatalog;
$('#debrief-search').oninput = render;
$('#mark').onchange = async () => { await api('/api/stress/mark', { mark: $('#mark').value }); load(); };
$('#restress').onclick = async () => { await api('/api/restress', {}); load(); };
$('#filter').onchange = render;
$('#setEngine').onclick = async () => { status('загружаю модель… (до нескольких минут)'); await api('/api/engine', { id: $('#engine').value }).catch(() => {}); load(); };
async function requestTake(button, data) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'озвучиваю…';
  try { await api('/api/regen', data); }
  catch {
    button.disabled = false;
    button.textContent = label;
    return;
  }
  load();
}
document.addEventListener('click', async (e) => {
  const b = e.target;
  const debrief = debriefVoice();
  if (b.dataset.regen) await requestTake(b, { text: b.dataset.regen, debrief });
  if (b.dataset.pick) { await api('/api/pick', { text: b.dataset.text, file: b.dataset.pick, debrief }).catch(() => {}); load(); }
  if (b.dataset.own) await requestTake(b, { text: b.dataset.own, say: sayOf(b.dataset.own), debrief });
  if (b.dataset.dict) {
    const r = await api('/api/stress/word', { say: sayOf(b.dataset.dict) });
    alert(r.added.length ? 'В словарь: ' + r.added.join(', ') + '. «Переозвучить по словарю» — все фразы с этими словами.' : 'Нет слов с «+» перед гласной');
    load();
  }
});
document.addEventListener('change', async (e) => {
  const b = e.target;
  if (b.dataset.approve) { await api('/api/approve', { text: b.dataset.approve, on: b.checked, debrief: debriefVoice() }).catch(() => {}); load(); }
});
load();
// Словарь изолирован от существующих обработчиков записей.
(() => {
  const PAGE_SIZE = 80;
  const labels = { missing: 'Без ударения', explicit: 'Задано', derived: 'По форме', inherent: 'Однозначно' };
  const drafts = new Map(), messages = new Map(), examples = new Map(), previews = new Map(), saving = new Set();
  let data = null, page = 0, loading = false, loadVersion = 0, previewWord = null;
  const normalize = text => String(text).normalize('NFC').replace(/[+\\u0301]/g, '').toLocaleLowerCase('ru');
  const containsWord = (text, word) => {
    const source = normalize(text), needle = normalize(word);
    for (let i = source.indexOf(needle); i >= 0; i = source.indexOf(needle, i + 1)) {
      if (!/\\p{L}/u.test(source[i - 1] || '') && !/\\p{L}/u.test(source[i + needle.length] || '')) return true;
    }
    return false;
  };
  const draftOf = entry => drafts.has(entry.word) ? drafts.get(entry.word) : toPlus(entry.say || entry.suggestion || entry.word);
  const message = (node, text, kind) => { node.textContent = text; node.className = 'lex-status' + (kind ? ' ' + kind : ''); };
  async function lexApi(path, body) {
    const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let result;
    try { result = await r.json(); } catch { throw new Error('Сервис вернул неполный ответ. Повторите запрос.'); }
    if (!r.ok || result.error) throw new Error(result.error || (r.status === 409 ? 'Озвучка занята. Дождитесь окончания и попробуйте снова.' : 'Не удалось выполнить запрос (' + r.status + ')'));
    return result;
  }
  function valid(word, say) {
    if (!word.trim()) return 'Введите слово или название.';
    if (!say.trim()) return '';
    if (normalize(word.trim()) !== normalize(say.trim())) return 'В произношении должно быть то же слово, только с пометкой ударения.';
    if (/\\+(?![аеёиоуыэюя])/i.test(say)) return 'Поставьте «+» перед ударной гласной.';
    if (/(^|[^аеёиоуыэюя])\\u0301/i.test(say)) return 'Знак ударения должен стоять после гласной.';
    return '';
  }
  function accentHtml(say) {
    if (!say) return 'Ударение не указано';
    const plus = toPlus(say);
    if (!/\\+[аеёиоуыэюя]/i.test(plus)) return esc(plus);
    return esc(plus).replace(/\\+([аеёиоуыэюя])/gi, '<strong>$1́</strong>');
  }
  function filtered() {
    if (!data) return [];
    const q = normalize($('#lex-search').value.trim());
    const status = $('#lex-status-filter').value, kind = $('#lex-kind-filter').value;
    return data.entries.filter(entry => (status === 'all' || entry.status === status) && (kind === 'all' || entry.kind === kind)
      && (!q || normalize(entry.word + ' ' + (entry.say || '') + ' ' + entry.sources.join(' ')).includes(q)));
  }
  const rowFor = word => Array.from($('#lex-rows').rows).find(row => row.dataset.word === word);
  function markRow(word, text, kind) {
    messages.set(word, { text, kind });
    const row = rowFor(word);
    if (row) message(row.querySelector('.lex-status'), text, kind);
  }
  function coverage() {
    if (!data) return;
    const c = data.coverage;
    $('#lex-coverage').innerHTML = [['total', 'всего'], ['explicit', 'задано'], ['derived', 'по форме'], ['inherent', 'однозначно'], ['missing', 'без ударения']]
      .map(([key, title]) => '<span class="' + key + '"><strong>' + esc(c[key] || 0) + '</strong>' + title + '</span>').join('');
  }
  function renderLex() {
    const all = filtered(), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    const items = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    $('#lex-results').textContent = loading ? 'Загружаем словарь…' : 'Найдено: ' + all.length + (data ? ' из ' + data.entries.length : '');
    $('#lex-page-label').textContent = all.length ? (page * PAGE_SIZE + 1) + '–' + Math.min((page + 1) * PAGE_SIZE, all.length) + ' · страница ' + (page + 1) + ' из ' + pages : 'Нет слов по выбранным условиям';
    $('#lex-prev').disabled = page === 0 || loading;
    $('#lex-next').disabled = page + 1 >= pages || loading;
    $('#lex-rows').innerHTML = items.length ? items.map((entry, i) => {
      const value = draftOf(entry), info = messages.get(entry.word), audio = previews.get(entry.word);
      const options = (entry.examples || []).filter(text => containsWord(text, entry.word));
      const ex = options.includes(examples.get(entry.word)) ? examples.get(entry.word) : '';
      const source = (entry.sources || []).join(' · ') || 'Добавлено вручную';
      const hint = !entry.say && entry.suggestion ? ' · Подсказка, проверьте и сохраните' : !entry.say ? ' · Укажите ударение вручную' : '';
      const id = 'lex-stress-' + i;
      return '<tr data-word="' + esc(entry.word) + '" data-status="' + esc(entry.status) + '"><td><div class="lex-word">' + esc(entry.word) + '</div><div class="lex-kind">' + (entry.kind === 'place' ? 'Название' : 'Слово') + '</div></td>'
        + '<td><span class="lex-badge ' + esc(entry.status) + '">' + esc(labels[entry.status] || entry.status) + '</span></td>'
        + '<td><div class="lex-source">' + esc(source) + '</div><select class="lex-example" aria-label="Что прослушать: ' + esc(entry.word) + '"><option value="">Только слово</option>'
        + options.map(text => '<option value="' + esc(text) + '"' + (ex === text ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select><p class="lex-example-text"' + (ex ? '' : ' hidden') + '>' + esc(ex) + '</p></td>'
        + '<td><input id="' + id + '" class="lex-stress" aria-label="Ударение: ' + esc(entry.word) + '" aria-describedby="' + id + '-hint" autocomplete="off" spellcheck="false" value="' + esc(value) + '" placeholder="Без пометки"><div id="' + id + '-hint" class="lex-accent">' + accentHtml(value) + esc(hint) + '</div></td>'
        + '<td><div class="lex-actions"><button type="button" data-lex-save' + (saving.has(entry.word) ? ' disabled' : '') + '>' + (saving.has(entry.word) ? 'Сохраняем…' : 'Сохранить') + '</button><button type="button" data-lex-preview' + (previewWord ? ' disabled' : '') + '>' + (previewWord === entry.word ? 'Синтез…' : 'Прослушать') + '</button></div>'
        + '<p class="lex-status' + (info && info.kind ? ' ' + info.kind : '') + '" role="status" aria-live="polite">' + (info ? esc(info.text) : '') + '</p>'
        + (audio ? '<audio class="lex-player" controls preload="none" aria-label="Произношение: ' + esc(entry.word) + '" src="' + esc(audio) + '"></audio>' : '') + '</td></tr>';
    }).join('') : '<tr><td class="lex-empty" colspan="5">' + (loading ? 'Загружаем словарь…' : data ? 'Таких слов нет. Измените поиск или фильтры.' : 'Не удалось загрузить словарь. Нажмите «Обновить».') + '</td></tr>';
  }
  async function loadLex() {
    const version = ++loadVersion;
    loading = true;
    $('#lex-refresh').disabled = true;
    renderLex();
    try {
      const next = await lexApi('/api/lexicon');
      if (version !== loadVersion) return;
      data = next;
      data.entries.sort((a, b) => a.word.localeCompare(b.word, 'ru'));
      loading = false;
      coverage(); renderLex();
    } catch (error) {
      if (version !== loadVersion) return;
      loading = false;
      renderLex();
      $('#lex-results').textContent = error.message;
      throw error;
    } finally { if (version === loadVersion) $('#lex-refresh').disabled = false; }
  }
  const tabs = ['records', 'debrief', 'lexicon'];
  function selectTab(tab, focus = false) {
    const changed = tab !== document.body.dataset.tab;
    document.body.dataset.tab = tab;
    $('#list').hidden = tab === 'lexicon'; $('#lexicon').hidden = tab !== 'lexicon';
    if (tab !== 'lexicon') $('#list').setAttribute('aria-labelledby', 'tab-' + tab);
    for (const name of tabs) {
      const button = $('#tab-' + name), selected = name === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    if (focus) $('#tab-' + tab).focus();
    if (tab === 'lexicon' && !data && !loading) void loadLex().catch(() => {});
    if (changed && tab !== 'lexicon') { $('#filter').value = 'all'; refreshCatalog(); }
  }
  for (const [i, name] of tabs.entries()) {
    const button = $('#tab-' + name);
    button.onclick = () => selectTab(name);
    button.onkeydown = event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); selectTab(event.key === 'Home' ? 'records' : event.key === 'End' ? 'lexicon' : tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
      }
    };
  }
  $('#lex-search').oninput = () => { page = 0; renderLex(); };
  $('#lex-status-filter').onchange = $('#lex-kind-filter').onchange = () => { page = 0; renderLex(); };
  $('#lex-refresh').onclick = () => { void loadLex().catch(() => {}); };
  $('#lex-add-open').onclick = () => {
    $('.lex-add').open = true;
    $('.lex-add').scrollIntoView({ block: 'center' });
    $('#lex-add-word').focus({ preventScroll: true });
  };
  $('#lex-prev').onclick = () => { page--; renderLex(); };
  $('#lex-next').onclick = () => { page++; renderLex(); };
  $('#lex-rows').addEventListener('input', event => {
    if (!event.target.matches('.lex-stress')) return;
    const row = event.target.closest('tr'), value = event.target.value;
    drafts.set(row.dataset.word, value);
    event.target.removeAttribute('aria-invalid');
    row.querySelector('.lex-accent').innerHTML = accentHtml(value);
    markRow(row.dataset.word, 'Изменения не сохранены', '');
  });
  $('#lex-rows').addEventListener('change', event => {
    if (!event.target.matches('.lex-example')) return;
    const row = event.target.closest('tr'), text = event.target.value;
    examples.set(row.dataset.word, text);
    const paragraph = row.querySelector('.lex-example-text'); paragraph.textContent = text; paragraph.hidden = !text;
  });
  $('#lex-rows').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('.lex-stress')) { event.preventDefault(); event.target.closest('tr').querySelector('[data-lex-save]').click(); }
  });
  $('#lex-rows').addEventListener('click', async event => {
    const button = event.target.closest('[data-lex-save],[data-lex-preview]');
    if (!button) return;
    const row = button.closest('tr'), word = row.dataset.word, input = row.querySelector('.lex-stress'), say = input.value.trim();
    const error = valid(word, say);
    if (error) { input.setAttribute('aria-invalid', 'true'); markRow(word, error, 'error'); input.focus(); return; }
    if (button.hasAttribute('data-lex-save')) {
      if (saving.has(word)) return;
      saving.add(word); button.disabled = true; button.textContent = 'Сохраняем…'; markRow(word, '', '');
      try {
        await lexApi('/api/lexicon/entry', { word, say });
        drafts.delete(word); messages.set(word, { text: 'Сохранено в словаре', kind: 'success' });
        await loadLex();
        $('#lex-results').textContent += ' · Сохранено: ' + word;
        if (st) void load();
      } catch (error) { markRow(word, error.message, 'error'); }
      finally { saving.delete(word); const current = rowFor(word)?.querySelector('[data-lex-save]'); if (current) { current.disabled = false; current.textContent = 'Сохранить'; } }
    } else {
      if (previewWord) return;
      previewWord = word;
      for (const b of document.querySelectorAll('[data-lex-preview]')) b.disabled = true;
      button.textContent = 'Синтез…'; markRow(word, 'Готовим пробу произношения…', '');
      try {
        const selected = examples.get(word);
        const text = selected && containsWord(selected, word) ? selected : selected ? 'Проверяем произношение: ' + word + '.' : undefined;
        const voiceId = $('#lex-preview-voice').value;
        const result = await lexApi('/api/lexicon/preview', { word, say, ...(text ? { text } : {}), ...(voiceId ? { voiceId } : {}) });
        if (!result.url) throw new Error('Не получен звуковой файл. Повторите прослушивание.');
        previews.set(word, result.url);
        const current = rowFor(word);
        if (current) {
          current.querySelector('audio')?.remove();
          const audio = document.createElement('audio'); audio.className = 'lex-player'; audio.controls = true; audio.src = result.url; audio.setAttribute('aria-label', 'Произношение: ' + word); current.lastElementChild.append(audio);
          markRow(word, 'Проба готова', 'success');
          await audio.play().catch(() => markRow(word, 'Проба готова. Нажмите кнопку воспроизведения.', 'success'));
        }
      } catch (error) { markRow(word, error.message, 'error'); }
      finally { previewWord = null; for (const b of document.querySelectorAll('[data-lex-preview]')) { b.disabled = false; b.textContent = 'Прослушать'; } }
    }
  });
  $('#lex-add-form').onsubmit = async event => {
    event.preventDefault();
    const word = $('#lex-add-word').value.trim(), say = $('#lex-add-say').value.trim(), node = $('#lex-add-message'), button = event.target.querySelector('button');
    const error = valid(word, say);
    if (error) { message(node, error, 'error'); return; }
    button.disabled = true; message(node, 'Добавляем…', '');
    try {
      await lexApi('/api/lexicon/entry', { word, say });
      $('#lex-search').value = word; $('#lex-status-filter').value = 'all'; $('#lex-kind-filter').value = 'all'; page = 0;
      await loadLex();
      event.target.reset(); message(node, 'Добавлено в словарь: ' + word + (say ? '' : '. Ударение пока не задано.'), 'success');
      if (st) void load();
    } catch (error) { message(node, error.message, 'error'); }
    finally { button.disabled = false; }
  };
})();
</script></body></html>`;
