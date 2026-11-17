// Сборка файловой библиотеки; только явно разрешённые данные, никогда профиль/ключи/назначения экранов.
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { inventory, verifyLibrary, validateUserLibraryEnvelope } from '../apps/desktop/server/portable-library.mjs';

const ALLOWED = ['documents', 'tiles/default', 'tiles/.ohm-assets', 'cartography.json', 'registry.json', 'expo/voice', 'voice/voices', 'voice/roles.json', 'stress-user.json'];
async function copyTree(source, target) {
  const st = await fs.lstat(source);
  if (st.isSymbolicLink()) throw Error(`Ссылка вместо ресурса: ${source}`);
  if (st.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const e of await fs.readdir(source)) if (e !== '.DS_Store' && !e.endsWith('.tmp')) await copyTree(join(source,e), join(target,e));
  } else if (st.isFile()) { await fs.mkdir(dirname(target), { recursive: true }); await fs.copyFile(source,target); }
  else throw Error(`Неподдерживаемый ресурс: ${source}`);
}
export async function prepareLibrary({ data, archive, out }) {
  const user = JSON.parse(await fs.readFile(archive, 'utf8'));
  validateUserLibraryEnvelope(user);
  // Папка назначения обязана быть новой: случайное повторение не стирает уже подготовленный комплект.
  await fs.mkdir(out, { recursive: false });
  const files = join(out, 'files'); await fs.mkdir(files);
  for (const name of ALLOWED) {
    const src = join(data,name);
    try { await fs.lstat(src); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    await copyTree(src, join(files,name));
  }
  await fs.mkdir(join(files,'portable')); await fs.copyFile(archive,join(files,'portable/user-library.json'));
  // Одинаковая поддерживаемая модель на обеих платформах, без переноса выбора экспериментального движка.
  await fs.mkdir(join(files,'voice'),{recursive:true});
  await fs.writeFile(join(files,'voice/tts.json'),JSON.stringify({engine:'qwen3-ru-stress'}));
  const entries = await inventory(files);
  const manifest = { format: 'def-ops-file-library', version: 1, id: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), files: entries };
  await fs.writeFile(join(out,'manifest.json'), JSON.stringify(manifest,null,2));
  await verifyLibrary(out);
  return { id: manifest.id, files: entries.length, bytes: entries.reduce((n,f)=>n+f.size,0) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2), opt=(key)=>args[args.indexOf(key)+1];
  if (!['--data','--archive','--out'].every(k=>args.includes(k))) throw Error('Использование: node scripts/portable-release.mjs --data <данные> --archive <экспорт JSON> --out <новая папка>');
  console.log(JSON.stringify(await prepareLibrary({data:resolve(opt('--data')),archive:resolve(opt('--archive')),out:resolve(opt('--out'))})));
}
