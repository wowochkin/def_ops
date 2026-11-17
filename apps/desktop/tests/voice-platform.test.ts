import { describe, expect, it } from 'vitest';
import { voiceEnvironment, voicePython, voiceSupported } from '../server/voice-platform.mjs';
import { needsVoiceSetup } from '../server/voice-env.mjs';

describe('голос на выставочной Windows-машине', () => {
  it('Windows по умолчанию запрещает загрузки моделей; сохраняет явный выбор и прочее окружение', () => {
    const env = { PATH: 'test' };
    expect(voiceEnvironment(env, 'win32')).toEqual({ PATH: 'test', DEFOPS_VOICE_OFFLINE: '1' });
    expect(voiceEnvironment({ DEFOPS_VOICE_OFFLINE: '0' }, 'win32').DEFOPS_VOICE_OFFLINE).toBe('0');
    expect(voiceEnvironment(env, 'darwin')).toEqual(env);
    expect(env).toEqual({ PATH: 'test' });
  });
  it('выбирает Python Windows venv, включая путь с пробелами и кириллицей', () => {
    expect(voicePython('C:\\Users\\Иван\\Выставка', 'win32')).toBe('C:\\Users\\Иван\\Выставка\\.venv\\Scripts\\python.exe');
    expect(voicePython('/tmp/голос', 'darwin')).toBe('/tmp/голос/.venv/bin/python');
  });
  it('допускает Windows x64 и сохраняет поддержку Apple Silicon', () => {
    expect(voiceSupported('win32', 'x64')).toBe(true);
    expect(voiceSupported('darwin', 'arm64')).toBe(true);
    expect(voiceSupported('win32', 'arm64')).toBe(false);
    expect(needsVoiceSetup({ platform: 'win32', arch: 'x64', disabled: false, hasPython: false, importsOk: false })).toBe(true);
  });
});

it('переносимый runtime не зависит от venv, HOME или пользовательского Python', () => {
  const runtime = '/Applications/Выставка 1943/runtime';
  expect(voicePython('/old/service', 'darwin', runtime)).toBe(`${runtime}/python/bin/python3`);
  expect(voicePython('D:\\Стенд', 'win32', 'E:\\Выставка 1943\\runtime')).toBe('E:\\Выставка 1943\\runtime\\python\\python.exe');
  const env = voiceEnvironment({ PATH: '/usr/bin', PYTHONHOME: '/old', PYTHONPATH: '/old/lib', DYLD_LIBRARY_PATH: '/opt/homebrew/lib', DEFOPS_VOICE_OFFLINE: '0' }, 'darwin', runtime, '/tmp/Профиль 1');
  expect(env.PYTHONHOME).toBeUndefined();
  expect(env.PYTHONPATH).toBeUndefined();
  expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
  expect(env.DEFOPS_VOICE_MODELS).toBe(`${runtime}/models/voice`);
  expect(env.DEFOPS_VOICE_OFFLINE).toBe('1');
  expect(env.HF_HUB_OFFLINE).toBe('1');
  expect(env.PATH).toBe(`${runtime}/bin:/usr/bin`);
  expect(env.HF_HOME).toBe('/tmp/Профиль 1/cache/huggingface');
});
