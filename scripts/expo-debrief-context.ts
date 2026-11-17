import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cer } from './expo-voice';

const root = join(import.meta.dirname, '..');
export const padding = 'Это был итог Берлинской операции.';

type AsrWord = { text: string; start: number; end: number };
type AsrResult = { text: string; words: AsrWord[]; error?: string };

export async function withDeadline<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Служба не завершила синтез за четыре минуты')), 240_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Распознавание обрезанного звука и временные границы слов для дублей с контекстом. */
export function recognizer() {
  const python = process.env.VOICE_PYTHON ?? join(root, 'services/voice/.venv/bin/python');
  const models = join(process.env.DEFOPS_VOICE_MODELS ?? join(root, 'release/staging/runtime/models/voice'), 'gigaam');
  const code = `
import json
from pathlib import Path
import sys
import gigaam
import torch
root = Path(sys.argv[1])
name = "v3_e2e_rnnt"
for file in (f"{name}.ckpt", f"{name}_tokenizer.model"):
    if not (root / file).is_file():
        raise FileNotFoundError(root / file)
torch.set_num_threads(2)
model = gigaam.load_model(name, device="cpu", download_root=str(root))
for line in sys.stdin:
    try:
        result = model.transcribe(json.loads(line), word_timestamps=True)
        reply = {"text": result.text, "words": [vars(w) for w in result.words or []]}
    except Exception as error:
        reply = {"error": str(error)}
    print(json.dumps(reply), flush=True)
`;
  const child = spawn(python, ['-u', '-c', code, models], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let failure: Error | undefined;
  child.on('error', (error) => { failure = error; });
  child.stdin.on('error', (error) => { failure = error; });
  return {
    async read(file: string): Promise<AsrResult> {
      if (failure) throw failure;
      child.stdin.write(`${JSON.stringify(file)}\n`);
      const line = await withDeadline(lines.next()).catch((error: Error) => {
        failure = error;
        child.kill();
        throw error;
      });
      if (line.done) throw failure ?? new Error('Распознавание завершилось без результата');
      const result = JSON.parse(line.value) as AsrResult;
      if (result.error) throw new Error(result.error);
      return result;
    },
    close() { child.stdin.end(); },
  };
}

export async function trimContext(file: string, target: string, context: string, asr: ReturnType<typeof recognizer>): Promise<string | null> {
  const { words } = await asr.read(file);
  const boundary = words.length - context.split(' ').length;
  if (boundary < 1) return null;
  const filler = words.slice(boundary).map((w) => w.text).join(' ');
  if (cer(context, filler) > 0.12) return null;
  const from = words[boundary - 1].end, to = words[boundary].start;
  if (to - from < 0.10) return null;
  const cut = (from + to) / 2;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-t', cut.toFixed(3), target]);
  return (await asr.read(target)).text;
}
