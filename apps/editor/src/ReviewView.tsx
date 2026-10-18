/**
 * Разбор операции: отчётный документ по сыгранной игре. Модель пишет разделы по очереди от лица экспертов
 * (командующий, разведка, тыл, инженерные войска, начальник штаба, Ставка, военный историк) и итог с оценкой;
 * текст виден по мере написания, любой раздел можно переписать. Документ сохраняется в браузере (для этой игры)
 * и сохраняется файлом PDF или Markdown (в настольном приложении — в «Загрузки»), печатается.
 *
 * Голосом и кнопками — одни действия (voice/actions/turn.ts): «составь разбор», «прочитай итоговую оценку», «останови
 * разбор», «сохрани разбор», «закрой разбор»; окно отдаёт управление разбором через ctl, пока смонтировано.
 */
import { say } from './dialogs';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { REVIEW_SECTIONS } from '@def-ops/staff-service/live';
import type { GameRequest, GameResponse, TurnView } from './sim/game-protocol';
import type { Llm } from './shared';
import { ModelPicker } from './ModelPicker';
import { mdToHtml, unfence } from './markdown';
import { reviewPdfBlob } from './reviewPdf';
import { act, useAction } from './voice/registry';
import type { ReviewCtl } from './voice/actions/turn';

type Status = 'idle' | 'wait' | 'writing' | 'done' | 'error';
interface Sec { text: string; status: Status; note?: string; thinking?: string; model?: string; seconds?: number }
type ReviewMsg = Extract<GameResponse, { kind: 'review-stream' | 'review-wait' | 'review-think' | 'review-done' }>;

