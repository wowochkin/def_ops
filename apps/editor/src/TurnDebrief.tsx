/**
 * Часть «Ход» вкладки «Итоги»: разбор хода по ключевым событиям. Сверху — «Разобрать с позиции …» (верхняя инстанция и
 * дерево своих штабов), оценка позиции (задача, цель, исторический путь), нумерованный список событий (номер — метка на
 * карте; щелчок — карта к событию, событие раскрыто: что, где, почему, что значит). Ход без событий — «За ход
 * ключевых событий нет» и строка продвижения и потерь. Ниже — связный текст модели по тем же фактам (с пометкой);
 * без модели — разбор по данным хода. Всё — через действия (голосом то же).
 */
import { useEffect, useRef, useState } from 'react';
import { debriefFor, type CommandTerms, type TurnDebrief } from '@def-ops/sim';
import { act, ActButton } from './voice/registry';
import type { TourMap } from './voice/tours';
import type { UmpireModel } from './voice/umpire';
import { DEBRIEF_SYSTEM, debriefInput, debriefShown, eventLines, eventMap, narrativeFits, perspectiveOptions, quietLine, tickTime, verdictLines, type NarrativeState } from './debrief-view';

export type { NarrativeState };

/**
 * Состояние разбора в окне: позиция («с позиции …»), раскрытое событие и связный текст модели. Новый ход (resetKey;
 * в игре — время хода и номер линии) сбрасывает позицию и раскрытое сразу же (выбранное помнит свой ключ) и отменяет
 * ждущий запрос к модели; связный текст — по (ходу, позиции).
 */
export function useDebrief(o: { debrief: TurnDebrief | null; resetKey: string; model: () => UmpireModel | null; show: (m: TourMap, tick: number) => void;
  /** Часть «Ход» на экране; ушли с неё — карта возвращается (уровень, время, метка снята: reset). */ active: boolean; reset: () => void }) {
  const live = useRef(o); live.current = o;
  const [hq, setHq] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  /** Ключ, при котором выбраны позиция и событие. */
  const [at, setAt] = useState(o.resetKey);
  const [narr, setNarr] = useState<{ key: string; s: NarrativeState }>({ key: '', s: { state: 'off' } });
  const abort = useRef<AbortController | null>(null);
  /** Карта показывала событие: при смене позиции и уходе с части «Ход» — вернуть её. */
  const shown = useRef(false);
  const unshow = () => { if (shown.current) { shown.current = false; live.current.reset(); } };
  useEffect(() => { if (!o.active) unshow(); }, [o.active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAt(o.resetKey); setHq(null); setOpen(null); abort.current?.abort(); abort.current = null; setNarr({ key: '', s: { state: 'off' } }); }, [o.resetKey]);
  useEffect(() => () => abort.current?.abort(), []);
  const shownNow = debriefShown({ key: at, hq, open, narr }, o.resetKey);
  const hqRef = useRef(shownNow.hq); hqRef.current = shownNow.hq;
  return {
    ...shownNow,
    setHq: (h: string | null) => { setAt(live.current.resetKey); setHq(h); setOpen(null); hqRef.current = h; unshow(); },
    openEvent: (n: number) => {
      const d = live.current.debrief;
      const e = d && debriefFor(d, hqRef.current).events[n - 1];
      if (!e) return;
      setAt(live.current.resetKey); setHq(hqRef.current);
      setOpen(n);
      shown.current = true;
      live.current.show(eventMap(e), e.tick);
    },
    narrate: () => {
      const d = live.current.debrief, m = live.current.model();
      if (!d || !m) return;
      const h = hqRef.current, k = `${live.current.resetKey}|${h ?? ''}`;
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      const input = debriefInput(d, h, {});
      setNarr({ key: k, s: { state: 'wait' } });
      m(DEBRIEF_SYSTEM, input, { signal: ac.signal })
        .then((text) => { if (!ac.signal.aborted) setNarr({ key: k, s: narrativeFits(text, input) ? { state: 'ready', text: text.trim() } : { state: 'unfit' } }); })
        .catch((e) => { if (!ac.signal.aborted) setNarr({ key: k, s: { state: 'error', text: String((e as Error)?.message ?? e) } }); });
    },
  };
}

