import { it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareVoiceDirectory } from '../server/voice-files.mjs';

it('обновляет исходники установленного голоса, сохраняя подготовленное окружение и веса', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expo-voice-files-'));
  try {
    const repo = join(dir, 'программа'), bundled = join(dir, 'bundle'), data = join(dir, 'данные');
    mkdirSync(bundled, { recursive: true }); mkdirSync(join(data, 'voice-service/.venv'), { recursive: true });
    writeFileSync(join(bundled, 'server.py'), 'new version');
    writeFileSync(join(bundled, 'private.log'), 'not shipped');
    writeFileSync(join(data, 'voice-service/.venv/python'), 'prepared');
    expect(prepareVoiceDirectory({ repo, bundled, data })).toBe(join(data, 'voice-service'));
    expect(readFileSync(join(data, 'voice-service/server.py'), 'utf8')).toBe('new version');
    expect(readFileSync(join(data, 'voice-service/.venv/python'), 'utf8')).toBe('prepared');
    expect(existsSync(join(data, 'voice-service/private.log'))).toBe(false);
    expect(prepareVoiceDirectory({ repo, bundled, data, explicit: '/own' })).toBe('/own');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, cpSync: () => { throw new Error('Windows cpSync unlink errno=0'); } };
});

it('повторно обновляет файлы в профиле с кириллицей, пробелами и read-only исходной копией', () => {
  const root = mkdtempSync(join(tmpdir(), 'Стенд голос '));
  try {
    const repo = join(root, 'repo'), bundled = join(root, 'bundle'), data = join(root, 'профиль Стенд');
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, 'server.py'), 'first');
    const target = prepareVoiceDirectory({ repo, bundled, data });
    chmodSync(join(target, 'server.py'), 0o444);
    prepareVoiceDirectory({ repo, bundled, data });
    writeFileSync(join(bundled, 'server.py'), 'second');
    prepareVoiceDirectory({ repo, bundled, data });
    expect(readFileSync(join(target, 'server.py'), 'utf8')).toBe('second');
    expect(readdirSync(target)).toEqual(['server.py']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
