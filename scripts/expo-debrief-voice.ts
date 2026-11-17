/**
 * Предзапись разбора операции. Запуск: VOICE_URL=ws://127.0.0.1:<порт>/ws
 * DEFOPS_DATA_DIR=<папка с voice/voices> npx tsx scripts/expo-debrief-voice.ts
 * Служба должна использовать Qwen3-TTS с ударениями и те же образцы Жукова и Конева.
 * Для проверки стыка коротких фраз нужен GigaAM из окружения голосовой службы:
 * VOICE_PYTHON и DEFOPS_VOICE_MODELS переопределяют локальные пути к Python и весам.
 * --catalog печатает реплики, --check проверяет полноту и файлы без голосовой службы.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aimPlaces, BANK, turnCards } from '../apps/editor/src/expo/bank';
import { debriefSentences, debriefUtterances, operationDebrief } from '../apps/editor/src/expo/debrief';
import { axisNote, forecast, RANKS, type AxesDetail } from '../apps/editor/src/expo/score';
import { timeAt, type Decision, type ModelView } from '../apps/editor/src/expo/session';
import type { FrontId } from '../apps/editor/src/expo/settings';
import { plainStress, stressed } from '../apps/editor/src/expo/stress';
import { speakable } from '../apps/editor/src/voice/speech';
import { cer, clipKey, dataDir, encode, heardOk, heardText, loadStress, msOk, service, voiceStamp, wer } from './expo-voice';

import { padding, recognizer, trimContext, withDeadline } from './expo-debrief-context';

type Entry = { voice: string; text: string };
type Clip = { file: string; ms: number; manual?: boolean };
type Manifest = { version: 1; voices: Record<string, Record<string, Clip>> };
const engine = 'qwen3-ru-stress';
const root = join(import.meta.dirname, '..');
const out = join(root, 'apps/editor/public/expo-debrief');
const clips = join(out, 'clips');
const manifestPath = join(out, 'manifest.json');
const alternatePadding = 'Следующий доклад начнётся после окончания проверки записи.';

function catalog(): Entry[] {
  const scenario = JSON.parse(readFileSync(join(root, BANK.scenario), 'utf8')) as { start: string };
  const history = JSON.parse(readFileSync(join(root, BANK.history), 'utf8')) as { events: { id: string; date: string }[] };
  const calendar = history.events.find((e) => e.id === BANK.berlinEvent);
  if (!calendar) throw new Error('В календаре нет события взятия Берлина');
  const start = scenario.start.slice(0, 16);
  const shift = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const ending = (historical: string, simulated: string | null) => forecast([{
    id: BANK.berlinEvent, title: '', historical, simulated, days: simulated ? shift(historical, simulated) : null, at: null,
  }], BANK.berlinEvent);
  // Обычный сеанс сравнивает с ходом «как было» (29 апреля), до расчёта эталона — с календарём.
  const baseline = '1945-04-29';
  const baselineDates = [...new Set([baseline, calendar.date])];
  const primary: Entry[] = [], alternatives: Entry[] = [], other: Entry[] = [];
  for (const front of Object.keys(BANK.fronts) as FrontId[]) {
    const def = BANK.fronts[front];
    const turns = def.turns.map(({ n }) => {
      const cards = turnCards(BANK, front, n);
      const historical = cards.find((c) => c.historical);
      if (!historical) throw new Error(`Нет исторической карты: ${front}, перелом ${n}`);
      return { cards, n, historical: historical.id };
    });
    const axes: AxesDetail = { speed: 0, cost: 0, intent: 1, days: 0, lossRatio: 1, done: def.keyEvents.length, due: def.keyEvents.length };
    const standard: NonNullable<ModelView['final']> = {
      rank: 'Генерал армии', matches: turns.length, forecast: ending(baseline, baseline),
      scales: { axes, notes: { speed: axisNote('speed', axes), cost: axisNote('cost', axes), intent: axisNote('intent', axes) } },
    };
    const add = (list: Entry[], decisions: Decision[], final = standard) => {
      const brief = operationDebrief({ front, decisions, final })!;
      for (const text of debriefUtterances(brief.paragraphs)) list.push({ voice: brief.voice, text });
    };
    add(primary, turns.map(({ n, historical }) => ({ n, historical, choice: historical })));
    for (const rank of RANKS) add(primary, [], { ...standard, rank: rank.title });
    for (const date of baselineDates) add(primary, [], { ...standard, rank: 'Провал',
      forecast: front === 'su_1uf' ? 'К концу расчёта фронт не вышел бы к Берлину с юга (в истории — Цоссен)' : ending(date, null),
    });
    add(primary, [], { ...standard, scales: { axes, notes: {
      speed: axisNote('speed', { ...axes, days: null }),
      cost: axisNote('cost', { ...axes, lossRatio: null }),
      intent: axisNote('intent', { ...axes, due: 0 }),
    } } });
    // Две контрольные ветки с промедлением на всех переломах.
    const delay = front === 'su_1bf' ? { days: 2, lossRatio: 0.01 } : { days: 0, lossRatio: 0 };
    add(primary, [], { ...standard, scales: { axes, notes: {
      ...standard.scales.notes, speed: axisNote('speed', { ...axes, ...delay }), cost: axisNote('cost', { ...axes, ...delay }),
    } } });
    for (let due = def.keyEvents.length; due > 0; due--) {
      for (let done = 0; done <= due; done++) {
        add(primary, [], { ...standard, scales: { ...standard.scales, notes: {
          ...standard.scales.notes, intent: axisNote('intent', { ...axes, due, done }),
        } } });
      }
    }
    for (const { cards, n, historical } of turns) {
      for (const choice of ['delay', ...cards.filter((c) => !c.historical).map((c) => c.id)]) {
        add(alternatives, [{ n, historical, choice }]);
      }
      for (const { id } of aimPlaces(BANK, front)) add(other, [{ n, historical, choice: `aim:${id}` }]);
    }
    for (const date of baselineDates) {
      for (let hour = 0; hour <= BANK.end; hour += 24) {
        add(other, [], { ...standard, forecast: ending(date, timeAt(start, hour).slice(0, 10)) });
      }
    }
  }
  const unique = new Map<string, Entry>();
  for (const entry of [...primary, ...alternatives, ...other]) {
    const key = `${entry.voice}\n${entry.text}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function load(): Manifest {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    if (manifest.version !== 1 || !manifest.voices) throw new Error('Неизвестный формат манифеста');
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { version: 1, voices: {} };
  }
}

function exists(clip?: Clip): clip is Clip {
  return !!clip && /^[a-f0-9]{24}\.ogg$/.test(clip.file) && (statSync(join(clips, clip.file), { throwIfNoEntry: false })?.size ?? 0) > 0;
}

function checkClip(text: string, clip?: Clip): boolean {
  if (!exists(clip) || !msOk(speakable(text, { full: true }), clip.ms)) return false;
  try {
    const result = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,channels',
      '-of', 'json', join(clips, clip.file),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as {
      format?: { duration: string }; streams?: { codec_name: string; channels: number }[];
    };
    const ms = Math.round(Number(result.format?.duration) * 1000);
    return result.streams?.length === 1 && result.streams[0].codec_name === 'opus'
      && result.streams[0].channels === 1 && clip.ms === ms;
  } catch {
    return false;
  }
}

function save(manifest: Manifest) {
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporary, manifestPath);
}

function compare(expected: string, recognized: string) {
  const heard = heardText(recognized);
  const w = wer(expected, heard), c = cer(expected, heard);
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\d]+/gu) ?? [];
  const letters = (s: string) => words(s).join('').replace(/ё/g, 'е');
  const recognizedLetters = letters(heard);
  const tail = letters(words(expected).slice(-4).join(' '));
  const tailOk = cer(tail, recognizedLetters.slice(-tail.length)) <= 0.24;
  // Числа, знак сравнения и звание должны совпасть, даже если общий допуск позволяет ошибку.
  const critical = expected.match(/^Замысел: выполнено (.+)\.$|^По такому ходу звание — (.+)\.$/);
  const exactOk = !critical || recognizedLetters.endsWith(letters(critical[1] ?? critical[2]));
  const date = expected.match(/^Берлин пал бы (.+?), /)?.[1];
  const shift = expected.match(/, (на .+? (?:раньше|позже) истории)\.$/)?.[1];
  const recognizedWords = ` ${words(heard.replace(/ё/g, 'е')).join(' ')} `;
  const dateOk = !date || recognizedLetters.startsWith('берлинпалбы')
    && recognizedWords.includes(` ${words(date.replace(/ё/g, 'е')).join(' ')} `);
  const shiftOk = !shift || recognizedWords.includes(` ${words(shift.replace(/ё/g, 'е')).join(' ')} `);
  const delayOk = !expected.includes('приказа не отдали') || recognizedLetters.includes('приказанеотдали');
  const factsOk = dateOk && shiftOk && delayOk;
  return { w, c, ok: heardOk(expected, w, c) && c <= 0.13 && tailOk && exactOk && factsOk };
}

type RenderService = Awaited<ReturnType<typeof service>>;
type Asr = () => ReturnType<typeof recognizer>;
type Take = { ms: number; heard: string };

async function record(svc: RenderService, asr: Asr, said: string, voice: string, path: string, label: string, attempts: number): Promise<Take | null> {
  const expected = plainStress(said);
  const trimmed = `${path}.wav`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // На короткой строке Qwen иногда завершает синтез сразу. Следующее предложение
    // даёт контекст. В клип попадёт первый кусок после отдельного распознавания.
    const padded = expected.length < 95 && attempt > 1 && attempt !== 4;
    const prompt = attempt === 3 ? said.replace(/ — /g, ', ') : attempt === 5 ? expected : said;
    const context = attempt === 6 ? alternatePadding : padding;
    const rendered = await withDeadline(svc.render(padded ? `${prompt} ${context}` : prompt, voice));
    if (rendered.error || !rendered.path) {
      console.error(`${label}: ${rendered.error ?? 'служба не вернула звук'}`);
      continue;
    }
    try {
      const heard = padded
        ? await trimContext(rendered.path, trimmed, context, asr()) ?? ''
        : rendered.heard ?? '';
      const { w, c, ok } = compare(expected, heard);
      if (ok) {
        const ms = encode(padded ? trimmed : rendered.path, path);
        if (msOk(expected, ms)) return { ms, heard };
      }
      console.warn(`повтор ${label} (${attempt}), ${Math.round((rendered.audio_s ?? 0) * 1000)} мс, WER ${w.toFixed(2)}, CER ${c.toFixed(2)} → ${heard || rendered.heard || ''}`);
    } catch (error) {
      console.error(`${label}: ${error instanceof Error ? error.message : error}`);
    } finally {
      rmSync(trimmed, { force: true });
      rmSync(rendered.path, { force: true });
    }
  }
  return null;
}

/** Если Qwen пропускает предложение в длинной фразе, склеиваем проверенные дубли в тот же клип. */
async function stitch(svc: RenderService, asr: Asr, parts: string[], expected: string, voice: string, path: string, label: string): Promise<Take | null> {
  const inputs = parts.map((_, i) => `${path}.${i}.ogg`);
  const joined = `${path}.joined.wav`;
  try {
    for (const [i, part] of parts.entries()) {
      if (!await record(svc, asr, part, voice, inputs[i], `${label}, предложение ${i + 1}`, 6)) return null;
    }
    const pauses = inputs.slice(0, -1).map((_, i) => `[${i}:a]apad=pad_dur=0.18[p${i}];`).join('');
    const streams = inputs.map((_, i) => i === inputs.length - 1 ? `[${i}:a]` : `[p${i}]`).join('');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs.flatMap((input) => ['-i', input]),
      '-filter_complex', `${pauses}${streams}concat=n=${inputs.length}:v=0:a=1`, joined]);
    const heard = (await asr().read(joined)).text;
    const ms = encode(joined, path);
    return compare(expected, heard).ok && msOk(expected, ms) ? { ms, heard } : null;
  } catch (error) {
    console.error(`${label}: ${error instanceof Error ? error.message : error}`);
    return null;
  } finally {
    for (const file of [...inputs, joined]) rmSync(file, { force: true });
  }
}

