/**
 * Вкладка «Штабы» игры на агентной модели (командование по ступеням): исторические директивы верхней инстанции,
 * запросы на отход, штабы стороны с пометками управления (взять, вернуть агенту, вернуть в замысел старшего) и
 * журнал документов штабов-агентов. Команды копятся в очереди хода и уходят в ядро вместе с ходом.
 */
import { useMemo, useState } from 'react';
import type { TurnView } from './sim/game-protocol';
import { act, ActButton, useAction } from './voice/registry';
import { hl } from './voice/highlight';
import { controlMark, findHq, MODE_TITLE, placeText, queueOp, releaseAction, staffListed, type CommandOp } from './command-forms';
import { commandText } from './sim/agents-game';
import type { LevelId } from './map-level-scale';

/** Уровень карты взятого штаба: его подчинённые — крупно. */
const LEVEL_OF: Record<string, LevelId> = { front: 'front', army: 'army', corps: 'corps' };
const ECH_RU: Record<string, string> = { high_command: 'верхняя инстанция', front: 'фронт', army: 'армия', corps: 'корпус' };
const KIND_RU: Record<string, string> = { directive: 'директива', order: 'боевой приказ', instruction: 'распоряжение', notice: 'извещение', report: 'донесение' };
const TASK_RU: Record<string, string> = { attack: 'наступать', defend: 'оборонять', delay: 'сдерживать', withdraw: 'отходить', move: 'выдвинуться', reserve: 'резерв' };

/** Командование по ступеням включено (агентная модель, режим «агенты» или «гибрид»). */
export const staffsOn = (v: TurnView | null): boolean => !!v?.command && v.command.mode !== 'legacy';

/**
 * Голосовые действия и кнопки командования по ступеням: ставят команду в очередь хода. Регистрируются на всё время
 * игры (голосом — из любой вкладки).
 */
export function useStaffActions(view: TurnView | null, cmds: CommandOp[], setCmds: (f: (q: CommandOp[]) => CommandOp[]) => void, busy: boolean, setLevel?: (l: LevelId) => void): void {
  const c = view?.command;
  const ready = (): true | string => (!staffsOn(view) ? 'командование по ступеням — в игре на агентной модели в режиме «штабы-агенты» или «гибрид»' : view!.over ? 'игра окончена' : busy ? 'идёт расчёт хода' : true);
  const hqOf = (name: string): string | null => (c ? findHq(c.hqs, String(name ?? '')) : null);
  const put = (op: CommandOp, done: string) => { setCmds((q) => queueOp(q, op)); return `${done} — уйдёт в ядро с ходом.`; };
  const nameOf = (id: string) => c?.hqs[id]?.name ?? id;
  useAction({
    id: 'command.take', section: 'replay', title: 'Взять штаб под управление', describe: 'Игрок встаёт на место командующего фронтом, армией или корпусом: штаб больше не решает сам, его замысел старшего остаётся.',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, say: ['штаб, возьми восьмую гвардейскую армию'], available: ready, highlight: () => hl('staffs'),
    run: async (p: { name: string }) => {
      const id = hqOf(p?.name);
      if (!id || !staffListed(c!.hqs[id].echelon, c!.mode)) return 'Такого штаба стороны нет.';
      // «гибрид»: взятый штаб сходит со сценария
      if (c!.hqs[id].control === 'player' && !cmds.some((x) => x.op === 'release' && x.id === id)) return `${nameOf(id)} уже под вашим управлением.`;
      // взятый штаб — карта на его уровне (смотреть другие можно свободно)
      const lv = LEVEL_OF[c!.hqs[id].echelon];
      if (lv) setLevel?.(lv);
      return put({ op: 'take', hq: id }, `${nameOf(id)}: взять под управление`);
    },
  });
  useAction({
    id: 'command.release', section: 'replay', title: 'Вернуть штаб', describe: 'Возвращает взятый штаб агенту, а изъятый приказом через голову — в замысел старшего; в «истории как замысле» — истории (штаб с подчинёнными снова по историческому замыслу).',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, say: ['штаб, верни армию агенту'], available: ready, highlight: () => hl('staffs'),
    run: async (p: { name: string }) => {
      const id = hqOf(p?.name) ?? (c?.led.includes(p?.name) ? p.name : null);
      if (!id) return 'Такого штаба стороны нет.';
      return put({ op: 'release', id }, `${nameOf(id)}: вернуть`);
    },
  });
  useAction({
    id: 'command.permit', section: 'replay', title: 'Ответ на запрос отхода', describe: 'Разрешает (yes) или запрещает отход дивизиям корпуса, запросившего разрешение.',
    params: { type: 'object', properties: { name: { type: 'string' }, yes: { type: 'boolean' } }, required: ['name', 'yes'] }, say: ['штаб, разреши отход корпусу'], available: ready, highlight: () => hl('staffs'),
    run: async (p: { name: string; yes: boolean }) => {
      const id = hqOf(p?.name);
      if (!id || !c!.requests.some((r) => r.hq === id && r.answer === null)) return 'У этого штаба нет запросов на отход.';
      return put({ op: 'permit', hq: id, yes: !!p.yes }, `${nameOf(id)}: ${p.yes ? 'отход разрешён' : 'в отходе отказано'}`);
    },
  });
  useAction({
    id: 'command.historical', section: 'replay', title: 'Подать историческую директиву', describe: 'Подаёт историческую директиву верхней инстанции (id) или все сразу (all); в «гибриде» — только до первого хода.',
    params: { type: 'object', properties: { id: { type: 'string' }, all: { type: 'boolean' } } }, say: ['штаб, подай директивы'], available: ready, highlight: () => hl('staffs'),
    run: async (p: { id?: string; all?: boolean }) => {
      const left = (c?.historical ?? []).filter((h) => !h.issued);
      const pick = p?.all || !p?.id ? left : left.filter((h) => h.id === p.id);
      if (!pick.length) return 'Подавать нечего: исторические директивы поданы.';
      setCmds((q) => pick.reduce((a, h) => queueOp(a, { op: 'historical', id: h.id }), q));
      return `${pick.length === 1 ? `Директива ${pick[0].id}` : `Директив: ${pick.length}`} — уйдёт в ядро с ходом.`;
    },
  });
  useAction({
    id: 'command.cmd.cancel', section: 'replay', model: false, title: 'Снять команду из очереди', describe: 'Снимает команду управления из очереди хода (номер в списке).',
    params: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] }, available: ready,
    run: async (p: { index: number }) => { setCmds((q) => q.filter((_, k) => k !== p?.index)); return 'Команда снята.'; },
  });
}

