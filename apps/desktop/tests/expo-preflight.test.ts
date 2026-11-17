import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditExpoAssets } from '../../../scripts/expo-preflight';

it('отсутствующие фразы, пустые файлы и забытые образцы не считаются готовым комплектом', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expo-preflight-'));
  try {
    mkdirSync(join(dir, 'expo/voice/clips'), { recursive: true });
    writeFileSync(join(dir, 'expo/voice/manifest.json'), JSON.stringify({ version: 1, clips: { Текст: { file: 'one.ogg' } } }));
    expect(auditExpoAssets(dir, ['Другая фраза'])[0].status).toBe('fail');
    expect(auditExpoAssets(dir, ['Текст'])[0].status).toBe('fail');
    writeFileSync(join(dir, 'expo/voice/clips/one.ogg'), 'audio');
    expect(auditExpoAssets(dir, ['Текст'])[0].status).toBe('fail');
    writeFileSync(join(dir, 'expo/voice/manifest.json'), JSON.stringify({ version: 1, clips: { Текст: { file: 'abcdef12.ogg', ms: 1200 } } }));
    writeFileSync(join(dir, 'expo/voice/clips/abcdef12.ogg'), 'audio');
    expect(auditExpoAssets(dir, ['Текст'])[0].status).toBe('ok');
    expect(auditExpoAssets(dir, ['Текст']).find(x => x.name.includes('Образцы'))?.status).toBe('fail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('проверяет данные каждой карты, а не наличие .uploads или пустых папок', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expo-preflight-maps-'));
  const status = () => auditExpoAssets(dir, []).find(x => x.name === 'Локальные карты')?.status;
  const file = (path: string, content = 'tile') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  try {
    file('cartography.json', JSON.stringify({ maps: { demo: {
      berlin: { id: 'berlin', kind: 'xyz' }, south: { id: 'south', kind: 'raster' },
    } } }));
    mkdirSync(join(dir, 'tiles/.uploads'), { recursive: true });
    expect(status()).toBe('fail');
    file('tiles/demo/berlin/8/131/84.png');
    expect(status()).toBe('fail'); // файл одной карты не покрывает отсутствующую вторую
    file('tiles/demo/south/8/132/84.jpg', '');
    expect(status()).toBe('fail');
    file('tiles/demo/south/8/132/84.jpg');
    expect(status()).toBe('ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('для векторной карты требует непустой ohm.mbtiles в папке этой карты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expo-preflight-vector-'));
  const status = () => auditExpoAssets(dir, []).find(x => x.name === 'Локальные карты')?.status;
  try {
    writeFileSync(join(dir, 'cartography.json'), JSON.stringify({ maps: { demo: { berlin: { id: 'berlin', kind: 'vector' } } } }));
    mkdirSync(join(dir, 'tiles/demo/berlin'), { recursive: true });
    writeFileSync(join(dir, 'tiles/demo/berlin/ohm.mbtiles.tmp'), 'unfinished');
    expect(status()).toBe('fail');
    writeFileSync(join(dir, 'tiles/demo/berlin/ohm.mbtiles'), '');
    expect(status()).toBe('fail');
    writeFileSync(join(dir, 'tiles/demo/berlin/ohm.mbtiles'), 'local mbtiles');
    expect(status()).toBe('ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
