/** Общий каталог слов для автономных сборок macOS и Windows. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLexicon } from './expo-voice-lexicon';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const portable = resolve(root, 'apps/desktop/portable');
const stress = JSON.parse(await readFile(resolve(root, 'apps/editor/src/expo/bank-data/stress.json'), 'utf8'));
const catalog = buildLexicon(stress);
await mkdir(portable, { recursive: true });
await writeFile(resolve(portable, 'lexicon.json'), JSON.stringify(catalog));
console.log('Каталог слов автономного комплекта подготовлен');
