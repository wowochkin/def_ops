/**
 * «Сверка с базой знаний» в карточке операции: где цифры базы (из документов, с источником) расходятся со
 * сценарием — исправить сценарий; чем расчёт уже пользуется, а в базе нет — внести в базу. Правки сценария
 * видны списком, каждую можно вернуть.
 */
import { useEffect, useState } from 'react';
import { SYNC_KEY_RU, type SyncInput, type SyncItem, type SyncKey } from '@def-ops/knowledge';
import * as kb from '../kb/kb';
import { getEdits, onDataChange, type OperationEdits } from '../sim/userdata';
import { acceptToKb, acceptToScenario, dismiss, fmt, KEY_RU, revertScenario, syncItems } from './sync';

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function SyncPanel({ op }: { op: string }) {
  const [data, setData] = useState<{ items: SyncItem[]; input: SyncInput } | null>(null);
  const [edits, setEdits] = useState<OperationEdits | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<SyncKey | 'diff' | 'edits' | null>('diff');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true, t: ReturnType<typeof setTimeout> | null = null, lastE: unknown = null;
    const run = () => void Promise.all([syncItems(op), getEdits(op)]).then(([d, e]) => { if (alive) { setData(d); setEdits(e); } });
    const later = () => { if (t) clearTimeout(t); t = setTimeout(run, 300); };
    run();
    const off1 = kb.subscribe((s) => { if (s.entries !== lastE) { lastE = s.entries; later(); } });
    const off2 = onDataChange(later);
    return () => { alive = false; off1(); off2(); if (t) clearTimeout(t); };
  }, [op]);

  const act = async (label: string, f: () => Promise<unknown>, done?: string) => {
    setBusy(label); setMsg(null);
    try { await f(); if (done) setMsg(done); } catch (e) { setMsg(`Ошибка: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  if (!data || !edits) return <section className="mdl-card sync"><h4>Сверка с базой знаний</h4><p className="muted">Считается…</p></section>;

  const diff = data.items.filter((i) => i.dir === 'toScenario');
  const toKb = data.items.filter((i) => i.dir === 'toKb');
  const byKey = (['personnel', 'tanks', 'guns', 'parent', 'path'] as SyncKey[]).map((k) => ({ k, list: toKb.filter((i) => i.key === k) })).filter((x) => x.list.length);
  const patched = Object.entries(edits.formations).flatMap(([fid, p]) => Object.entries(p).filter(([, v]) => v).map(([k, v]) => ({ fid, k: k as 'personnel' | 'tanks' | 'guns', v: v! })));
  const nameOf = (fid: string) => data.input.formations.find((f) => f.id === fid)?.name ?? fid;
  const relBadge = (r?: string) => (r ? <i className={`kb-rel r${r}`}>{r}</i> : null);

  return (
    <section className="mdl-card sync">
      <div className="sync-h"><h4>Сверка с базой знаний</h4>
        <span className={`sync-n ${diff.length ? 'warn' : 'ok'}`}>{diff.length ? `расхождений: ${diff.length}` : '✓ цифры сценария не расходятся с базой'}</span>
        <span className="sync-n">в базе не хватает: {toKb.length}</span>
        {patched.length > 0 && <span className="sync-n">правок сценария: {patched.length}</span>}</div>
      <p className="muted small">База знаний — общее место сведений об операции. Цифры из документов (с источником) можно перенести в сценарий — численность пересчитывается в боевую, как при сборке сценария; сведения, которыми расчёт уже пользуется, а в базе их нет, — внести в базу (оценки стенда — с достоверностью C, их стоит заменить данными источников). Решаете вы.</p>
      {msg && <div className={msg.startsWith('Ошибка') ? 'err' : 'ok small'}>{msg}</div>}

      <div className="mat-tabs">
        <button className={open === 'diff' ? 'on' : ''} onClick={() => setOpen(open === 'diff' ? null : 'diff')}>База → сценарий: {diff.length}</button>
        {byKey.map(({ k, list }) => <button key={k} className={open === k ? 'on' : ''} onClick={() => setOpen(open === k ? null : k)}>В базу: {SYNC_KEY_RU[k]} {list.length}</button>)}
        {patched.length > 0 && <button className={open === 'edits' ? 'on' : ''} onClick={() => setOpen(open === 'edits' ? null : 'edits')}>Правки сценария: {patched.length}</button>}
        <span className="grow" />
        {toKb.length > 0 && <button className="primary" disabled={!!busy} onClick={() => void act('kb', () => acceptToKb(op, toKb, data.input), `Внесено в базу: ${toKb.length} сведений.`)}>{busy === 'kb' ? 'Вношу…' : `Внести в базу всё (${toKb.length})`}</button>}
      </div>

      {open === 'diff' && (diff.length ? <>
        <div className="row"><button disabled={!!busy} onClick={() => void act('sc', () => acceptToScenario(op, diff), 'Сценарий исправлен — пересчитайте модель (ниже).')}>Принять все в сценарий</button>
          <button disabled={!!busy} onClick={() => void act('dis', () => dismiss(op, diff.map((i) => i.id)))}>Отклонить все</button></div>
        <div className="sync-tbl-wrap"><table className="mdl-tbl sync-tbl"><thead><tr><th>Формирование</th><th>Сведение</th><th>Сценарий</th><th>Из базы</th><th>Источник</th><th /></tr></thead><tbody>
          {diff.map((i) => <tr key={i.id}>
            <td>{i.name}</td><td>{SYNC_KEY_RU[i.key]}</td><td>{fmt(i.scenario as number)}</td>
            <td><b>{fmt(i.value!)}</b><small className="muted"> · {i.how}</small></td>
            <td className="sync-src" title={i.fact?.quote ? `«${i.fact.quote}»` : undefined}>{relBadge(i.fact?.reliability)} {i.fact?.value}</td>
            <td className="sync-act"><button className="link" disabled={!!busy} onClick={() => void act('sc', () => acceptToScenario(op, [i]))}>в сценарий</button>
              <button className="link muted" disabled={!!busy} onClick={() => void act('dis', () => dismiss(op, [i.id]))}>отклонить</button></td></tr>)}
        </tbody></table></div>
      </> : <p className="muted small">Расхождений нет: где в базе есть цифры на начало операции, они совпадают со сценарием (с точностью 5 %).</p>)}

      {byKey.map(({ k, list }) => open === k && <div key={k}>
        <div className="row"><button className="primary" disabled={!!busy} onClick={() => void act('kb', () => acceptToKb(op, list, data.input), `Внесено в базу: ${list.length}.`)}>Внести в базу ({list.length})</button>
          <button disabled={!!busy} onClick={() => void act('dis', () => dismiss(op, list.map((i) => i.id)))}>Не вносить</button>
          <small className="muted">{k === 'path' ? 'положения по дням из истории сценария — с источниками исторических данных' : 'оценки стенда — достоверность C'}</small></div>
        <div className="sync-tbl-wrap"><table className="mdl-tbl sync-tbl"><thead><tr><th>Формирование</th><th>В базу</th><th /></tr></thead><tbody>
          {list.slice(0, 200).map((i) => <tr key={i.id}><td>{i.name}{!i.entry && <small className="muted"> · новая запись</small>}</td>
            <td className="sync-src">{relBadge(i.facts?.[0]?.reliability)} {i.facts?.[0]?.value}</td>
            <td className="sync-act"><button className="link" disabled={!!busy} onClick={() => void act('kb', () => acceptToKb(op, [i], data.input))}>в базу</button></td></tr>)}
        </tbody></table></div>
        {list.length > 200 && <small className="muted">и ещё {list.length - 200} — «Внести в базу» вносит все</small>}
      </div>)}

      {open === 'edits' && <div className="sync-tbl-wrap"><table className="mdl-tbl sync-tbl"><thead><tr><th>Формирование</th><th>Сведение</th><th>Было</th><th>Стало</th><th>Основание</th><th /></tr></thead><tbody>
        {patched.map(({ fid, k, v }) => <tr key={`${fid}${k}`}><td>{nameOf(fid)}</td><td>{KEY_RU[k]}</td><td>{fmt(v.was)}</td><td><b>{fmt(v.value)}</b></td>
          <td className="sync-src"><small className="muted">{ddmmyyyy(v.at)} · </small>{v.source}</td>
          <td className="sync-act"><button className="link" disabled={!!busy} onClick={() => void act('rv', () => revertScenario(op, fid, k, nameOf(fid)))}>вернуть</button></td></tr>)}
      </tbody></table></div>}
    </section>
  );
}
