/**
 * Игра на агентной модели (настольное приложение): с выбранного часа советской стороной командует игрок. Приказы —
 * армиям (доходят до всех их дивизий с задержкой штаба армии), цель — точка на карте или «на месте»; ход — N часов
 * расчёта ядром приложения (команды game_start / game_turn). Противник — по сценарию или по доктрине.
 */
import { useEffect, useState } from 'react';
import type { LngLat } from '@def-ops/core';
import type { AgentTrace } from '@def-ops/sim';
import type { MapEngine } from './engine/types';

export type OrderKind = 'attack' | 'defend' | 'hold' | 'withdraw' | 'move';
export const ORDER_RU: Record<OrderKind, string> = { attack: 'наступать', defend: 'оборонять', hold: 'держаться', withdraw: 'отойти', move: 'выдвинуться' };
export interface Draft { kind: OrderKind; target: LngLat | null }
export type Enemy = 'script' | 'doctrine';

export interface AgentGameState {
  takeover: number;
  hour: number;
  over: boolean;
  turnHours: number;
  enemy: Enemy;
  drafts: Record<string, Draft>;
  /** Итог последнего хода: какие приказы приняты (сколько дивизий) и какие нет. */
  applied: { hq: string; divisions?: number; error?: string }[];
}

/** Ответ команд игры: ход с начала сценария и сведения об игре. */
export type GameTrace = AgentTrace & { game: { player: string; takeover: number; hour: number; over: boolean; applied?: AgentGameState['applied'] } };

