import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { contextFrom, type AgentHistory } from '@def-ops/sim';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../../packages/sim/src/data';
// @ts-expect-error модуль на JS без типов
import { agentsProcess } from '../../../scripts/agents-bridge.mjs';
import { BANK, turnCards, type TurnN } from '../src/expo/bank';
import { ExpoSession, type ModelEnv } from '../src/expo/session';
import type { FrontId } from '../src/expo/settings';

const ROOT = join(__dirname, '../../..');
const BIN = join(ROOT, 'target/release', process.platform === 'win32' ? 'agents-game.exe' : 'agents-game');
const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};

it('диагностика промедления', async () => {
  const { ctx, history } = await contextFrom(get as never, BANK.context);
  const h = JSON.parse(readFileSync(join(ROOT, BANK.history), 'utf8')) as AgentHistory;
  const core = agentsProcess(BIN);
  const play = async (front: FrontId, delayAt?: TurnN) => {
    const calls: unknown[] = [];
    const env: ModelEnv = {
      call: async (cmd, args) => { calls.push({ cmd, args }); return core.call(cmd, args); },
      ctx, history: h, baseHistory: history,
      placeAt: (p) => (ctx.theatre.area(p)?.center as [number, number] | undefined) ?? null,
    };
    const s = new ExpoSession(env, BANK, front);
    await s.start();
    const steps: unknown[] = [];
    for (const n of [1, 2, 3] as TurnN[]) {
      const want = n === delayAt ? 'delay' : turnCards(BANK, front, n).find((c) => c.historical)!.id;
      s.deal(n);
      s.view.cards = [{ id: want === 'delay' ? s.view.cards[0].id : want, title: '', lines: [] }];
      await s.decide(n, want === 'delay' ? 'delay' : 0);
      steps.push({ n, time: s.view.time, axes: s.view.scales.axes, loss: s.view.loss, tasks: s.view.tasks });
    }
    return { front, delayAt, final: s.view.final, steps, calls: calls.filter((x) => (x as { cmd: string }).cmd !== 'game_start') };
  };
  try {
    for (const [front, n] of [['su_1bf', 1], ['su_1uf', 2]] as [FrontId, TurnN][]) {
      console.log('HISTORY', JSON.stringify(await play(front), null, 2));
      console.log('DELAY', JSON.stringify(await play(front, n), null, 2));
    }
  } finally { core.close?.(); }
}, 120_000);
