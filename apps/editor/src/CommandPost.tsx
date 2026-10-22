/**
 * Пункт управления по уровням (игра на агентной модели, «штабы-агенты» и «гибрид»): уровень карты задаёт ступень —
 * Ставка, штаб фронта, армии, корпуса; на уровне «Дивизия» — распоряжения дивизиям. Слева — кто отдаёт (штаб ступени,
 * взятый или нет), его подчинённые и форма документа по ступени получателя; рубежи, ось главного удара и
 * разграничительные линии указываются щелчками по карте. «Отдать» ставит директиву в очередь хода.
 */
import { useMemo, useRef, useState } from 'react';
import type { LngLat } from '@def-ops/core';
import type { TurnView } from './sim/game-protocol';
import { act, ActButton, useAction } from './voice/registry';
import { hl } from './voice/highlight';
import { controlMark, findHq, queueOp, type CommandOp } from './command-forms';
import { blankDir, DIR_TASK_RU, DOC_TITLE, FIELDS, issuers, missing, POST_TITLE, postTitle, recipients, sender, taken, toDirective, type DirDraft, type DirTask } from './command-post';
import { LEVELS, type LevelId } from './map-level-scale';

export type DirPick = 'axis' | 'immediate' | 'subsequent' | 'boundaryR' | 'boundaryL';
const PICK_RU: Record<DirPick, string> = { axis: 'ось', immediate: 'рубеж ближайшей задачи', subsequent: 'рубеж последующей задачи', boundaryR: 'правая разграничительная линия', boundaryL: 'левая разграничительная линия' };
const LEVEL_RU: Record<LevelId, string> = { stavka: 'Ставка', front: 'Фронт', army: 'Армия', corps: 'Корпус', division: 'Дивизия' };

export interface PostState {
  level: LevelId;
  issuer: string | null;
  sel: string | null;
  dirs: Record<string, DirDraft>;
  draft: DirDraft | null;
  pick: DirPick | null;
  /** Щелчок по карте при указании: точка — в поле проекта. */
  addPoint(p: LngLat): void;
  /** Щелчок по знаку: штаб ступени — пункт, подчинённый — его проект; true — обработан. */
  click(id: string): boolean;
}

const dm = (t?: string) => (t ? `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}` : '');

