/** Предзапись только интро: новые клипы добавляются к существующему манифесту без удаления чужих записей. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTRO_KEYS } from '../apps/editor/src/expo/intro-story';
import { LINES } from '../apps/editor/src/expo/lines';
import { speakable } from '../apps/editor/src/voice/speech';
import { stressed } from '../apps/editor/src/expo/stress';
import { auditVoice, cer, chiefVoice, clipKey, dataDir, encode, heardOk, heardText, loadStress, msOk, service, wer, type ClipCheck, type Manifest } from './expo-voice';

// Интро учитывает словарь ударений тем же движком, что живая озвучка стенда.
const EXPO_VOICE_ENGINE = 'qwen3-ru-stress';
const data = dataDir();
const dir = join(data, 'expo/voice');
const mpath = join(dir, 'manifest.json');
mkdirSync(join(dir, 'clips'), { recursive: true });
const load = (): Manifest => existsSync(mpath) ? JSON.parse(readFileSync(mpath, 'utf8')) as Manifest : { version: 1, engine: EXPO_VOICE_ENGINE, voice: chiefVoice(data), clips: {} };
const before = load();
const backup = `${mpath}.intro-backup-${Date.now()}`;
if (existsSync(mpath)) writeFileSync(backup, readFileSync(mpath));
const voice = chiefVoice(data);
const voiceId = JSON.parse(readFileSync(join(data, 'voice/roles.json'), 'utf8')).chief as string;
const texts = INTRO_KEYS.map((key) => {
  const text = LINES.say[key]?.[0];
  if (!text) throw new Error(`Нет текста ${key}`);
  return text;
});
const svc = await service(process.env.VOICE_URL ?? 'ws://127.0.0.1:47645/ws');
const previousEngine = svc.engine;
const limit = async <T>(task: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Срок синтеза истёк')), ms); })]); }
  finally { clearTimeout(timer); }
};
try {
  if (svc.engine !== EXPO_VOICE_ENGINE) {
    console.log(`Загружается ${EXPO_VOICE_ENGINE}; затем вернётся ${previousEngine}.`);
    await svc.setEngine(EXPO_VOICE_ENGINE);
  }
  const stress = loadStress();
  for (const [index, text] of texts.entries()) {
    const { say, said } = stressed(speakable(text, { full: true }), svc.engine, stress);
    const file = `${clipKey(said, voice, svc.engine)}.ogg`;
    const previous = load().clips[text];
    if (previous && previous.file === file && auditVoice([text], load(), dir).length === 0) {
      console.log(`ok ${index + 1}/${texts.length} готово ${(previous.ms / 1000).toFixed(2)} с`);
      continue;
    }
    let best: ClipCheck | null = null;
    for (let attempt = 0; attempt < 3 && !best?.ok; attempt++) {
      console.log(`Синтез ${index + 1}/${texts.length}, попытка ${attempt + 1}`);
      const rendered = await limit(svc.render(said, voiceId), 240_000);
      if (rendered.error || !rendered.path) throw new Error(rendered.error ?? 'Сервис не вернул звук');
      const temp = join(dir, 'clips', `${file}.intro-${process.pid}`);
      const ms = encode(rendered.path, temp);
      rmSync(rendered.path, { force: true });
      const heard = heardText(rendered.heard ?? '');
      const w = Math.round(wer(said, heard) * 100) / 100;
      const c = Math.round(cer(said, heard) * 100) / 100;
      const clip: ClipCheck = { file, ms, said, say, heard: rendered.heard ?? '', wer: w, cer: c, ok: msOk(said, ms) && heardOk(said, w, c), engine: svc.engine };
      if (!best || (clip.ok && !best.ok) || (clip.ok === best.ok && clip.wer < best.wer)) {
        renameSync(temp, join(dir, 'clips', file));
        best = clip;
      } else rmSync(temp, { force: true });
      console.log(`${clip.ok ? 'ok' : 'повтор'} ${index + 1}/${texts.length}: ${(ms / 1000).toFixed(2)} с, WER ${w}, CER ${c}`);
    }
    if (!best?.ok) throw new Error(`Клип ${index + 1} не прошёл проверку речи`);
    // Манифест читается заново: параллельная работа студии не теряется.
    const current = load();
    current.clips[text] = best;
    writeFileSync(`${mpath}.intro-${process.pid}`, `${JSON.stringify(current, null, 1)}\n`);
    renameSync(`${mpath}.intro-${process.pid}`, mpath);
  }
  const after = load();
  const unrelated = Object.entries(before.clips).filter(([text]) => !texts.includes(text));
  if (unrelated.some(([text, clip]) => JSON.stringify(after.clips[text]) !== JSON.stringify(clip))) throw new Error('Изменились посторонние записи');
  const failures = auditVoice(texts, after, dir);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`Готово: ${texts.length} клипов, ${(texts.reduce((sum, text) => sum + after.clips[text].ms, 0) / 1000).toFixed(1)} с; сохранено ${unrelated.length} прежних записей. ${dir}`);
} finally {
  if (svc.engine !== previousEngine) await svc.setEngine(previousEngine);
  svc.close();
}
