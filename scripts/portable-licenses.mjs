// Собирает существующие тексты лицензий зависимостей; не заменяет проверку условий распространения.
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2] || 'apps/desktop/portable/licenses');
await fs.mkdir(root,{recursive:true});
const packages=[];
async function scan(dir) {
  for (const e of await fs.readdir(dir,{withFileTypes:true})) {
    if (e.name.startsWith('.')) continue;
    const p=join(dir,e.name);
    if(e.isDirectory()&&e.name.startsWith('@')) { await scan(p); continue; }
    if(!e.isDirectory()) continue;
    let pkg; try { pkg=JSON.parse(await fs.readFile(join(p,'package.json'),'utf8')); } catch { continue; }
    const key=`${pkg.name.replaceAll('/','__')}@${pkg.version}`;
    const licenses=(await fs.readdir(p)).filter(n=>/^(licen[cs]e|copying|notice)([-_.]|$)/i.test(n));
    packages.push({name:pkg.name,version:pkg.version,license:pkg.license??null,files:licenses.map(f=>`${key}/${f}`)});
    if(licenses.length) {await fs.mkdir(join(root,key),{recursive:true});for(const file of licenses) {const st=await fs.stat(join(p,file));if(st.isFile()) await fs.copyFile(join(p,file),join(root,key,file));}}
    try { await fs.access(join(p,'node_modules')); await scan(join(p,'node_modules')); } catch(e) { if(e.code!=='ENOENT') throw e; }
  }
}
await scan('node_modules');
await fs.copyFile(process.env.DEFOPS_NODE_LICENSE || 'release/downloads/node-mac/LICENSE',join(root,'Node-LICENSE'));
await fs.copyFile('scripts/data/RUAccent-LICENSE.txt',join(root,'RUAccent-LICENSE.txt'));
await fs.writeFile(join(root,'npm-dependencies.json'),JSON.stringify(packages,null,2));
const host=execFileSync('rustc',['-vV'],{encoding:'utf8'}).match(/^host: (.+)$/m)[1];
const cargo=JSON.parse(execFileSync('cargo',['metadata','--format-version=1','--locked','--offline','--filter-platform',host],{encoding:'utf8',maxBuffer:50*1024*1024}));
const rust=[];
for(const pkg of cargo.packages){
  const dir=resolve(pkg.manifest_path,'..'), key=`rust__${pkg.name}@${pkg.version}`;
  const names=(await fs.readdir(dir)).filter(n=>/^(licen[cs]e|copying|notice)([-_.]|$)/i.test(n));
  rust.push({name:pkg.name,version:pkg.version,license:pkg.license,files:names.map(n=>`${key}/${n}`)});
  await fs.mkdir(join(root,key),{recursive:true});
  for(const name of names)if((await fs.stat(join(dir,name))).isFile())await fs.copyFile(join(dir,name),join(root,key,name));
}
await fs.writeFile(join(root,'rust-dependencies.json'),JSON.stringify(rust,null,2));
await fs.writeFile(join(root,'NOTICE.txt'),'Комплект включает Node.js, Chromium/WebView системной платформы, Tauri, библиотеки npm и Python, модели голоса и картографические данные. Тексты лицензий Node/npm/RUAccent находятся здесь, Python/MLX/FFmpeg/моделей — в portable/runtime/licenses и manifest.\nКарты OpenHistoricalMap: https://www.openhistoricalmap.org/copyright . Исходная атрибуция карт сохраняется в приложении.\nНекоторые готовые записи созданы ранее Fish S2 Pro; модель имеет отдельные условия Fish Audio Research License. Права на распространение записей и голосовых образцов проверяются владельцем комплекта.\nЭтот сборник — перечень и сохранённые тексты лицензий, а не заключение о правах на коммерческое распространение.\n');
console.log(`Лицензии: ${packages.length} npm-пакетов`);
