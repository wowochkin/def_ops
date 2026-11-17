// Голосовой сервис (Python, services/voice) рядом с остальными сервисами приложения. Необязателен: нет окружения
// или сервис упал — приложение работает без голоса. Состояние пишется в <данные>/voice/state.json, шлюз отдаёт его
// как GET /api/voice.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { voiceEnvironment, voicePython, voiceSupported } from './voice-platform.mjs';

export const VOICE_PORT = 47645;
const HEALTH_WAIT_MS = 5 * 60_000;
const RESTART_MS = 5000;
const RESTARTS_MAX = 3;

/**
 * Что делать с голосом: порт уже отвечает — подключиться; нет папки сервиса (установленная программа) или не Mac на
 * Apple Silicon / Windows x64 — голоса в этой версии нет (unsupported); есть Python окружения — запустить; иначе не установлен (off).
 */
export function voicePlan({ python, portAnswers, installed, supported }) {
  if (portAnswers) return 'attach';
  if (!installed || !supported) return 'unsupported';
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
 * @param {{ repo: string, data: string, voiceDir: string, log?: (s: string) => void, isStopping?: () => boolean }} o
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startVoice({ repo, data, voiceDir, log = () => {}, isStopping = () => false }) {
  const dir = join(data, 'voice');
  mkdirSync(dir, { recursive: true });
  const stateFile = join(dir, 'state.json');
  const write = (state, error) => {
    const body = JSON.stringify({ state, port: VOICE_PORT, ...(error ? { error } : {}) });
    try { writeFileSync(stateFile + '.tmp', body); renameSync(stateFile + '.tmp', stateFile); } catch (e) { log(`не записать состояние: ${e.message}`); }
  };
  const python = voicePython(voiceDir);
  const plan = voicePlan({
    python: existsSync(python), portAnswers: (await health()) !== null,
    installed: existsSync(join(voiceDir, 'server.py')), supported: voiceSupported(),
  });
  let stopped = false, child = null;
  const stopping = () => stopped || isStopping();
  const stop = () => {
    stopped = true;
    const c = child;
    if (!c) return;
    c.kill('SIGTERM');
    // не вышел за 300 мс (родитель выходит через 500) — добиваем, чтобы Python не остался сиротой
    setTimeout(() => { if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL'); }, 300);
  };
  if (stopping()) return { stop }; // приложение уже останавливается — ничего не запускаем
  if (plan === 'unsupported') { write('unsupported'); log('голос недоступен: требуется Mac с Apple Silicon или Windows x64 с NVIDIA CUDA и папка голосового сервиса'); return { stop }; }
  if (plan === 'off') { write('off', 'Нет Python-окружения голоса. Подготовьте его и модели до отключения сети.'); log(`голос выключен: нет ${python}`); return { stop }; }

  // опрос /health раз в секунду, пока не ready/error или пока жив запущенный процесс (не дольше 5 мин)
  const poll = async (alive) => {
    const until = Date.now() + HEALTH_WAIT_MS;
    while (!stopping() && alive() && Date.now() < until) {
      const h = await health();
      if (h?.state === 'ready') { write('ready'); return true; }
      if (h?.state === 'error') { write('error', h.error ?? 'голос не запустился'); return false; }
      await sleep(1000);
    }
    if (!stopping() && alive()) write('error', 'голос не ответил за 5 минут');
    return false;
  };

  write('loading');
  if (plan === 'attach') { void poll(() => true); return { stop }; }

  const run = (restarts) => {
    child = spawn(python, ['server.py', '--port', String(VOICE_PORT), '--data', dir, '--seed-refs', join(repo, 'scripts', 'voice-bench')],
      { cwd: voiceDir, env: voiceEnvironment(process.env, process.platform, process.env.DEFOPS_VOICE_RUNTIME, dir), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const me = child;
    let alive = true, becameReady = false;
    const out = (d) => log(d.toString().split('\n').filter(Boolean).map((l) => `[voice] ${l}`).join('\n'));
    me.stdout.setEncoding('utf8'); me.stderr.setEncoding('utf8');
    me.stdout.on('data', out); me.stderr.on('data', out);
    let gone = false;
    // ошибка запуска (ENOENT и т. п.) может не сопровождаться exit — считаем её выходом, один раз
    me.on('error', (e) => { log(`[voice] не запустился: ${e.message}`); onGone(e.code ?? 'ошибка запуска'); });
    me.on('exit', (code) => onGone(code));
    const onGone = (code) => {
      if (gone) return;
      gone = true;
      alive = false;
      if (stopping()) return;
      // сервис, дошедший до ready, начинает счёт перезапусков заново
      const n = becameReady ? 0 : restarts;
      const delay = restartDelay(n);
      if (delay === null) { write('error', `голос остановился (код ${code})`); log(`[voice] остановился (код ${code}), перезапуски исчерпаны`); return; }
      write('loading', 'голос остановился, перезапускаю');
      log(`[voice] остановился (код ${code}), перезапуск через ${delay / 1000} с`);
      setTimeout(() => { if (!stopping()) run(n + 1); }, delay);
    };
    void poll(() => alive).then((ok) => { if (ok && alive) becameReady = true; });
  };
  run(0);
  return { stop };
}