const entries = catalog();
const manifest = load();
if (process.argv.includes('--catalog')) {
  for (const { voice, text } of entries) console.log(`${voice}\t${text}`);
} else if (process.argv.includes('--check')) {
  const missing = entries.filter(({ voice, text }) => !checkClip(text, manifest.voices[voice]?.[text]));
  for (const { voice, text } of missing) console.error(`${voice}: ${text}`);
  console.log(`Проверено ${entries.length - missing.length}/${entries.length} реплик`);
  process.exitCode = missing.length ? 1 : 0;
} else {
  const url = process.env.VOICE_URL;
  if (!url) throw new Error('Укажите VOICE_URL изолированной голосовой службы');
  const svc = await service(url);
  const data = dataDir();
  const stress = loadStress();
  const stamps = new Map([...new Set(entries.map(({ voice }) => voice))].map((voice) => [voice, voiceStamp(data, voice)]));
  const failures: Entry[] = [];
  let asr: ReturnType<typeof recognizer> | undefined;
  try {
    if (svc.engine !== engine) throw new Error(`В службе выбрана ${svc.engine}. Для предзаписи нужна ${engine}.`);
    for (const stamp of stamps.values()) {
      if (stamp.endsWith(':встроенный')) throw new Error(`Образец ${stamp} отсутствует в ${data}`);
    }
    mkdirSync(clips, { recursive: true });
    for (const [i, entry] of entries.entries()) {
      const { voice, text } = entry;
      const { said } = stressed(speakable(text, { full: true }), engine, stress);
      const file = `${clipKey(said, stamps.get(voice)!, engine)}.ogg`;
      const voiceClips = manifest.voices[voice] ??= {};
      const previous = voiceClips[text];
      if (exists(previous) && (previous.manual || previous.file === file) && msOk(said, previous.ms)) continue;
      const label = `${i + 1}/${entries.length} ${voice}`;
      const temporary = join(clips, `${file}.${process.pid}.tmp`);
      const parts = debriefSentences([text]);
      const spoken = (part: string) => stressed(speakable(part, { full: true }), engine, stress).said;
      const getAsr = () => asr ??= recognizer();
      try {
        const direct = await record(svc, getAsr, said, voice, temporary, label, parts.length > 1 ? 3 : 6);
        const take = direct ?? (parts.length > 1
          ? await stitch(svc, getAsr, parts.map(spoken), plainStress(said), voice, temporary, label)
          : null);
        if (!take) {
          failures.push(entry);
          console.warn(`Отклонено ${label}: ${text}`);
          continue;
        }
        renameSync(temporary, join(clips, file));
        voiceClips[text] = { file, ms: take.ms };
        save(manifest);
        console.log(`ok ${label} ${take.ms} мс — ${text} → ${take.heard}`);
      } finally { rmSync(temporary, { force: true }); }
    }
  } finally {
    asr?.close();
    svc.close();
  }
  console.log(`Проверено ${entries.length - failures.length}/${entries.length} реплик`);
  for (const { voice, text } of failures) console.error(`Не прошла проверку ${voice}: ${text}`);
  process.exitCode = failures.length ? 1 : 0;
}
