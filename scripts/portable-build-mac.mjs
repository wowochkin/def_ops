// Подготовка macOS-комплекта из экспортированной библиотеки; выполняется на Apple Silicon.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(repo);
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Нужен Mac с Apple Silicon');
const args=process.argv.slice(2),opt=k=>args[args.indexOf(k)+1];
if(!args.includes('--data')||!args.includes('--archive'))throw Error('--data <папка данных> --archive <экспорт пользовательской библиотеки> обязательны');
const run=(exe,params,env={})=>execFileSync(exe,params,{stdio:'inherit',env:{...process.env,...env}});
const python=resolve('services/voice/.venv/bin/python');
run(python,['scripts/portable-voice-fetch.py','--output','release/staging/voice-sources']);
const nextRuntime=resolve(`release/staging/runtime-build-${Date.now()}`);
run(python,['scripts/portable-voice.py','--sources','release/staging/voice-sources','--output',nextRuntime]);
const portable=resolve('apps/desktop/portable');await fs.mkdir(portable,{recursive:true});
const next=join(portable,`library-next-${Date.now()}`);
run(process.execPath,['scripts/portable-release.mjs','--data',resolve(opt('--data')),'--archive',resolve(opt('--archive')),'--out',next]);
await fs.rm(join(portable,'library'),{recursive:true,force:true});await fs.rename(next,join(portable,'library'));
await fs.rm(join(portable,'runtime'),{recursive:true,force:true});await fs.cp(nextRuntime,join(portable,'runtime'),{recursive:true});
const { prepareNode }=await import('./portable-node.mjs');await prepareNode(resolve('release/downloads/node-runtime'));
run(process.execPath,['--import','tsx','scripts/portable-lexicon.ts']);
run(process.execPath,['scripts/portable-licenses.mjs'],{DEFOPS_NODE_LICENSE:resolve('release/downloads/node-runtime/LICENSE')});
run('npm',['run','typecheck']);
run('npm',['run','tauri','-w','@def-ops/desktop','--','build','--bundles','app','--','--locked'],{DEFOPS_PORTABLE_BUILD:'1'});
const app=resolve('target/release/bundle/macos/Тактическая карта.app');
// Linker-подпись исполняемого файла не запечатывает ресурсы .app. Подписываем оболочку,
// сохраняя уже подписанные вложенные runtime-бинарники и их SHA256-манифест.
run('codesign',['--force','--sign','-',app]);
run(python,['scripts/portable-voice.py','--verify',join(app,'Contents/Resources/portable/runtime')]);
run('codesign',['--verify','--deep','--strict',app]);
console.log(`Сборка: ${app}. Проверьте холодный запуск и звук, затем создайте архив вместе с инструкцией и отчётом.`);
