// Мост к ядру агентной модели для браузера (снимки экрана и проверки без окна настольного приложения): страница
// получает window.__TAURI_INTERNALS__.invoke, а вызовы уходят строками JSON в процесс target/release/agents-game
// ({"cmd", "args"} → {"ok"} | {"error"}). Те же команды, что у приложения (crates/agents-tauri).
//
//   import { attachAgentsBridge } from './agents-bridge.mjs'; await attachAgentsBridge(page);
//   node scripts/agents-bridge.mjs --check   — игра Берлинской через мост: «гибрид», поданные директивы, ход
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'target/release/agents-game');

/** Процесс ядра: вызовы по очереди, ответ — строка на вызов. */
export function agentsProcess(bin = BIN) {
  if (!existsSync(bin)) throw new Error(`нет ${bin}: cargo build --release -p agents-core --bin agents-game`);
  const p = spawn(bin, [], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, DEFOPS_ROOT: ROOT } });
  const waiting = [];
  createInterface({ input: p.stdout }).on('line', (l) => waiting.shift()?.(l));
  let chain = Promise.resolve();
  const call = (cmd, args = {}) => {
    const r = chain.then(() => new Promise((res, rej) => {
      waiting.push((l) => { const v = JSON.parse(l); if ('error' in v) rej(new Error(v.error)); else res(v.ok); });
      p.stdin.write(`${JSON.stringify({ cmd, args })}\n`);
    }));
    chain = r.catch(() => undefined);
    return r;
  };
  return { call, stop: () => p.kill() };
}

/** Команды приложения, которых нет у ядра (модель, проверки связи): ответ — ошибка, как без LM Studio. */
const ABSENT = new Set(['list_models', 'llm_chat_stream', 'llm_cancel', 'probe_parallel']);

/** Подключить мост к странице Playwright (до загрузки страницы). */
export async function attachAgentsBridge(page, opts = {}) {
  const core = agentsProcess(opts.bin);
  await page.exposeFunction('__agentsInvoke', async (cmd, args) => {
    if (ABSENT.has(cmd)) return { error: `${cmd}: нет в мосте к ядру` };
    try { return { ok: await core.call(cmd, args ?? {}) }; } catch (e) { return { error: String(e?.message ?? e) }; }
  });
  await page.addInitScript(() => {
    let cb = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (f) => { const id = ++cb; window[`_${id}`] = f; return id; },
      invoke: async (cmd, args) => { const r = await window.__agentsInvoke(cmd, args); if ('error' in r) throw r.error; return r.ok; },
    };
  });
  return core;
}

if (process.argv.includes('--check')) {
  const core = agentsProcess();
  try {
    const path = 'packages/sim/data/scenarios/agents/berlin-1945.json';
    const t0 = await core.call('game_start', { scenario: path, seed: 1, takeover: 0, player: 'su', enemy: 'script', mode: 'hybrid' });
    const hist = [...new Set(t0.command.historical.map((h) => h.id))];
    if (t0.command.mode !== 'hybrid' || !hist.length) throw new Error(`режим ${t0.command.mode}, директив ${hist.length}`);
    const t1 = await core.call('game_turn', { orders: [], hours: 12, command: hist.map((id) => ({ op: 'historical', id })) });
    if (t1.game.commandErrors.length) throw new Error(t1.game.commandErrors.join('; '));
    if (!t1.command.historical.every((h) => h.issued)) throw new Error('не все директивы поданы');
    if (t1.game.hour !== 12) throw new Error(`час ${t1.game.hour}`);
    console.log('ok');
  } finally { core.stop(); }
}
