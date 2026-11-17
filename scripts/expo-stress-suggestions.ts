/** Подготовка локальных подсказок из закреплённого RUAccent; пути к скачанным gzip передаются явно. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildLexicon } from './expo-voice-lexicon';
const [accentsPath, ambiguousPath] = process.argv.slice(2);
if (!accentsPath || !ambiguousPath) throw Error('Нужны пути accents.json.gz и omographs.json.gz из scripts/data/README.md');
const accents = JSON.parse(gunzipSync(readFileSync(accentsPath)).toString()) as Record<string, string>;
const ambiguous = JSON.parse(gunzipSync(readFileSync(ambiguousPath)).toString()) as Record<string, unknown>;
const suggestions: Record<string, string> = {};
for (const { word } of buildLexicon({ words: {} }).entries) {
  const key = word.toLowerCase(), say = accents[key];
  if (!(key in ambiguous) && typeof say === 'string' && (say.match(/\+/g) ?? []).length === 1
    && /\+[аеёиоуыэюя]/i.test(say) && say.replace('+', '') === key) suggestions[key] = say;
}
writeFileSync(new URL('./data/stress-suggestions.json', import.meta.url), JSON.stringify(suggestions, null, 1) + '\n');
console.log(`Подсказок: ${Object.keys(suggestions).length}`);
