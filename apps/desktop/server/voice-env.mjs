// Окружение голоса (services/voice/.venv) при запуске приложения из исходников: нет — ставится само (один раз, несколько
// минут); есть — проверка за пару секунд. Голос необязателен: не вышло — приложение запустится без него.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voicePython, voiceSupported } from './voice-platform.mjs';

/** Нужна ли установка на поддерживаемой платформе: не отключено, окружения нет или в нём нет нужных пакетов. */
export function needsVoiceSetup({ platform, arch, disabled, hasPython, importsOk }) {
  if (disabled || !voiceSupported(platform, arch)) return false;
  return !hasPython || !importsOk;
}

const IMPORTS = process.platform === 'win32'
  ? 'import qwen_tts, torch, onnxruntime, gigaam, silero_vad, livekit, fastapi'
  : 'import mlx_audio, gigaam, silero_vad, livekit, fastapi';

export function ensureVoiceEnv(voiceDir, log = (s) => process.stderr.write(`${s}\n`)) {
  const python = voicePython(voiceDir);
  const hasPython = existsSync(python);
  const importsOk = hasPython && spawnSync(python, ['-c', IMPORTS], { stdio: 'ignore' }).status === 0;
  const need = needsVoiceSetup({ platform: process.platform, arch: process.arch, disabled: !!process.env.DEFOPS_NO_VOICE, hasPython, importsOk });
  if (!need) return 'ok';
  if (process.env.DEFOPS_VOICE_OFFLINE === '1') {
    log('Голос: автономный режим, установка из сети запрещена. Подготовьте Python-окружение и модели заранее.');
    return 'failed';
  }
  log(`Голос: окружения нет или оно неполное — ставлю (один раз, несколько минут; нужен интернет, ${process.platform === 'win32' ? 'Python 3.12 x64' : 'uv'} и ffmpeg).`);
  const r = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(voiceDir, 'setup.ps1')], { stdio: 'inherit' })
    : spawnSync('bash', [join(voiceDir, 'setup.sh')], { stdio: 'inherit' });
  if (r.status === 0) return 'installed';
  log('Голос не установился (см. сообщение выше). Приложение запустится без голоса; повторить: npm run voice:setup. Отключить попытки: DEFOPS_NO_VOICE=1.');
  return 'failed';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = ensureVoiceEnv(resolve(dirname(fileURLToPath(import.meta.url)), '../../../services/voice'));
  // Автозапуск редактора допускает работу без голоса; явная установка сообщает об ошибке вызывающему процессу.
  if (process.argv.includes('--setup') && result === 'failed') process.exitCode = 1;
}
