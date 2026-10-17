// Голосовой сервис (Python, services/voice) рядом с остальными сервисами приложения. Необязателен: нет окружения
// или сервис упал — приложение работает без голоса. Состояние пишется в <данные>/voice/state.json, шлюз отдаёт его
// как GET /api/voice.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VOICE_PORT = 47645;
const HEALTH_WAIT_MS = 5 * 60_000;
const RESTART_MS = 5000;
const RESTARTS_MAX = 3;

/** Что делать с голосом: порт уже отвечает — подключиться; есть Python окружения — запустить; иначе выключено. */
export function voicePlan({ python, portAnswers }) {
  if (portAnswers) return 'attach';
  return python ? 'spawn' : 'off';
}

/** Пауза перед очередным перезапуском подряд (n — сколько уже было); null — хватит. */
export function restartDelay(n) {
  return n < RESTARTS_MAX ? RESTART_MS : null;
}

const healthUrl = `http://127.0.0.1:${VOICE_PORT}/health`;
async function health() {
  try {
    const r = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Запуск голоса. Возвращает управление сразу после выбора плана — дальше сервис опрашивается в фоне.
 * @param {{ repo: string, data: string, voiceDir: string, log?: (s: string) => void }} o
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startVoice({ repo, data, voiceDir, log = () => {} }) {
  const dir = join(data, 'voice');
  mkdirSync(dir, { recursive: true });
  const stateFile = join(dir, 'state.json');
  const write = (state, error) => {
    const body = JSON.stringify({ state, port: VOICE_PORT, ...(error ? { error } : {}) });
    try { writeFileSync(stateFile + '.tmp', body); renameSync(stateFile + '.tmp', stateFile); } catch (e) { log(`не записать состояние: ${e.message}`); }
  };
  const python = join(voiceDir, '.venv', 'bin', 'python');
  const plan = voicePlan({ python: existsSync(python), portAnswers: (await health()) !== null });
  let stopping = false, child = null;
  const stop = () => {
    stopping = true;
    const c = child;
    if (!c) return;
    c.kill('SIGTERM');
    // не вышел за 300 мс (родитель выходит через 500) — добиваем, чтобы Python не остался сиротой
    setTimeout(() => { if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL'); }, 300);
  };
  if (plan === 'off') { write('off'); log('голос выключен: нет окружения'); return { stop }; }

  // опрос /health раз в секунду, пока не ready/error или пока жив запущенный процесс (не дольше 5 мин)
  const poll = async (alive) => {
    const until = Date.now() + HEALTH_WAIT_MS;
    while (!stopping && alive() && Date.now() < until) {
      const h = await health();
      if (h?.state === 'ready') { write('ready'); return true; }
      if (h?.state === 'error') { write('error', h.error ?? 'голос не запустился'); return false; }
      await sleep(1000);
    }
    if (!stopping && alive()) write('error', 'голос не ответил за 5 минут');
    return false;
  };

  write('loading');
  if (plan === 'attach') { void poll(() => true); return { stop }; }

  const run = (restarts) => {
    child = spawn(python, ['server.py', '--port', String(VOICE_PORT), '--data', dir, '--seed-refs', join(repo, 'scripts', 'voice-bench')],
      { cwd: voiceDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const me = child;
    let alive = true, becameReady = false;
    const out = (d) => log(d.toString().split('\n').filter(Boolean).map((l) => `[voice] ${l}`).join('\n'));
    me.stdout.on('data', out); me.stderr.on('data', out);
    let gone = false;
    // ошибка запуска (ENOENT и т. п.) может не сопровождаться exit — считаем её выходом, один раз
    me.on('error', (e) => { log(`[voice] не запустился: ${e.message}`); onGone(e.code ?? 'ошибка запуска'); });
    me.on('exit', (code) => onGone(code));
    const onGone = (code) => {
      if (gone) return;
      gone = true;
      alive = false;
      if (stopping) return;
      // сервис, дошедший до ready, начинает счёт перезапусков заново
      const n = becameReady ? 0 : restarts;
      const delay = restartDelay(n);
      if (delay === null) { write('error', `голос остановился (код ${code})`); log(`[voice] остановился (код ${code}), перезапуски исчерпаны`); return; }
      write('loading', 'голос остановился, перезапускаю');
      log(`[voice] остановился (код ${code}), перезапуск через ${delay / 1000} с`);
      setTimeout(() => { if (!stopping) run(n + 1); }, delay);
    };
    void poll(() => alive).then((ok) => { if (ok && alive) becameReady = true; });
  };
  run(0);
  return { stop };
}