const ddmm = (start: string, h: number) => {
  const t = new Date(Date.parse(`${start}:00Z`) + h * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)} ${p(t.getUTCHours())}:00`;
};

/** Армии стороны игрока с действующими дивизиями в этот час. */
export function playerArmies(t: AgentTrace, hour: number, side = 'su') {
  const h = Math.min(t.frames.length - 1, hour);
  const parent = new Map(t.hqs.map((x) => [x.id, x.parent]));
  const armyOf = (hq: string) => { for (let x: string | null | undefined = hq, n = 0; x && n < 8; x = parent.get(x), n++) if (t.hqs.find((y) => y.id === x)?.echelon === 'army') return x; return null; };
  return t.hqs.filter((a) => a.side === side && a.echelon === 'army').map((a) => {
    const idx = t.divisions.map((d, i) => [d, i] as const).filter(([d]) => armyOf(d.hq) === a.id);
    const live = idx.filter(([, i]) => { const s = String((t.frames[h][i] as unknown[])[2]); return !s.startsWith('не введена') && !s.startsWith('небоеспособ') && !s.startsWith('сведена'); });
    const people = live.reduce((s, [, i]) => s + ((t.frames[h][i] as unknown[])[3] as number), 0);
    const ids = new Set(idx.map(([d]) => d.id));
    const last = [...t.journal].reverse().find((e) => e.tick <= h && e.agent && ids.has(e.agent) && e.text.startsWith('получен приказ'));
    const full = last ? last.text.replace(/^получен приказ /, '').replace(/ от штаба «[^»]*»/, '').replace(/:?\s*\[[^\]]*@[^\]]*\]\s*$/, '').replace(/\s*\([A-Z][A-Z_]+[^)]*\)/g, '') : null;
    const order = full && full.length > 90 ? `${full.slice(0, 88)}…` : full;
    return { id: a.id, name: a.name, divisions: live.length, people, order, full, orderAt: last?.tick ?? null };
  }).filter((a) => a.divisions > 0);
}

export function TakeoverAgentDialog({ start, hour, onStart, onCancel }: { start: string; hour: number; onStart: (enemy: Enemy, turnHours: number) => void; onCancel: () => void }) {
  const [enemy, setEnemy] = useState<Enemy>('script');
  const [turn, setTurn] = useState(12);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal ag-take" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><b>Принять командование — агентная модель</b></div>
        <div className="modal-body">
          <p>С {ddmm(start, hour)} МСК советскими армиями командуете вы: приказы армиям доходят до всех их дивизий (с задержкой штаба армии), дивизии исполняют их сами — марш, развёртывание, бой, отход. До этого часа — расчёт по историческим задачам.</p>
          <label>Противник
            <select value={enemy} onChange={(e) => setEnemy(e.target.value as Enemy)}>
              <option value="script">по историческим приказам сценария</option>
              <option value="doctrine">штабы по доктрине — отвечают на обстановку</option>
            </select>
          </label>
          <label>Ход
            <select value={turn} onChange={(e) => setTurn(+e.target.value)}>{[6, 12, 24].map((h) => <option key={h} value={h}>{h} ч</option>)}</select>
          </label>
        </div>
        <div className="modal-f"><button onClick={onCancel}>Отмена</button><button className="primary" onClick={() => onStart(enemy, turn)}>Начать</button></div>
      </div>
    </div>
  );
}

export function AgentGamePanel({ trace, g, busy, pick, setPick, setDrafts, onTurn, onExit }: {
  trace: AgentTrace; g: AgentGameState; busy: string | null; pick: string | null; setPick: (hq: string | null) => void;
  setDrafts: (d: Record<string, Draft>) => void; onTurn: () => void; onExit: () => void;
}) {
  const armies = playerArmies(trace, g.hour);
  const set = (hq: string, d: Draft | null) => { const n = { ...g.drafts }; if (d) n[hq] = d; else delete n[hq]; setDrafts(n); };
  const name = (hq: string) => trace.hqs.find((h) => h.id === hq)?.name ?? hq;
  return (
    <div className="ag-game">
      <div className="ag-game-h">
        <b>Игра: советские армии</b>
        <span>командование с {ddmm(trace.start, g.takeover)} · сейчас {ddmm(trace.start, g.hour)} МСК · противник {g.enemy === 'script' ? 'по сценарию' : 'по доктрине'}</span>
      </div>
      <div className="ag-game-f">
        {g.over ? <div className="muted">Операция окончена: итог — на карте и в событиях.</div>
          : <button className="rp-go primary" disabled={!!busy} onClick={onTurn}>{busy ? <><span className="spinner" /> {busy}</> : `Ход: +${g.turnHours} ч${Object.keys(g.drafts).length ? `, приказов ${Object.keys(g.drafts).length}` : ''}`}</button>}
        <button className="link" disabled={!!busy} onClick={onExit}>выйти из игры</button>
      </div>
      {g.applied.length > 0 && <div className="ag-applied">
        {g.applied.map((a) => <div key={a.hq} className={a.error ? 'err' : ''}>{name(a.hq)}: {a.error ?? `приказ отдан ${a.divisions} дивизиям`}</div>)}
      </div>}
      <div className="ag-armies">
        {armies.map((a) => {
          const d = g.drafts[a.id];
          return (
            <div key={a.id} className={`ag-army${d ? ' on' : ''}`}>
              <div className="ag-army-h"><b>{a.name}</b><span>{a.divisions} див. · {Math.round(a.people / 1000)} тыс.</span></div>
              {a.order && <div className="muted small" title={a.full ?? ''}>последний приказ: {a.order}{a.orderAt != null ? ` (${ddmm(trace.start, a.orderAt)})` : ''}</div>}
              <div className="ag-army-o">
                <select value={d?.kind ?? ''} disabled={!!busy || g.over} onChange={(e) => set(a.id, e.target.value ? { kind: e.target.value as OrderKind, target: d?.target ?? null } : null)}>
                  <option value="">— без нового приказа</option>
                  {(Object.keys(ORDER_RU) as OrderKind[]).map((k) => <option key={k} value={k}>{ORDER_RU[k]}</option>)}
                </select>
                {d && <button className={pick === a.id ? 'on' : ''} disabled={!!busy} onClick={() => setPick(pick === a.id ? null : a.id)} title="Щёлкните по карте — цель приказа">
                  {pick === a.id ? 'щёлкните по карте…' : d.target ? `цель ${d.target[1].toFixed(2)}, ${d.target[0].toFixed(2)}` : 'на месте · цель…'}</button>}
                {d?.target && <button className="link" onClick={() => set(a.id, { ...d, target: null })} title="Без цели — на месте">×</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Цели приказов на карте: флажок с названием армии. */
export function DraftPins({ engine, trace, drafts }: { engine: MapEngine; trace: AgentTrace; drafts: Record<string, Draft> }) {
  const [, redraw] = useState(0);
  useEffect(() => engine.on('view', () => redraw((n) => n + 1)), [engine]);
  const host = engine.getContainer().getBoundingClientRect();
  return <>{Object.entries(drafts).filter(([, d]) => d.target).map(([hq, d]) => {
    const p = engine.project(d.target!);
    const name = trace.hqs.find((h) => h.id === hq)?.name.replace(/гвардейская/, 'гв.').replace(/армия/, 'А') ?? hq;
    return <div key={hq} className="ag-pin" style={{ left: host.left + p[0], top: host.top + p[1] }}><span>⚑ {name}: {ORDER_RU[d.kind]}</span></div>;
  })}</>;
}
