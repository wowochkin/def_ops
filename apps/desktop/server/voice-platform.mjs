// Собственный runtime переносимого комплекта; venv остаётся только режимом разработки.
import { posix, win32 } from 'node:path';

export const voiceSupported = (platform = process.platform, arch = process.arch) =>
  (platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64');

export const voicePython = (dir, platform = process.platform, runtime = process.env.DEFOPS_VOICE_RUNTIME) => {
  const path = platform === 'win32' ? win32 : posix;
  return runtime ? path.join(runtime, 'python', platform === 'win32' ? 'python.exe' : 'bin/python3')
    : platform === 'win32' ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python');
};

export const voiceEnvironment = (env = process.env, platform = process.platform, runtime = env.DEFOPS_VOICE_RUNTIME, data) => {
  const result = { ...env };
  if (platform === 'win32') result.DEFOPS_VOICE_OFFLINE ??= '1';
  if (!runtime) return result;
  const path = platform === 'win32' ? win32 : posix;
  // Ни пользовательский Python, ни глобальные кэши не участвуют в автономном запуске.
  delete result.PYTHONHOME; delete result.PYTHONPATH; delete result.VIRTUAL_ENV;
  for (const key of Object.keys(result)) if (/^DYLD_|^LD_LIBRARY_PATH$/.test(key)) delete result[key];
  const previousPath = result.PATH ?? result.Path ?? '';
  delete result.Path;
  return { ...result, DEFOPS_VOICE_RUNTIME: runtime, DEFOPS_VOICE_OFFLINE: '1',
    DEFOPS_VOICE_MODELS: path.join(runtime, 'models', 'voice'), DEFOPS_VOICE_DEFAULT_ENGINE: 'qwen3-ru-stress',
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1',
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
    PATH: path.join(runtime, 'bin') + path.delimiter + previousPath,
    ...(data ? { HF_HOME: path.join(data, 'cache', 'huggingface'), XDG_CACHE_HOME: path.join(data, 'cache'),
      NUMBA_CACHE_DIR: path.join(data, 'cache', 'numba'), TORCH_HOME: path.join(data, 'cache', 'torch') } : {}),
  };
};
