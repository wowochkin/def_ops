// Окружение голоса (services/voice/.venv) при запуске приложения из исходников: нет — ставится само (один раз, несколько
// минут); есть — проверка за пару секунд. Голос необязателен: не вышло — приложение запустится без него.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Нужна ли установка: Mac на Apple Silicon, не отключено (DEFOPS_NO_VOICE), окружения нет или в нём нет нужных пакетов. */
export function needsVoiceSetup({ platform, arch, disabled, hasPython, importsOk }) {
  if (disabled || platform !== 'darwin' || arch !== 'arm64') return false;
  return !hasPython || !importsOk;
}

const IMPORTS = 'import mlx_audio, gigaam, silero_vad, livekit, fastapi';

export function ensureVoiceEnv(voiceDir, log = (s) => process.stderr.write(`${s}\n`)) {
  const python = join(voiceDir, '.venv', 'bin', 'python');
  const hasPython = existsSync(python);
  const importsOk = hasPython && spawnSync(python, ['-c', IMPORTS], { stdio: 'ignore' }).status === 0;
  const need = needsVoiceSetup({ platform: process.platform, arch: process.arch, disabled: !!process.env.DEFOPS_NO_VOICE, hasPython, importsOk });
  if (!need) return 'ok';
  log('Голос: окружения нет или оно неполное — ставлю (один раз, несколько минут; нужен интернет, uv и ffmpeg).');
  const r = spawnSync('bash', [join(voiceDir, 'setup.sh')], { stdio: 'inherit' });
  if (r.status === 0) return 'installed';
  log('Голос не установился (см. сообщение выше). Приложение запустится без голоса; повторить: npm run voice:setup. Отключить попытки: DEFOPS_NO_VOICE=1.');
  return 'failed';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureVoiceEnv(resolve(dirname(fileURLToPath(import.meta.url)), '../../../services/voice'));
}
