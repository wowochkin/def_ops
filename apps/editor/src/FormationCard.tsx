/**
 * Карточки поверх карты по щелчку на знаке: соединение в переигровке (нынешняя модель — по снимкам прогона,
 * агентная — штаб по ходу дивизий) и обнаруженный противник в игре (разведсводка). Справа, как карточка агента;
 * «×» и Esc закрывают.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { IntelReport } from '@def-ops/sim';
import { fmtCount, fmtFrac, fmtKm, fmtPct } from './num-format';
import { ECHELON_RU, type FormationCardData } from './formation-card';

const n0 = fmtCount;
const pct = fmtPct;
const when = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;

/** Закрыть по Esc (пока карточка открыта). */
export function useEsc(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as Element)?.closest?.('input, textarea, select')) close(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [on, close]);
}

/** Вкладка карточки (рядом со «Сводкой»): тело строится заново при каждой перерисовке — следует за часом. */
export interface PanelTab { id: string; label: string; body: ReactNode }

export function FormationPanel({ c, onClose, onPick, actions, note, badge, tabs, onTab }: { c: FormationCardData; onClose: () => void; onPick: (id: string, hq: boolean) => void; actions?: ReactNode; note?: string;
  /** «История как замысел»: состояние штаба на час («по истории», «сам: …»); нет — без бейджа. */
  badge?: string | null;
  /** Дополнительные вкладки; без них карточка — одна «Сводка». */
  tabs?: PanelTab[];
  /** Открытая вкладка изменилась (null — «Сводка»). */
  onTab?: (id: string | null) => void }) {
  const [tab, setTabState] = useState<string | null>(null);
  const setTab = (id: string | null) => { setTabState(id); onTab?.(id); };
  // другая карточка или у штаба пропала вкладка — снова «Сводка»
  const extra = tabs?.find((x) => x.id === tab);
  useEffect(() => { setTabState(null); onTab?.(null); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab && !extra) { setTabState(null); onTab?.(null); } }, [tab, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const cut = c.hq ? (c.cutOff.n ? `${c.cutOff.n} из ${c.cutOff.of} соединений` : 'нет') : c.cutOff.n ? 'да — подвоза нет' : 'нет';
  return (
    <div className={`ag-panel fc-panel${extra ? ' wide' : ''}`}>
      <div className="ag-head">
        <div><b>{c.name}</b><span>{c.sideName} · {c.echelon}{c.parent ? <> · в подчинении: <a className="fc-link" onClick={() => onPick(c.parent!.id, true)}>{c.parent.name}</a></> : ''}</span>
          <span>на {when(c.time)} МСК{note ? ` · ${note}` : ''}</span></div>
        <button className="x" onClick={onClose} title="Закрыть (Esc)">×</button>
      </div>
      {tabs && tabs.length > 0 && <div className="ag-tabs">
        <button className={!extra ? 'on' : ''} onClick={() => setTab(null)}>Сводка</button>
        {tabs.map((x) => <button key={x.id} className={x.id === tab ? 'on' : ''} onClick={() => setTab(x.id)}>{x.label}</button>)}
      </div>}
      {extra ? extra.body : <div className="ag-body">
        <section>
          <div className={`ag-state ${c.status === 'destroyed' ? 'destroyed' : c.status === 'pending' ? '' : c.posture === 'наступает' ? 'attack' : c.posture === 'обороняется' ? 'defense' : c.posture === 'отходит' ? 'withdraw' : 'march'}`}>
            {c.status === 'pending' ? 'ещё не введено в сражение' : c.status === 'destroyed' ? (c.hq ? 'все соединения уничтожены' : 'уничтожено') : c.posture}
          </div>
          {badge && <div className={`ag-state ${badge.startsWith('сам') ? 'withdraw' : badge.includes('сдвиг') ? 'deploy' : 'march'}`} data-hl="intent-badge" style={{ marginLeft: 6 }}>{badge}</div>}
          {c.status === 'active' && c.cutOff.n > 0 && <div className="ag-pocket">{c.hq ? `Отрезаны от снабжения: ${cut}` : 'Отрезано от снабжения: подвоза нет'}</div>}
        </section>
        <section>
          <h4>{c.hq ? `Силы — сумма ${c.members} действующих соединений` : 'Силы'}</h4>
          <table className="ag-vars"><tbody>
            <tr><td>Люди</td><td className="num">{c.status === 'pending' ? '—' : n0(c.personnel)}</td><td className="muted">{c.initial.personnel ? `${pct(c.share.personnel)} от исходных ${n0(c.initial.personnel)}` : ''}</td></tr>
            <tr><td>Танки и САУ</td><td className="num">{c.status === 'pending' ? '—' : n0(c.tanks)}</td><td className="muted">{c.initial.tanks ? `${pct(c.share.tanks)} от исходных ${n0(c.initial.tanks)}` : ''}</td></tr>
            <tr><td>Боеприпасы</td><td className="num">{c.ammo == null ? '—' : fmtFrac(c.ammo)}</td><td className="muted">бк{c.hq ? ', средние по людям' : ''}</td></tr>
            <tr><td>Отрезано</td><td className="num" colSpan={2} style={{ textAlign: 'left' }}>{c.status === 'active' ? cut : '—'}</td></tr>
          </tbody></table>
        </section>
        {actions && <section className="fc-actions">{actions}</section>}
        {c.children.length > 0 && <section>
          <h4>Подчинённые ({c.children.length})</h4>
          <ul className="fc-kids">
            {c.children.map((k) => (
              <li key={k.id} className={k.out ? 'out' : ''} onClick={() => onPick(k.id, k.hq)} title="Карточка">
                <span className="fc-kn">{k.name}<small>{ECHELON_RU[k.echelon] ?? k.echelon}</small></span>
                <span className="fc-ks">{k.out ? k.state : `${n0(k.personnel)} чел.${k.tanks ? `, ${n0(k.tanks)} танков` : ''}`}<small>{k.out ? '' : k.state}</small></span>
              </li>
            ))}
          </ul>
        </section>}
      </div>}
    </div>
  );
}

/** Карточка обнаруженного противника: что о нём известно по разведсводке хода. */
export function IntelPanel({ e, time, first, onClose, actions }: { e: IntelReport; time: string; first: boolean; onClose: () => void; actions?: ReactNode }) {
  return (
    <div className="ag-panel fc-panel" data-hl="enemy-card">
      <div className="ag-head">
        <div><b>{e.name}</b><span>противник · разведсводка к {when(time)} МСК</span></div>
        <button className="x" onClick={onClose} title="Закрыть (Esc)">×</button>
      </div>
      <div className="ag-body">
        <section><div className="ag-state">{e.posture}</div></section>
        <section>
          <table className="ag-vars"><tbody>
            <tr><td>Силы (оценка)</td><td>{e.estimate}</td></tr>
            <tr><td>Где</td><td>{e.place}</td></tr>
            {e.nearest && <tr><td>Ближе всех</td><td>{e.nearest.name} — {fmtKm(e.nearest.km)}</td></tr>}
            <tr><td>Обнаружен</td><td>{e.fresh ? 'впервые — за прошедший ход' : first ? 'к принятию командования' : 'был в разведсводке и раньше'}</td></tr>
          </tbody></table>
          <div className="muted small">Силы — оценка разведки, округлённо; намерения противника неизвестны.</div>
        </section>
        {actions && <section className="fc-actions">{actions}</section>}
      </div>
    </div>
  );
}
