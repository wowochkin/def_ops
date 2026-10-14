/**
 * Итоги документа: сколько принято автоматически, на проверку, отброшено; отброшенное с причинами; принятое таблицей
 * со ссылками на записи; неразобранные части, строки с ошибкой и пропущенные столбцы таблицы; «Откатить документ» —
 * снимает автоматически принятые из него факты (принятые человеком остаются с пометкой «документ откачен»).
 */
import { useMemo, useState } from 'react';
import type { KbDocument } from '@def-ops/knowledge';
import { confirmAsync } from '../dialogs';
import { claimText, KIND_RU } from '../modeling/basis';
import { rollbackDocument } from './candidates';
import type { KbState } from './kb';
import { CHECK_RU, candDoc, docAccepted, docDropped } from './queue';

const STEP = 50;

export function DocumentResults({ d, s, open, onQueue }: { d: KbDocument; s: KbState; open?: (id: string) => void; onQueue?: () => void }) {
  const accepted = useMemo(() => docAccepted(s.entries, d.id), [s.entries, d.id]);
  const dropped = useMemo(() => docDropped(s.candidates, d.id), [s.candidates, d.id]);
  const waiting = useMemo(() => s.candidates.filter((c) => c.state === 'pending' && candDoc(c) === d.id).length, [s.candidates, d.id]);
  const [nA, setNA] = useState(STEP), [nD, setND] = useState(STEP);
  const [msg, setMsg] = useState<string | null>(null);
  const c = d.counts;
  const auto = accepted.filter((x) => x.fact.check?.by === 'auto' && !x.fact.check.docRolledBack).length;
  const human = accepted.filter((x) => x.fact.check?.by === 'human').length;
  const rollback = async () => {
    if (!await confirmAsync(`Откатить «${d.name}»?\n\nФакты, принятые из него автоматически (${auto}), будут сняты из базы и из модели. Принятые человеком (${human}) останутся с пометкой «документ откачен».`, { ok: 'Откатить', danger: true })) return;
    const r = await rollbackDocument(d.id);
    setMsg(`Снято фактов: ${r.removed}; оставлено с пометкой «документ откачен»: ${r.kept}.`);
  };
  const name = (id: string) => s.byId.get(id)?.title ?? id;
  return (
    <div className="dr">
      <div className="dr-counts">
        <span className="ok">принято автоматически <b>{c?.auto ?? 0}</b></span>
        <span className="review">на проверку <b>{c?.review ?? 0}</b>{onQueue && waiting > 0 && <> · <button className="link" onClick={onQueue}>ждут в очереди: {waiting}</button></>}</span>
        <span className="drop">отброшено <b>{c?.drop ?? 0}</b></span>
        {c?.duplicate ? <span className="muted">повторов (уже в базе или в очереди): {c.duplicate}</span> : null}
      </div>
      {d.failedParts?.length ? <p className="warn">Не разобраны (модель не ответила по схеме): {d.failedParts.map((i) => partName(d, i)).join(', ')}.</p> : null}
      {d.skippedColumns?.length ? <p className="muted">Пропущены несопоставленные столбцы: {d.skippedColumns.join(', ')}.</p> : null}
      {d.rowErrors?.length ? <details><summary>Строки с ошибкой · {d.rowErrors.length}</summary><ul className="dr-errs">{d.rowErrors.slice(0, 200).map((e) => <li key={e.row}>строка {e.row}: {e.why}</li>)}</ul></details> : null}

      {dropped.length > 0 && <details><summary>Отброшено и отклонено · {dropped.length}</summary>
        <table className="dr-t"><thead><tr><th>Вид</th><th>Значение</th><th>Причина</th></tr></thead><tbody>
          {dropped.slice(0, nD).map((x) => { const fails = x.checks.filter((r) => r.level === 'fail'); return <tr key={x.id}>
            <td>{x.claim ? KIND_RU[x.claim.kind] ?? x.claim.kind : 'запись'}</td><td>{x.value}</td>
            <td>{fails.length ? fails.map((r, i) => <div key={i}><b>{CHECK_RU[r.check]}:</b> {r.why ?? 'не прошло'}</div>) : <span className="muted">отклонено человеком</span>}</td></tr>; })}
        </tbody></table>
        {dropped.length > nD && <button className="link" onClick={() => setND(nD + STEP)}>ещё {dropped.length - nD}…</button>}
      </details>}

      {accepted.length > 0 && <details open={accepted.length <= 12}><summary>Принято в базу · {accepted.length}</summary>
        <table className="dr-t"><thead><tr><th>Вид</th><th>Значение</th><th>Запись</th><th>Как</th></tr></thead><tbody>
          {accepted.slice(0, nA).map(({ entry, index, fact }) => <tr key={`${entry.id}#${index}`} className={fact.check?.docRolledBack ? 'rolled' : ''}>
            <td>{fact.claim ? KIND_RU[fact.claim.kind] ?? fact.claim.kind : fact.key}</td>
            <td>{fact.claim ? claimText(fact.claim, name) : fact.value}</td>
            <td>{open ? <button className="link" onClick={() => open(entry.id)}>{entry.title}</button> : entry.title}</td>
            <td>{fact.check?.by === 'auto' ? 'авто' : 'человек'}{fact.check?.docRolledBack ? <i className="dr-rb" title="документ откачен — факт оставлен, потому что его принял человек"> документ откачен</i> : null}</td></tr>)}
        </tbody></table>
        {accepted.length > nA && <button className="link" onClick={() => setNA(nA + STEP)}>ещё {accepted.length - nA}…</button>}
      </details>}
      {!accepted.length && !dropped.length && !c && <p className="muted">Документ ещё не разбирался.</p>}

      {accepted.length > 0 && <div className="dr-act">
        <button className="danger-btn" disabled={!auto} title={auto ? '' : 'автоматически принятых фактов нет'} onClick={() => void rollback()}>Откатить документ</button>
        <span className="muted small">снимает принятое автоматически; принятое человеком остаётся с пометкой</span></div>}
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}

/** Часть документа по номеру в порядке разбора: часть текста, затем страница-скан. */
function partName(d: KbDocument, i: number): string {
  if (d.kind === 'table' || d.kind === 'facts') return d.kind === 'table' ? 'таблица' : 'пакет';
  if (i < d.chunks.length) return `часть ${i + 1}`;
  const s = d.scans?.[i - d.chunks.length];
  return s ? `страница ${s.page}` : `часть ${i + 1}`;
}