const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}`;
const keyOf = (v: TurnView) => `def_ops.review:${v.scenario}:${v.takeover}:${v.seed}`;
const load = (v: TurnView): Record<string, Sec> => { try { return JSON.parse(localStorage.getItem(keyOf(v)) || '{}'); } catch { return {}; } };

export function ReviewView({ view, llm, send, listen, ctl }: {
  view: TurnView; llm: Llm; send: (m: GameRequest) => void; listen: (f: ((m: ReviewMsg) => void) | null) => void;
  /** Управление разбором для голоса (пока окно смонтировано). */
  ctl: MutableRefObject<ReviewCtl | null>;
}) {
  const [secs, setSecs] = useState<Record<string, Sec>>(() => load(view));
  const [pick, setPick] = useState<Set<string>>(() => new Set(REVIEW_SECTIONS.map((s) => s.id)));
  const [running, setRunningState] = useState(false);
  const runningRef = useRef(false);
  const setRunning = (on: boolean) => { runningRef.current = on; setRunningState(on); };
  const pickRef = useRef(pick); pickRef.current = pick;
  const stopRef = useRef(false);
  const waiters = useRef(new Map<number, { section: string; resolve: (ok: boolean) => void }>());
  const idRef = useRef(0);
  const secsRef = useRef(secs);
  secsRef.current = secs;

  useEffect(() => { try { localStorage.setItem(keyOf(view), JSON.stringify(Object.fromEntries(Object.entries(secs).filter(([, s]) => s.status === 'done')))); } catch { /* */ } }, [secs, view]);
  useEffect(() => {
    listen((m) => {
      const w = waiters.current.get(m.id);
      if (!w) return;
      const up = (f: (s: Sec) => Sec) => setSecs((all) => ({ ...all, [w.section]: f(all[w.section] ?? { text: '', status: 'idle' }) }));
      if (m.kind === 'review-wait') up((s) => ({ ...s, status: 'wait', note: m.text }));
      else if (m.kind === 'review-think') up((s) => ({ ...s, status: 'wait', note: undefined, thinking: (s.thinking ?? '') + m.text }));
      else if (m.kind === 'review-stream') up((s) => ({ ...s, status: 'writing', note: undefined, text: (s.status === 'writing' ? s.text : '') + m.text }));
      else {
        up((s) => (m.ok ? { text: m.text, status: 'done', thinking: s.thinking, model: m.model, seconds: m.seconds } : { ...s, status: 'error', note: m.error }));
        waiters.current.delete(m.id);
        w.resolve(m.ok);
      }
    });
    return () => listen(null);
  }, [listen]);

  const write = (section: string) => new Promise<boolean>((resolve) => {
    const id = ++idRef.current;
    waiters.current.set(id, { section, resolve });
    setSecs((all) => ({ ...all, [section]: { text: '', status: 'wait', note: 'в очереди…' } }));
    // для итога — уже написанные разделы
    const done = REVIEW_SECTIONS.filter((s) => s.id !== 'summary' && secsRef.current[s.id]?.status === 'done').map((s) => ({ title: s.title, text: secsRef.current[s.id].text }));
    send({ kind: 'review-section', id, section, done });
  });

  const run = async (ids: string[]) => {
    setRunning(true);
    stopRef.current = false;
    // итог — последним: ему нужны остальные разделы
    for (const id of [...ids.filter((x) => x !== 'summary'), ...ids.filter((x) => x === 'summary')]) {
      if (stopRef.current) break;
      await write(id);
    }
    setRunning(false);
  };
  const stop = () => { stopRef.current = true; send({ kind: 'review-stop' }); };
  const todo = REVIEW_SECTIONS.filter((s) => pick.has(s.id) && secs[s.id]?.status !== 'done').map((s) => s.id);
  const ready = REVIEW_SECTIONS.filter((s) => secs[s.id]?.status === 'done');
  /** Отмеченные и ещё не написанные — по свежему состоянию (голосом зовут вне отрисовки). */
  const todoNow = () => REVIEW_SECTIONS.filter((s) => pickRef.current.has(s.id) && secsRef.current[s.id]?.status !== 'done').map((s) => s.id);

  const markdown = (all = secsRef.current) => [
    `# Разбор операции: ${view.scenarioName}`, '',
    `Сторона: ${view.human.name}. Командование принято ${dm(view.takeover)}; разбор на ${dm(view.time)}.`,
    `Итог: ${view.outcome ? `${view.outcome.result === 'victory' ? 'победа' : 'поражение'} — ${view.outcome.text}` : 'игра не окончена'}.`, '',
    ...REVIEW_SECTIONS.filter((s) => all[s.id]?.status === 'done').flatMap((s) => [`## ${s.title}`, `*${s.role}*`, '', unfence(all[s.id].text), '']),
  ].join('\n');

  const [pdfBusy, setPdfBusy] = useState(false);
  /** Файл PDF разбора (собирается в окне). */
  const pdfFile = async (): Promise<Blob> => {
    setPdfBusy(true);
    const all = secsRef.current;
    const done = REVIEW_SECTIONS.filter((s) => all[s.id]?.status === 'done');
    try {
      return await reviewPdfBlob({
        scenario: view.scenarioName, side: view.human.name, enemy: view.ai.name, takeover: dm(view.takeover), at: `${dm(view.time)}, ход ${view.turn - 1}`,
        outcome: view.outcome ? { result: view.outcome.result, text: view.outcome.text } : null,
        strength: `${Math.round(view.strength * 100)} % численности на момент принятия командования`,
        goals: view.goals.map((g) => ({ title: g.title, game: g.simulated ? dm(g.simulated).slice(0, 5) : '—', history: dm(g.historical).slice(0, 5) })),
        sections: done.map((s) => ({ title: s.title, role: s.role, text: all[s.id].text })),
        models: [...new Set(done.map((s) => all[s.id].model).filter(Boolean))].join(', '),
      });
    } catch (e) {
      void say(`Не удалось собрать PDF: ${(e as Error).message}`);
      throw e;
    } finally { setPdfBusy(false); }
  };
  // управление для голоса: составить, остановить, разделы, файлы
  const api = useRef<ReviewCtl>(null!);
  api.current = {
    sections: () => REVIEW_SECTIONS.map((s) => ({ id: s.id, title: s.title, done: secsRef.current[s.id]?.status === 'done', text: secsRef.current[s.id]?.text ?? '' })),
    running: () => runningRef.current,
    compose: (ids) => run(ids ?? todoNow()),
    stop, markdown: () => markdown(), pdf: pdfFile,
    name: (ext) => (ext === 'pdf' ? `razbor-${view.scenario}-${view.time.slice(0, 10)}.pdf` : `razbor-${view.scenario}.md`),
  };
  useEffect(() => {
    const c: ReviewCtl = {
      sections: () => api.current.sections(), running: () => api.current.running(), compose: (ids) => api.current.compose(ids), stop: () => api.current.stop(),
      markdown: () => api.current.markdown(), pdf: () => api.current.pdf(), name: (e) => api.current.name(e),
    };
    ctl.current = c;
    return () => { if (ctl.current === c) ctl.current = null; };
  }, [ctl]);
  useAction({ id: 'command.review.pick', model: false, section: 'replay', title: 'Отметить раздел разбора', describe: 'Отмечает раздел разбора (section — id) для написания или снимает отметку (on).',
    params: { type: 'object', properties: { section: { type: 'string' }, on: { type: 'boolean' } }, required: ['section'] },
    available: () => (runningRef.current ? 'разбор пишется — отметки после него' : true),
    run: async (p: { section: string; on?: boolean }) => {
      const s = REVIEW_SECTIONS.find((x) => x.id === p?.section);
      if (!s) return 'Такого раздела нет.';
      setPick((cur) => { const n = new Set(cur); if (p.on ?? !cur.has(s.id)) n.add(s.id); else n.delete(s.id); return n; });
    } });
  const pdf = () => {
    const w = window.open('', '_blank');
    if (!w) { void say('Окно печати не открылось — сохраните разбор кнопкой «Скачать PDF» (в браузере — или разрешите всплывающие окна для этой страницы).'); return; }
    const goals = view.goals.map((g) => `<tr><td>${esc(g.title)}</td><td>${g.simulated ? dm(g.simulated).slice(0, 5) : '—'}</td><td>${dm(g.historical).slice(0, 5)}</td></tr>`).join('');
    const models = [...new Set(ready.map((s) => secs[s.id].model).filter(Boolean))].join(', ');
    w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Разбор операции — ${esc(view.scenarioName)}</title><style>${PRINT_CSS}</style></head><body>
<section class="title"><div class="kicker">Отчётный документ</div><h1>Разбор операции</h1><div class="sub">${esc(view.scenarioName)}</div>
<table class="meta"><tr><th>Сторона</th><td>${esc(view.human.name)}</td></tr><tr><th>Противник</th><td>${esc(view.ai.name)}</td></tr>
<tr><th>Командование принято</th><td>${dm(view.takeover)}</td></tr><tr><th>Разбор на</th><td>${dm(view.time)}, ход ${view.turn - 1}</td></tr>
<tr><th>Итог</th><td>${view.outcome ? `<b>${view.outcome.result === 'victory' ? 'Победа' : 'Поражение'}</b> — ${esc(view.outcome.text)}` : 'игра не окончена'}</td></tr>
<tr><th>В строю</th><td>${Math.round(view.strength * 100)} % численности на момент принятия командования</td></tr></table>
<h3>Ключевые события</h3><table class="goals"><tr><th>Событие</th><th>В игре</th><th>В истории</th></tr>${goals}</table>
<ol class="toc">${ready.map((s) => `<li>${esc(s.title)} <span>— ${esc(s.role)}</span></li>`).join('')}</ol>
<div class="note">Разбор составлен языковой моделью${models ? ` (${esc(models)})` : ''} по записи игры ${new Date().toLocaleDateString('ru-RU')}. Оценки — мнение модели в роли экспертов, а не исторический факт.</div></section>
${ready.map((s, i) => `<section class="sec"><h2>${i + 1}. ${esc(s.title)}</h2><div class="role">${esc(s.role)}</div>${mdToHtml(secs[s.id].text)}</section>`).join('')}
<script>window.onload = () => setTimeout(() => window.print(), 300);</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="modal-bg" onClick={() => { void act('command.review.close'); }}>
      <div className="modal review" data-modal onClick={(e) => e.stopPropagation()}>
        <div className="rv-h">
          <div><h3>Разбор операции</h3><span className="muted">{view.scenarioName} · {view.outcome ? (view.outcome.result === 'victory' ? 'победа' : 'поражение') : `ход ${view.turn - 1}, игра не окончена`}</span></div>
          <button className="x" data-action="command.review.close" onClick={() => { void act('command.review.close'); }} title="Закрыть (разбор сохранится)">×</button>
        </div>
        <ModelPicker llm={llm} who="rev" purpose="разбора операции" />
        <div className="rv-body">
          <aside className="rv-list">
            <p className="muted">Модель разбирает ваши решения, приказы и распоряжения по записи игры — от лица экспертов. Разделы пишутся по очереди; итог — последним, по выводам экспертов.</p>
            {REVIEW_SECTIONS.map((s) => {
              const st = secs[s.id]?.status ?? 'idle';
              return (
                <label key={s.id} className={`rv-item ${st}`}>
                  <input type="checkbox" data-action="command.review.pick" checked={pick.has(s.id)} disabled={running} onChange={(e) => { void act('command.review.pick', { section: s.id, on: e.target.checked }); }} />
                  <span><b>{s.title}</b><small>{s.role}</small></span>
                  <i>{st === 'done' ? '✓' : st === 'writing' || st === 'wait' ? <span className="spinner" /> : st === 'error' ? '!' : ''}</i>
                </label>
              );
            })}
            <div className="rv-ctl">
              {running ? <button data-action="command.review.stop" onClick={() => { void act('command.review.stop'); }}>Остановить</button>
                : <button className="primary" data-action="command.review.compose" disabled={!todo.length} onClick={() => { void act('command.review.compose', {}); }}>{ready.length ? `Дописать (${todo.length})` : 'Составить разбор'}</button>}
              <button data-action="command.review.save" disabled={!ready.length || pdfBusy} onClick={() => { void act('command.review.save', { format: 'pdf' }); }} title="Сохранить файл PDF">{pdfBusy ? 'собираю PDF…' : 'Сохранить PDF'}</button>
              <button className="link" disabled={!ready.length} onClick={pdf} title="Открыть документ для печати">печать</button>
              <button className="link" data-action="command.review.save" disabled={!ready.length} onClick={() => { void act('command.review.save', { format: 'md' }); }}>.md</button>
            </div>
          </aside>
          <main className="rv-doc">
            {!Object.keys(secs).length && <div className="muted rv-empty">Выберите разделы слева и нажмите «Составить разбор». Каждый раздел — отдельный запрос к модели (с размышлением — дольше); пока модель пишет, разбор можно закрыть: он продолжится и сохранится.</div>}
            {REVIEW_SECTIONS.filter((s) => secs[s.id]).map((s, i) => {
              const x = secs[s.id];
              return (
                <section key={s.id} className="rv-sec">
                  <h2>{i + 1}. {s.title}<small>{s.role}</small>
                    {!running && x.status !== 'wait' && x.status !== 'writing' && <button className="link" data-action="command.review.compose" onClick={() => { void act('command.review.compose', { sections: [s.id] }); }}>переписать</button>}</h2>
                  {x.note && <div className="muted rv-note">{x.status === 'wait' && <span className="spinner" />} <span>{x.note}</span></div>}
                  {x.thinking && !x.text && x.status !== 'error' && <div className="rv-think">
                    <div className="rv-think-h"><span className="spinner" /> модель размышляет · {x.thinking.length.toLocaleString('ru')} знаков</div>
                    <div className="kb-think live">{x.thinking.slice(-700)}</div>
                  </div>}
                  {x.thinking && (x.text || x.status === 'error') && <details className="kb-think rv-think-done"><summary>размышление модели ({x.thinking.length.toLocaleString('ru')} знаков)</summary><div>{x.thinking}</div></details>}
                  {x.text && <div className="adv-md" dangerouslySetInnerHTML={{ __html: mdToHtml(x.text) }} />}
                  {x.status === 'done' && x.model && <small className="muted">{x.model} · {x.seconds} с</small>}
                </section>
              );
            })}
          </main>
        </div>
      </div>
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PRINT_CSS = `@page { size: A4; margin: 18mm 16mm; }
body { font: 11pt/1.5 'PT Serif', Georgia, serif; color: #1c1d1f; }
.title { page-break-after: always; }
.kicker { font: 600 9pt/1.2 sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #8c2a22; margin-top: 30mm; }
h1 { font-size: 28pt; margin: 4mm 0 2mm; } .sub { font-size: 14pt; color: #444; margin-bottom: 10mm; }
table { border-collapse: collapse; width: 100%; font-size: 10pt; margin: 3mm 0 6mm; }
th, td { text-align: left; vertical-align: top; padding: 1.5mm 2mm; border-bottom: 1px solid #ddd; } .meta th { width: 45mm; color: #555; font-weight: 600; }
.goals th { background: #f3f1ea; }
.toc { margin: 4mm 0; padding-left: 6mm; } .toc span { color: #777; font-size: 9.5pt; }
.note { margin-top: 10mm; font-size: 9pt; color: #777; border-top: 1px solid #ddd; padding-top: 3mm; }
h2 { font-size: 15pt; margin: 0 0 1mm; page-break-after: avoid; } .role { color: #777; font-style: italic; margin-bottom: 3mm; }
.sec { page-break-before: always; } h3 { font-size: 11.5pt; margin: 4mm 0 1mm; page-break-after: avoid; } h4 { font-size: 11pt; margin: 3mm 0 1mm; }
p { margin: 0 0 2mm; text-align: justify; } ul, ol { margin: 1mm 0 3mm; padding-left: 6mm; } li { margin: .5mm 0; }`;
