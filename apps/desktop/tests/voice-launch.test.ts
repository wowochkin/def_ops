/** Запуск голосового сервиса вместе с приложением: решение о запуске и пауза перед перезапуском. */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voicePlan, restartDelay, startVoice } from '../server/voice.mjs';

describe('voicePlan', () => {
  const mac = { installed: true, supported: true };
  it('порт отвечает — подключаемся к чужому процессу', () => {
    expect(voicePlan({ ...mac, python: false, portAnswers: true })).toBe('attach');
    expect(voicePlan({ ...mac, python: true, portAnswers: true })).toBe('attach');
    expect(voicePlan({ installed: false, supported: false, python: false, portAnswers: true })).toBe('attach');
  });
  it('порт молчит, окружение есть — запускаем сами', () => {
    expect(voicePlan({ ...mac, python: true, portAnswers: false })).toBe('spawn');
  });
  it('папка сервиса есть, окружения нет — голос не установлен (off)', () => {
    expect(voicePlan({ ...mac, python: false, portAnswers: false })).toBe('off');
  });
  it('нет папки сервиса (установленная программа) или не Mac на Apple Silicon — голос в этой версии недоступен', () => {
    expect(voicePlan({ installed: false, supported: true, python: false, portAnswers: false })).toBe('unsupported');
    expect(voicePlan({ installed: true, supported: false, python: true, portAnswers: false })).toBe('unsupported');
  });
});

describe('restartDelay', () => {
  it('5 секунд для первых трёх перезапусков, потом отказ', () => {
    expect([0, 1, 2].map(restartDelay)).toEqual([5000, 5000, 5000]);
    expect(restartDelay(3)).toBeNull();
    expect(restartDelay(10)).toBeNull();
  });
});

describe('startVoice', () => {
  it('приложение уже останавливается — процесс не запускается, состояние не пишется', async () => {
    const d = mkdtempSync(join(tmpdir(), 'voice-stop-'));
    try {
      mkdirSync(join(d, 'v/.venv/bin'), { recursive: true });
      writeFileSync(join(d, 'v/.venv/bin/python'), `#!/bin/sh\ntouch "${d}/started"\n`);
      chmodSync(join(d, 'v/.venv/bin/python'), 0o755);
      await startVoice({ repo: d, data: d, voiceDir: join(d, 'v'), isStopping: () => true });
      await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(join(d, 'started'))).toBe(false);
      expect(existsSync(join(d, 'voice/state.json'))).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('нет папки голосового сервиса — состояние unsupported, процесс не запускается', async () => {
    const d = mkdtempSync(join(tmpdir(), 'voice-none-'));
    try {
      await startVoice({ repo: d, data: d, voiceDir: join(d, 'нет') });
      expect(JSON.parse(readFileSync(join(d, 'voice/state.json'), 'utf8')).state).toBe('unsupported');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

import { needsVoiceSetup } from '../server/voice-env.mjs';

describe('needsVoiceSetup', () => {
  const mac = { platform: 'darwin', arch: 'arm64', disabled: false };
  it('Mac на Apple Silicon: нет окружения или в нём не хватает пакетов — ставить', () => {
    expect(needsVoiceSetup({ ...mac, hasPython: false, importsOk: false })).toBe(true);
    expect(needsVoiceSetup({ ...mac, hasPython: true, importsOk: false })).toBe(true);
  });
  it('окружение целое — не трогать', () => {
    expect(needsVoiceSetup({ ...mac, hasPython: true, importsOk: true })).toBe(false);
  });
  it('другая система или отключено — не ставить', () => {
    expect(needsVoiceSetup({ platform: 'linux', arch: 'x64', disabled: false, hasPython: false, importsOk: false })).toBe(false);
    expect(needsVoiceSetup({ platform: 'darwin', arch: 'x64', disabled: false, hasPython: false, importsOk: false })).toBe(false);
    expect(needsVoiceSetup({ ...mac, disabled: true, hasPython: false, importsOk: false })).toBe(false);
  });
});