/** Состояние пункта и голосовые действия (на всё время игры). */
export function usePost(view: TurnView | null, level: LevelId, setLevel: (l: LevelId) => void, cmds: CommandOp[], setCmds: (f: (q: CommandOp[]) => CommandOp[]) => void, busy: boolean, on: boolean, openTab: () => void = () => {}): PostState {
  const [chosen, setChosen] = useState<Partial<Record<LevelId, string>>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [dirs, setDirs] = useState<Record<string, DirDraft>>({});
  const [pick, setPick] = useState<DirPick | null>(null);
  const list = useMemo(() => (view && on ? issuers(view, level) : []), [view, level, on]);
  // пункт ступени: выбранный, иначе — взятый игроком, иначе — первый
  const issuer = (chosen[level] && list.some((x) => x.id === chosen[level]) ? chosen[level] : list.find((x) => view && taken(view, x.id, cmds))?.id ?? list[0]?.id) ?? null;
  const subs = useMemo(() => (view && issuer ? recipients(view, issuer) : []), [view, issuer]);
  const draft = sel && subs.some((x) => x.id === sel) ? dirs[sel] ?? blankDir(sel, level) : null;
  const live = useRef({ draft, pick }); live.current = { draft, pick };
  const ready = (): true | string => (!on ? 'пункт управления — в игре на агентной модели в режиме «штабы-агенты» или «гибрид»' : view?.over ? 'игра окончена' : busy ? 'идёт расчёт хода' : true);
  const put = (d: DirDraft) => setDirs((x) => ({ ...x, [d.to]: d }));
  const name = (id: string) => view?.command?.hqs[id]?.name ?? view?.own.find((u) => u.id === id)?.name ?? id;

  useAction({
    id: 'command.post', section: 'replay', title: 'Пункт управления', describe: 'Пункт управления по уровню: Ставка, фронт, армия, корпус, дивизия (level) и штаб этой ступени (name) — уровень карты переключается вместе с ним.',
    params: { type: 'object', properties: { level: { enum: LEVELS }, name: { type: 'string' } } }, say: ['штаб, пункт управления армии', 'штаб, пункт управления восьмой гвардейской армии'], available: ready, highlight: () => hl('post'),
    run: async (p: { level?: LevelId; name?: string }) => {
      let lv = p?.level && LEVELS.includes(p.level) ? p.level : level;
      let id: string | null = null;
      if (p?.name) {
        const hqs = view!.command!.hqs;
        id = findHq(hqs, p.name);
        if (!id) return 'Такого штаба нет.';
        const e = hqs[id].echelon;
        const byEch = LEVELS.find((l) => issuers(view!, l).some((x) => x.id === id) && (l !== 'division' || e !== 'corps'));
        if (!byEch) return 'Этот штаб приказов не отдаёт.';
        lv = byEch;
        setChosen((c) => ({ ...c, [lv]: id! }));
      }
      setLevel(lv); setSel(null); setPick(null);
      return `Пункт управления: ${POST_TITLE[lv]}${id ? ` — ${name(id)}` : ''}. Уровень карты — «${LEVEL_RU[lv]}».`;
    },
  });
  useAction({
    id: 'command.dir.open', section: 'replay', title: 'Документ подчинённому', describe: 'Открывает в пункте управления документ (директиву, боевой приказ, распоряжение) подчинённому штаба пункта.',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, say: ['штаб, директива первому Белорусскому фронту'], available: ready, highlight: () => hl('post'),
    run: async (p: { name: string }) => {
      const id = subs.find((x) => x.id === p?.name)?.id ?? findHq(Object.fromEntries(subs.map((x) => [x.id, x])), String(p?.name ?? ''));
      if (!id) return `В подчинении ${issuer ? name(issuer) : 'пункта'} такого нет.`;
      setSel(id); setPick(null);
      return `${DOC_TITLE[level]} — ${name(id)}.`;
    },
  });
  useAction({
    id: 'command.dir.for', section: 'replay', title: 'Приказ формированию', describe: 'Открывает пункт управления его непосредственного начальника (уровень карты — по ступени) и документ этому формированию.',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, say: ['штаб, приказ четвёртому гвардейскому корпусу'], available: ready, highlight: () => hl('post'),
    run: async (p: { name: string }) => {
      const hqs = view!.command!.hqs;
      const id = hqs[p?.name] || view!.own.some((u) => u.id === p?.name) ? p.name : findHq(hqs, String(p?.name ?? ''));
      if (!id) return 'Такого формирования нет.';
      const parent = hqs[id]?.parent ?? view!.own.find((u) => u.id === id)?.parent ?? null;
      const ech = parent ? hqs[parent]?.echelon : undefined;
      const lv = ({ high_command: 'stavka', front: 'front', army: 'army', corps: 'corps' } as Record<string, LevelId>)[ech ?? ''];
      if (!parent || !lv) return 'У этого формирования нет начальника, который отдаёт приказы.';
      setChosen((c) => ({ ...c, [lv]: parent })); setLevel(lv); setSel(id); setPick(null); openTab();
      return `${DOC_TITLE[lv]} — ${name(id)}: пункт управления «${name(parent)}».`;
    },
  });
  useAction({
    id: 'command.dir.set', section: 'replay', model: false, title: 'Правка документа', describe: 'Правит открытый документ пункта управления.',
    params: { type: 'object', properties: { task: { type: 'string' }, form: { type: 'string' }, note: { type: 'string' }, toggle: { type: 'object' }, junction: { type: 'string' }, echelon: { type: 'string' }, commit: { type: 'boolean' }, by: { type: 'object' }, clear: { type: 'string' } } },
    available: ready,
    run: async (p: { task?: DirTask; form?: 'order' | 'instruction'; note?: string; toggle?: { field: 'mainBlow' | 'reserve'; id: string }; junction?: string; echelon?: 'first' | 'second' | ''; commit?: boolean; by?: { field: 'immediate' | 'subsequent'; at: string }; clear?: DirPick }) => {
      const d = live.current.draft;
      if (!d) return 'Документ не открыт.';
      const n: DirDraft = { ...d };
      if (p.task && DIR_TASK_RU[p.task]) n.task = p.task;
      if (p.form === 'order' || p.form === 'instruction') n.form = level === 'division' ? 'instruction' : p.form;
      if (p.note !== undefined) n.note = String(p.note);
      if (p.toggle) { const l = n[p.toggle.field]; n[p.toggle.field] = l.includes(p.toggle.id) ? l.filter((x) => x !== p.toggle!.id) : [...l, p.toggle.id]; }
      if (p.junction !== undefined) n.junction = p.junction || undefined;
      if (p.echelon !== undefined) n.echelon = p.echelon || undefined;
      if (p.commit !== undefined) n.commit = p.commit;
      if (p.by) { if (p.by.field === 'immediate') n.immediateBy = p.by.at || undefined; else n.subsequentBy = p.by.at || undefined; }
      if (p.clear) {
        if (p.clear === 'boundaryR') n.boundaries = [[], n.boundaries[1]];
        else if (p.clear === 'boundaryL') n.boundaries = [n.boundaries[0], []];
        else n[p.clear] = [];
      }
      put(n);
      return undefined;
    },
  });
  useAction({
    id: 'command.dir.pick', section: 'replay', model: false, title: 'Указать на карте', describe: 'Указание на карте: ось, рубежи задач, разграничительные линии (field; пусто — закончить).',
    params: { type: 'object', properties: { field: { type: 'string' } } }, available: ready,
    run: async (p: { field?: DirPick | '' }) => {
      if (!p?.field) { setPick(null); return 'Готово.'; }
      const d = live.current.draft;
      if (!d) return 'Документ не открыт.';
      // указание заново — с чистого листа
      if (p.field === 'boundaryR') put({ ...d, boundaries: [[], d.boundaries[1]] });
      else if (p.field === 'boundaryL') put({ ...d, boundaries: [d.boundaries[0], []] });
      else put({ ...d, [p.field]: [] });
      setPick(p.field);
      return `Щёлкайте по карте: ${PICK_RU[p.field]}; закончить — «Готово».`;
    },
  });
  useAction({
    id: 'command.dir.give', section: 'replay', title: 'Отдать документ', describe: 'Отдаёт открытый документ пункта управления: директива, приказ или распоряжение уходит в ядро с ходом.',
    say: ['штаб, отдать директиву'], available: ready, highlight: () => hl('post-give'),
    run: async () => {
      const d = live.current.draft;
      if (!d || !issuer) return 'Документ не открыт.';
      const miss = missing(d);
      if (miss.length) return `Не хватает: ${miss.join(', ')}.`;
      const s = sender(view!, issuer, cmds);
      setCmds((q) => queueOp(q, { op: 'directive', directive: toDirective(d, view!, s.from) as { to: string; task: string; form: string } }));
      setPick(null);
      return `${d.form === 'order' ? DOC_TITLE[level] : 'Боевое распоряжение'} — ${name(d.to)}: ${DIR_TASK_RU[d.task]}${s.overHead ? ', через голову' : ''}. Уйдёт с ходом.`;
    },
  });
  useAction({
    id: 'command.dir.cancel', section: 'replay', model: false, title: 'Отменить проект', describe: 'Убирает проект документа подчинённому.',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, available: ready,
    run: async (p: { name: string }) => { setDirs((x) => { const y = { ...x }; delete y[p?.name]; return y; }); setPick(null); return 'Проект убран.'; },
  });

  return {
    level, issuer, sel, dirs, draft, pick,
    addPoint: (pt) => {
      const { draft: d, pick: f } = live.current;
      if (!d || !f) return;
      if (f === 'boundaryR') put({ ...d, boundaries: [[...d.boundaries[0], pt], d.boundaries[1]] });
      else if (f === 'boundaryL') put({ ...d, boundaries: [d.boundaries[0], [...d.boundaries[1], pt]] });
      else put({ ...d, [f]: [...d[f], pt] });
    },
    click: (id) => {
      if (!on) return false;
      if (list.some((x) => x.id === id)) { setChosen((c) => ({ ...c, [level]: id })); setSel(null); return true; }
      if (subs.some((x) => x.id === id)) { setSel(id); return true; }
      return false;
    },
  };
}

