/**
 * Лента ходов над вкладками штаба: ход — кнопка «вернуться к ходу N» (номер, начало хода, краткий итог), текущий
 * выделен, ход с развилкой — значок «⑂» с числом ветвей; в конце — «Ветви»: окно со списком линий игры («Перейти»,
 * «Удалить»). Все кнопки — действия реестра (те же, что голосом); пока ход считается — недоступны с причиной.
 */
import { useEffect, useRef } from 'react';
import { confirmAsync } from './dialogs';
import type { RibbonItem } from './turn-ribbon';
import { press } from './voice/actions/staff';
import { REWIND_OFFER, type BranchLine } from './voice/actions/turn';

export function TurnRibbon({ items, lines, busy, open, project, notice }: {
  items: RibbonItem[]; lines: BranchLine[];
  /** Идёт расчёт хода или возврат (текст) — кнопки недоступны. */
  busy: string | null;
  /** Окно «Ветви» открыто. */
  open: boolean;
  /** В проекте хода есть приказы, распоряжения или решение — возврат спросит подтверждение. */
  project: boolean;
  notice: (text: string) => void;
}) {
  const tap = (id: string, params?: unknown) => { void press(id, params, notice); };
  const go = (n: number) => {
    if (!project) { tap('command.rewind', { turn: n }); return; }
    void confirmAsync(REWIND_OFFER(n), { ok: 'Вернуться', danger: true }).then((ok) => { if (ok) tap('command.rewind.force', { turn: n }); });
  };
  const drop = (name: string) => { void confirmAsync(`Удалить ветвь «${name}»? Её ходы пропадут.`, { ok: 'Удалить', danger: true }).then((ok) => { if (ok) tap('command.branch.delete', { name }); }); };
  const why = busy ? `Сейчас нельзя: ${busy.replace(/…$/, '')}` : undefined;
  // текущий ход — в виду (лента прокручивается к концу)
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = strip.current; if (el) el.scrollLeft = el.scrollWidth; }, [items.length]);
  const forks = lines.length - 1;
  return (
    <div className="turn-ribbon" data-hl="ribbon" data-tour="cmd-ribbon">
      <div className="tr-strip" ref={strip}>
        {items.map((it) => (
          <div key={it.n} className={`tr-item${it.current ? ' on' : ''}`}>
            {it.current
              ? <span className="tr-turn" title={`Ход ${it.n}: ${it.summary}`}><b>{it.label}</b><i>{it.summary}</i></span>
              : <button className="tr-turn" data-action="command.rewind" disabled={!!busy} title={why ?? `Вернуться к ходу ${it.n}: ${it.summary}`} onClick={() => go(it.n)}>
                <b>{it.label}</b><i>{it.summary}</i></button>}
            {it.forks.length > 0 && <button className="tr-fork" data-action="command.branches.show" title={`Ветви от этого хода: ${it.forks.map((f) => f.name).join('; ')}`} onClick={() => tap('command.branches.show')}>⑂{it.forks.length}</button>}
          </div>
        ))}
      </div>
      <button className={`tr-branches${open ? ' on' : ''}`} data-action="command.branches.show" title="Линии игры: текущая и сохранённые ветви" onClick={() => tap(open ? 'command.branches.close' : 'command.branches.show')}>
        Ветви{forks > 0 ? ` · ${forks}` : ''}</button>
      {open && <div className="tr-pop" data-hl="branches">
        <div className="tr-pop-h"><b>Ветви игры</b><button className="x" title="Закрыть" data-action="command.branches.close" onClick={() => tap('command.branches.close')}>×</button></div>
        {lines.length < 2 && <p className="muted">Ветвей нет: игра идёт одной линией. Вернитесь к прошлому ходу — сыгранное останется ветвью.</p>}
        {lines.map((l) => (
          <div key={l.id ?? 'cur'} className={`tr-line${l.current ? ' on' : ''}`}>
            <div><b>{l.name}</b><span>ходов: {l.turns}{l.current ? ' · текущая' : l.from ? ` · расходится с ходом ${l.from}` : ''}</span></div>
            {!l.current && <div className="tr-line-b">
              <button className="primary" data-action="command.branch.switch" disabled={!!busy} title={why} onClick={() => tap('command.branch.switch', { name: l.name })}>Перейти</button>
              <button className="danger" data-action="command.branch.delete" disabled={!!busy} title={why} onClick={() => drop(l.name)}>Удалить</button>
            </div>}
          </div>
        ))}
      </div>}
    </div>
  );
}
