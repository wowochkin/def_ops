/**
 * Проверки переломов с настоящим ядром (target/release/agents-game; нет бинаря — пропуск): «как было» воспроизводит
 * историю, каждая карточка даёт свой результат, промедление хуже любой карточки перелома, сеанс укладывается во время.
 * EXPO_BANK_WRITE=1 — пересчитать эталон потерь банка по ходу «как было».
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contextFrom, lossSeries, type AgentHistory } from '@def-ops/sim';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../../packages/sim/src/data';
// @ts-expect-error модуль на JS без типов
import { agentsProcess } from '../../../scripts/agents-bridge.mjs';
import { BANK, turnCards, type TurnN } from '../src/expo/bank';
import { axesSum } from '../src/expo/score';
import { ExpoSession, type ModelEnv } from '../src/expo/session';
import type { FrontId } from '../src/expo/settings';

const ROOT = join(__dirname, '../../..');
const BIN = join(ROOT, 'target/release/agents-game');
const BANK_FILE = join(ROOT, 'apps/editor/src/expo/bank-data/berlin-1945.cards.json');
const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};

type Core = { call: (cmd: string, args: object) => Promise<unknown>; close?: () => void };
type Plan = Partial<Record<TurnN, string | 'delay'>>;

async function setup() {
  const { ctx, history } = await contextFrom(get as never, BANK.context);
  const h = JSON.parse(readFileSync(join(ROOT, BANK.history), 'utf8')) as AgentHistory;
  const pool: Core[] = Array.from({ length: 4 }, () => agentsProcess(BIN));
  const free = [...pool];
  const waiters: ((c: Core) => void)[] = [];
  const take = () => new Promise<Core>((res) => { const c = free.pop(); if (c) res(c); else waiters.push(res); });
  const give = (c: Core) => { const w = waiters.shift(); if (w) w(c); else free.push(c); };
  /** Сеанс: на переломах — карточки плана, без указания — историческая. */
  const play = async (front: FrontId, plan: Plan) => {
    const core = await take();
    try {
      const env: ModelEnv = { call: (cmd, args) => core.call(cmd, args), ctx, history: h, baseHistory: history, placeAt: (p) => (ctx.theatre.area(p)?.center as [number, number] | undefined) ?? null };
      const s = new ExpoSession(env, BANK, front);
      await s.start();
      for (const n of [1, 2, 3] as TurnN[]) {
        const want = plan[n] ?? turnCards(BANK, front, n).find((c) => c.historical)!.id;
        s.deal(n);
        s.view.cards = [{ id: want === 'delay' ? s.view.cards[0].id : want, title: '', lines: [] }];
        await s.decide(n, want === 'delay' ? 'delay' : 0);
      }
      const t = s.lastTrace as unknown as { game: { digest: string } };
      return { view: s.view, digest: t.game.digest, trace: s.lastTrace! };
    } finally { give(core); }
  };
  return { play, close: () => pool.forEach((c) => c.close?.()) };
}

describe.skipIf(!existsSync(BIN))('переломы с настоящим ядром', () => {
  for (const front of Object.keys(BANK.fronts) as FrontId[]) {
    it(`${front}: history, every card, delay`, async () => {
      const { play, close } = await setup();
      try {
        const t0 = Date.now();
        let hist = await play(front, {});
        const sessionMs = Date.now() - t0;
        if (process.env.EXPO_BANK_WRITE) {
          const losses = Array.from({ length: BANK.end / 24 + 1 }, (_, d) => d === 0 ? 0 : lossSeries(hist.trace, d * 24).rows.find((r) => r.id === front)!.total.personnel);
          BANK.reference[front] = { losses };
          const text = readFileSync(BANK_FILE, 'utf8');
          const ref = Object.entries(BANK.reference).map(([f, r]) => `    "${f}": { "losses": ${JSON.stringify(r!.losses)} }`).join(',\n');
          writeFileSync(BANK_FILE, text.replace(/"reference": \{[\s\S]*\}\s*\}\s*$/, `"reference": {\n${ref}\n  }\n}\n`));
          hist = await play(front, {});
        }
        // «как было»: ключевые события фронта — в пределах трёх суток истории, потери — как в эталоне
        const keys = BANK.fronts[front].keyEvents;
        expect(hist.view.final!.matches).toBe(3);
        expect(hist.view.final!.scales.axes.done).toBe(keys.length);
        expect(Math.abs(hist.view.final!.scales.axes.days!)).toBeLessThanOrEqual(3);
        expect(hist.view.final!.scales.axes.lossRatio!).toBeCloseTo(1, 2);
        expect(sessionMs).toBeLessThan(15_000);
        const rows: string[] = [];
        const digests = new Set([hist.digest]);
        const checks: (() => void)[] = [];
        for (const n of [1, 2, 3] as TurnN[]) {
          const own = turnCards(BANK, front, n).filter((c) => !c.historical);
          const [delay, ...cards] = await Promise.all([play(front, { [n]: 'delay' }), ...own.map((c) => play(front, { [n]: c.id }))]);
          const score = (r: typeof hist) => axesSum(r.view.final!.scales.axes);
          rows.push(`${n}: история ${score(hist).toFixed(2)}, промедление ${score(delay).toFixed(2)}, ${own.map((c, i) => `${c.id} ${score(cards[i]).toFixed(2)}`).join(', ')}`);
          checks.push(() => {
            for (const [i, c] of cards.entries()) {
              expect(digests.has(c.digest), `${own[i].id}: тот же результат, что у другой карточки`).toBe(false);
              digests.add(c.digest);
              expect(score(delay), `${front} перелом ${n}: промедление не хуже ${own[i].id}`).toBeLessThan(score(c));
            }
            expect(score(delay)).toBeLessThan(score(hist));
          });
        }
        console.log(`${front}\n${rows.join('\n')}`);
        for (const c of checks) c();
      } finally { close(); }
    }, 240_000);
  }
});
