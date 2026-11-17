// Реальные записи интро: HTTP, декодирование в браузере, длительность и ненулевая звуковая дорожка.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.EXPO_URL ?? 'http://127.0.0.1:5173';
const bank = JSON.parse(readFileSync(new URL('../apps/editor/src/expo/bank-data/berlin-1945.lines.json', import.meta.url), 'utf8'));
const texts = Array.from({ length: 13 }, (_, i) => bank.say[`intro-${i + 1}`][0]);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage();
  await page.route('**/expo-audio-check', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Проверка предзаписи интро</title>' }));
  await page.goto(`${url}/expo-audio-check`);
  const result = await page.evaluate(async (phrases) => {
    const response = await fetch('/expo-voice/manifest.json');
    if (!response.ok) throw new Error(`Манифест: HTTP ${response.status}`);
    const manifest = await response.json();
    const audio = new AudioContext({ sampleRate: 24000 });
    const clips = [];
    for (const [i, text] of phrases.entries()) {
      const clip = manifest.clips[text];
      if (!clip) throw new Error(`Нет записи intro-${i + 1}`);
      const r = await fetch(`/expo-voice/clips/${clip.file}`);
      if (!r.ok) throw new Error(`intro-${i + 1}: HTTP ${r.status}`);
      const buffer = await audio.decodeAudioData(await r.arrayBuffer());
      const data = buffer.getChannelData(0);
      let square = 0;
      for (const sample of data) square += sample * sample;
      clips.push({ key: `intro-${i + 1}`, seconds: buffer.duration, manifestMs: clip.ms, rms: Math.sqrt(square / data.length), ok: clip.ok, wer: clip.wer, cer: clip.cer });
    }
    void audio.close();
    return clips;
  }, texts);
  assert.equal(result.length, 13);
  for (const clip of result) {
    assert.equal(clip.ok, true, clip.key);
    assert.ok(clip.rms > 0.001, `${clip.key}: звуковая дорожка пуста`);
    assert.ok(Math.abs(clip.seconds * 1000 - clip.manifestMs) < 100, `${clip.key}: длительность не совпадает с манифестом`);
    console.log(`ok ${clip.key}: ${clip.seconds.toFixed(2)} с, RMS ${clip.rms.toFixed(3)}, WER ${clip.wer}, CER ${clip.cer}`);
  }
  console.log(`Готово: ${result.length} записей декодированы, ${result.reduce((sum, clip) => sum + clip.seconds, 0).toFixed(1)} с.`);
} finally {
  await browser.close();
}
