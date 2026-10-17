/** Запуск голосового сервиса вместе с приложением: решение о запуске и пауза перед перезапуском. */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voicePlan, restartDelay, startVoice } from '../server/voice.mjs';

describe('voicePlan', () => {
  it('порт отвечает — подключаемся к чужому процессу', () => {
    expect(voicePlan({ python: false, portAnswers: true })).toBe('attach');
    expect(voicePlan({ python: true, portAnswers: true })).toBe('attach');
  });
  it('порт молчит, окружение есть — запускаем сами', () => {
    expect(voicePlan({ python: true, portAnswers: false })).toBe('spawn');
  });
  it('ни порта, ни окружения — голос выключен', () => {
    expect(voicePlan({ python: false, portAnswers: false })).toBe('off');
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
});