export function Staffs({ v, cmds }: { v: TurnView; cmds: CommandOp[] }) {
  const c = v.command!;
  const [hq, setHq] = useState<string>('');
  useAction({
    id: 'command.docs.hq', section: 'replay', title: 'Документы штаба', describe: 'Журнал документов во вкладке «Штабы»: только выбранный штаб (hq; пусто — все).',
    params: { type: 'object', properties: { hq: { type: 'string' } } }, say: ['штаб, покажи документы восьмой гвардейской армии'], available: () => true,
    run: async (p: { hq?: string }) => {
      const id = p?.hq ? findHq(c.hqs, p.hq) : '';
      if (id === null) return 'Такого штаба стороны нет.';
      setHq(id);
      return id ? `Документы: ${c.hqs[id].name}.` : 'Документы всех штабов.';
    },
  });
  const hybridLate = c.mode === 'hybrid' && v.turn > 1;
  const queued = (op: CommandOp['op'], id: string) => cmds.some((x) => x.op === op && (x.op === 'take' ? x.hq : x.op === 'release' ? x.id : x.op === 'permit' ? x.hq : x.op === 'directive' ? x.directive.to : x.id) === id);
  const open = c.requests.filter((r) => r.answer === null);
  const byHq = useMemo(() => {
    const m = new Map<string, typeof open>();
    for (const r of open) m.set(r.hq, [...(m.get(r.hq) ?? []), r]);
    return [...m.entries()];
  }, [open]);
  // верхняя инстанция — в списке только в «истории как замысле»: там её можно взять и вернуть
  const list = Object.entries(c.hqs).filter(([, h]) => staffListed(h.echelon, c.mode));
  const docs = (hq ? c.documents.filter((d) => d.hq === hq) : c.documents).slice().reverse();
  return (
    <div className="cmd-sec staffs" data-hl="staffs">
      <div className="staffs-mode"><b>{MODE_TITLE[c.mode].title}</b> — {MODE_TITLE[c.mode].hint}</div>
      {cmds.length > 0 && <details className="staffs-queue" open={cmds.length <= 4}>
        <summary><b>Команды на этот ход · {cmds.length}</b> <small className="muted">уйдут в ядро с ходом</small></summary>
        {cmds.map((x, k) => <div key={k} className="staffs-row">{commandText(x, (id) => c.hqs[id]?.name ?? id, (id) => { const h = c.historical.find((y) => y.id === id); return h && `${h.time} → ${h.toName}`; })}
          <ActButton className="link" action="command.cmd.cancel" params={{ index: k }} title="Снять из очереди">снять</ActButton></div>)}
      </details>}
      <section>
        <h4>Исторические директивы {v.terms.topGen}</h4>
        {c.historical.length ? <>
          {c.historical.map((h) => <div key={h.id} className={`staffs-row${h.issued ? ' done' : ''}`}>
            <span><b>{h.time}</b> → {h.toName}: {TASK_RU[h.task] ?? h.task}{h.note ? ` — ${h.note}` : ''} <small className="muted">{h.id}</small></span>
            {h.issued ? <small className="muted">подана</small> : queued('historical', h.id) ? <small className="muted">в очереди</small>
              : <ActButton className="link" disabled={hybridLate} action="command.historical" params={{ id: h.id }} title={hybridLate ? 'в «гибриде» — только до первого хода' : 'Подать от имени игрока'}>подать</ActButton>}
          </div>)}
          {c.historical.some((h) => !h.issued && !queued('historical', h.id)) && !hybridLate && <ActButton action="command.historical" params={{ all: true }}>Подать все</ActButton>}
        </> : <span className="muted">в сценарии нет</span>}
      </section>
      {byHq.length > 0 && <section>
        <h4>Запросы на отход</h4>
        {byHq.map(([id, rs]) => <div key={id} className="staffs-row">
          <span><b>{rs[0].hqName}</b>: {rs.map((r) => r.divisionName).join(', ')} <small className="muted">с {rs[0].time}</small></span>
          {queued('permit', id) ? <small className="muted">ответ в очереди</small> : <span>
            <ActButton className="link" action="command.permit" params={{ name: id, yes: true }}>разрешить</ActButton>{' '}
            <ActButton className="link danger" action="command.permit" params={{ name: id, yes: false }}>отказать</ActButton></span>}
        </div>)}
      </section>}
      <section>
        <h4>Штабы</h4>
        {list.map(([id, h]) => {
          const m = controlMark(h, c.mode);
          const back = releaseAction(h, c.mode);
          return <div key={id} className="staffs-row">
            <span><b>{h.name}</b> <small className="muted">{ECH_RU[h.echelon] ?? h.echelon}</small>{m && <small className={`ctl-mark ${m.cls}`}>{m.text}</small>}</span>
            <span>
              {h.control !== 'player' && !queued('take', id) && <ActButton className="link" action="command.take" params={{ name: id }} title="Встать на место командующего: штаб больше не решает сам">взять</ActButton>}
              {back && !queued('release', id) && <ActButton className="link" action="command.release" params={{ name: id }} title={back.title}>{back.text}</ActButton>}
            </span>
          </div>;
        })}
        {c.led.length > 0 && <div className="muted small">Через голову ведёт Ставка: {c.led.length} дивизий{c.led.length === 1 ? 'я' : ''}.</div>}
      </section>
      <section>
        <h4>Документы штабов</h4>
        <label className="small">Штаб <select value={hq} data-action="command.docs.hq" onChange={(e) => void act('command.docs.hq', { hq: e.target.value })}>
          <option value="">все</option>{list.map(([id, h]) => <option key={id} value={id}>{h.name}</option>)}</select></label>
        <div className="staffs-docs">{docs.length ? docs.map((d, k) => <div key={k} className={`doc doc-${d.kind}`}>
          <b>{d.time}</b> {d.hqName} · <i>{KIND_RU[d.kind] ?? d.kind}</i>: {placeText(d.text, v.places)}{d.rule && <small className="muted"> ({d.rule})</small>}
        </div>) : <span className="muted">документов нет</span>}</div>
      </section>
    </div>
  );
}