/** Точки поля: сколько указано и кнопки «Указать на карте» / «Готово» / «Очистить». */
function Points({ label, hint, field, pts, pick }: { label: string; hint?: string; field: DirPick; pts: LngLat[]; pick: DirPick | null }) {
  const on = pick === field;
  return <div className="post-pts">
    <span>{label}{hint && <small className="muted"> — {hint}</small>}: {pts.length ? <b>{pts.length} т.</b> : <span className="muted">не указан{field.startsWith('boundary') ? 'а' : ''}</span>}</span>
    <span>
      <ActButton className={`link${on ? ' on' : ''}`} action="command.dir.pick" params={{ field: on ? '' : field }}>{on ? 'Готово' : pts.length ? 'заново' : 'на карте'}</ActButton>
      {pts.length > 0 && !on && <> <ActButton className="link danger" action="command.dir.set" params={{ clear: field }}>очистить</ActButton></>}
    </span>
  </div>;
}

export function CommandPost({ v, post, cmds }: { v: TurnView; post: PostState; cmds: CommandOp[] }) {
  const { level, issuer, draft: d, pick } = post;
  if (!issuer) return <div className="cmd-sec"><p className="muted">На этом уровне нет штабов стороны.</p></div>;
  const subs = recipients(v, issuer);
  const s = sender(v, issuer, cmds);
  const list = issuers(v, level);
  const queued = (id: string) => cmds.some((c) => c.op === 'directive' && c.directive.to === id);
  const fields = FIELDS[level];
  const has = (k: string) => fields.some((f) => f.key === k);
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? '';
  const hint = (k: string) => fields.find((f) => f.key === k)?.hint;
  // армии и корпуса получателя — для главного удара и стыка; резервы — ждущие ввода
  const below = d ? recipients(v, d.to).filter((x) => x.echelon !== 'division') : [];
  const reserves = v.reserveGroups.filter((g) => g.status === 'reserve');
  const miss = d ? missing(d) : [];
  const toTime = (t?: string) => (t ? t.slice(0, 16) : '');
  return (
    <div className="cmd-sec post" data-hl="post">
      <h3>Пункт управления: {POST_TITLE[level]}</h3>
      <div className="post-who">
        {list.length > 1 ? <label>Штаб <select value={issuer} data-action="command.post" onChange={(e) => void act('command.post', { name: e.target.value })}>
          {list.map((x) => <option key={x.id} value={x.id}>{x.name}{taken(v, x.id, cmds) ? ' — взят' : ''}</option>)}</select></label> : null}
        <div className={s.overHead ? 'post-over' : 'post-own'}>{postTitle(v, issuer, cmds)}</div>
        {s.overHead && <small className="muted">Чтобы отдавать от имени этого штаба — вкладка «Штабы» → «взять».</small>}
      </div>
      <h4>Подчинённые — {DOC_TITLE[level].toLowerCase()}</h4>
      <div className="post-subs">
        {subs.length ? subs.map((x) => {
          const m = controlMark(v.command?.hqs[x.id] ?? (v.command?.led.includes(x.id) ? { control: 'agent', led: true } : undefined));
          return <ActButton key={x.id} className={`orow${x.id === post.sel ? ' on' : ''}`} action="command.dir.open" params={{ name: x.id }}>
            <span className="orow-n">{x.name}</span>
            <span className="orow-t">{queued(x.id) ? <b className="plan">отдан на этот ход</b> : post.dirs[x.id] ? <b className="plan">проект</b> : ''}{m && <small className={`ctl-mark ${m.cls}`}>{m.text}</small>}</span>
          </ActButton>;
        }) : <span className="muted">подчинённых нет</span>}
      </div>
      {d && <div className="oedit post-form" data-hl="post-form">
        <div className="oedit-h"><b>{d.form === 'order' ? DOC_TITLE[level] : 'Боевое распоряжение'} — {subs.find((x) => x.id === d.to)?.name}</b></div>
        {level !== 'division' && <div className="seg">{([['order', DOC_TITLE[level]], ['instruction', 'Распоряжение']] as const).map(([k, t]) =>
          <ActButton key={k} className={d.form === k ? 'on' : ''} action="command.dir.set" params={{ form: k }} title={k === 'order' ? 'Подготовленный документ: около суток на ступень, полная слаженность' : 'Боевое распоряжение: 1–3 ч на ступень, слаженность ниже'}>{t}</ActButton>)}</div>}
        <label>{label('task')} <select value={d.task} data-action="command.dir.set" onChange={(e) => void act('command.dir.set', { task: e.target.value })}>
          {(Object.keys(DIR_TASK_RU) as DirTask[]).map((t) => <option key={t} value={t}>{DIR_TASK_RU[t]}</option>)}</select></label>
        {has('axis') && <Points label={label('axis')} hint={hint('axis')} field="axis" pts={d.axis} pick={pick} />}
        {has('mainBlow') && below.length > 0 && <div className="post-chk"><span>{label('mainBlow')}:</span>
          {below.map((x) => <label key={x.id}><input type="checkbox" data-action="command.dir.set" checked={d.mainBlow.includes(x.id)} onChange={() => void act('command.dir.set', { toggle: { field: 'mainBlow', id: x.id } })} /> {x.name}</label>)}</div>}
        {has('immediate') && <><Points label={label('immediate')} field="immediate" pts={d.immediate} pick={pick} />
          {level !== 'division' && <label className="small">срок <input type="datetime-local" data-action="command.dir.set" value={toTime(d.immediateBy)} min={toTime(v.time)} onChange={(e) => void act('command.dir.set', { by: { field: 'immediate', at: e.target.value } })} /></label>}</>}
        {has('subsequent') && <><Points label={label('subsequent')} field="subsequent" pts={d.subsequent} pick={pick} />
          <label className="small">срок <input type="datetime-local" data-action="command.dir.set" value={toTime(d.subsequentBy)} min={toTime(v.time)} onChange={(e) => void act('command.dir.set', { by: { field: 'subsequent', at: e.target.value } })} /></label></>}
        {has('boundaries') && <div className="post-bnd"><span>{label('boundaries')}{hint('boundaries') && <small className="muted"> — {hint('boundaries')}</small>}</span>
          <Points label="правая" field="boundaryR" pts={d.boundaries[0]} pick={pick} /><Points label="левая" field="boundaryL" pts={d.boundaries[1]} pick={pick} /></div>}
        {has('junction') && below.length > 0 && <label>{label('junction')} <select value={d.junction ?? ''} data-action="command.dir.set" onChange={(e) => void act('command.dir.set', { junction: e.target.value })}>
          <option value="">не назначен</option>{below.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {has('reserve') && reserves.length > 0 && <div className="post-chk"><span>{label('reserve')}:</span>
          {reserves.map((g) => <label key={g.id}><input type="checkbox" data-action="command.dir.set" checked={d.reserve.includes(g.id)} onChange={() => void act('command.dir.set', { toggle: { field: 'reserve', id: g.id } })} /> {g.name}</label>)}</div>}
        {has('echelon') && <div className="seg">{([['first', 'Первый эшелон'], ['second', 'Второй эшелон'], ['', 'Как решит штаб']] as const).map(([k, t]) =>
          <ActButton key={k} className={(d.echelon ?? '') === k ? 'on' : ''} action="command.dir.set" params={{ echelon: k }}>{t}</ActButton>)}</div>}
        {has('commit') && <label className="post-chk1"><input type="checkbox" data-action="command.dir.set" checked={!!d.commit} onChange={() => void act('command.dir.set', { commit: !d.commit })} /> {label('commit')} <small className="muted">— {hint('commit')}</small></label>}
        <label>{label('note')} <textarea rows={2} value={d.note} placeholder="Цель, силы, взаимодействие…" onChange={(e) => void act('command.dir.set', { note: e.target.value })} /></label>
        <div className="muted small">{d.immediateBy && `Ближайшая — к ${dm(d.immediateBy)}. `}{d.subsequentBy && `Последующая — к ${dm(d.subsequentBy)}. `}{s.overHead ? 'Через голову: пропущенные штабы получат извещение. ' : ''}До получателя — {d.form === 'order' ? 'около суток' : '1–3 ч'}.</div>
        {miss.length > 0 && <div className="adv-warn">Не хватает: {miss.join(', ')}.</div>}
        <div className="oedit-f">
          <ActButton className="link danger" action="command.dir.cancel" params={{ name: d.to }}>Убрать проект</ActButton>
          <ActButton className="primary" data-hl="post-give" disabled={miss.length > 0} action="command.dir.give">{queued(d.to) ? 'Отдать заново' : 'Отдать'}</ActButton>
        </div>
      </div>}
      {!d && <p className="muted">Выберите подчинённого — в списке или щелчком по его знаку на карте. Щелчок по знаку штаба этой ступени делает его пунктом управления.</p>}
    </div>
  );
}