const KIND: Record<string, string> = { breakthrough: 'прорыв', encirclement: 'окружение', capture: 'взятие', counterattack: 'контрудар', withdrawal: 'отход', destroyed: 'разгром' };

export function TurnDebriefPanel(p: { d: TurnDebrief; terms: CommandTerms; hq: string | null; open: number | null; narrative: NarrativeState; modelOn: boolean; /** Подпись окна: «Ход» (игра) или «Сутки» (переигровка). */ span?: string }) {
  const { d } = p;
  const opts = perspectiveOptions(d, p.terms);
  const f = debriefFor(d, p.hq);
  const verdict = verdictLines(d, p.hq);
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return (
    <div className="db">
      <label className="db-as">Разобрать с позиции
        <select data-hl="debrief-as" value={p.hq ?? ''} onChange={(e) => { void act('command.debrief.as', { name: e.target.value || p.terms.top }, { by: 'mouse' }); }}>
          {opts.map((o) => <option key={o.id ?? ''} value={o.id ?? ''}>{'  '.repeat(o.depth)}{o.label}{o.note ? ` — ${o.note}` : ''}</option>)}
        </select>
      </label>
      <p className="db-time">{p.span ?? 'Ход'}: {tickTime(d, d.from)} — {tickTime(d, d.to)}</p>
      {verdict.length > 0 && <ul className="db-verdict">{verdict.map((v) => <li key={v}>{cap(v)}</li>)}</ul>}
      {f.events.length ? <ol className="db-list">
        {f.events.map((e, i) => {
          const n = i + 1, on = p.open === n;
          const l = on ? eventLines(e, d, p.hq) : null;
          return <li key={e.id} className={on ? 'on' : undefined}>
            <ActButton className="db-ev" action="command.debrief.event" params={{ n }} data-hl={`debrief-ev-${n}`} title="Карта — к событию; что, где, почему, что значит">
              <span className={`db-n ${e.side === d.side ? 'own' : 'foe'}`}>{n}</span>
              <span className="db-t"><b>{e.title}</b><small>{KIND[e.kind]} · {tickTime(d, e.tick)}{e.lost > 0 ? ` · потери ${e.lost.toLocaleString('ru-RU')}` : ''}</small></span>
            </ActButton>
            {l && <dl className="db-lines">
              <dt>Что</dt><dd>{l.what}</dd>
              <dt>Где</dt><dd>{cap(l.where)}</dd>
              <dt>Почему</dt><dd>{l.why.length > 1 ? <ul>{l.why.map((w) => <li key={w}>{w}</li>)}</ul> : cap(l.why[0])}</dd>
              <dt>Что значит</dt><dd>{cap(l.meaning)}</dd>
            </dl>}
          </li>;
        })}
      </ol> : <div className="db-quiet"><p><b>За ход ключевых событий нет.</b></p><p className="rs-note">{quietLine(d)}</p></div>}
      <div className="db-narr">
        <ActButton action="command.debrief.narrate" data-hl="debrief-narrate" disabled={!p.modelOn || p.narrative.state === 'wait'}
          title={p.modelOn ? 'Модель посредника пишет связный разбор по тем же фактам' : 'модель не на связи — разбор по данным хода'}>Связный разбор (модель)</ActButton>
        {!p.modelOn && <small className="rs-note">модель не на связи — разбор по данным хода</small>}
        {p.narrative.state === 'wait' && <p className="rs-note"><span className="spinner" /> Модель пишет связный разбор…</p>}
        {p.narrative.state === 'ready' && <div className="db-text"><small>связный текст модели по тем же фактам</small><p>{p.narrative.text}</p></div>}
        {p.narrative.state === 'unfit' && <p className="rs-note">Ответ модели не годится — разбор по данным хода.</p>}
        {p.narrative.state === 'error' && <p className="rs-note err">Модель не ответила: {p.narrative.text}. Разбор — по данным хода.</p>}
      </div>
    </div>
  );
}
