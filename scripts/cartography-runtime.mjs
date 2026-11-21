/** Подготовка GIS дополнений без изменения окружения TTS. Wheels сохраняются для автономной установки. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2]||'prepare';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const candidates=[process.env.GIS_PYTHON,option('--python'),join(root,process.platform==='win32'?'.venv-gis312/Scripts/python.exe':'.venv-gis312/bin/python'),join(root,'apps/desktop/portable/runtime/python',process.platform==='win32'?'python.exe':'bin/python3'),process.platform==='win32'?'python.exe':'python3.12'].filter(Boolean);
const python=candidates.find(p=>spawnSync(p,['-c','import sys; assert sys.version_info[:2]==(3,12)'],{stdio:'ignore'}).status===0);
if(!python)throw Error('Нужен Python 3.12 для GIS. Укажите GIS_PYTHON или --python <путь>; Python новых предварительных версий не поддерживается.');
const output=resolve(option('--out',join(root,'apps/desktop/server/gis/addons'))),wheels=resolve(option('--wheels',join(root,'release/downloads/gis-wheels',mode==='windows-wheels'?'win_amd64-cp312':`${process.platform}-${process.arch}`)));
const requirements=join(root,'services/cartography/tools/requirements.txt');mkdirSync(wheels,{recursive:true});
function run(args){const p=spawnSync(python,args,{stdio:'inherit',windowsHide:true});if(p.status!==0)throw Error('Подготовка GIS-runtime завершилась ошибкой; установленное приложение не изменено.');}
if(mode==='windows-wheels'){run(['-m','pip','download','--only-binary=:all:','--platform','win_amd64','--python-version','312','--implementation','cp','--abi','cp312','-r',requirements,'pip==24.3.1','-d',wheels]);console.log(`Windows Python 3.12 wheels: ${wheels}`);}
else {
 if(mode!=='offline')run(['-m','pip','download','--only-binary=:all:','-r',requirements,'-d',wheels]);
 mkdirSync(output,{recursive:true});
 run(['-m','pip','install','--no-index','--find-links',wheels,'--only-binary=:all:','--upgrade','--target',output,'-r',requirements]);
 const result=spawnSync(python,['-c',`import sys; sys.path.insert(0,${JSON.stringify(output)}); import rasterio, osmium, PIL; print("GIS-runtime готов:", rasterio.__version__)`],{env:{...process.env,PYTHONPATH:output},stdio:'inherit'});if(result.status!==0)throw Error('GIS-runtime не прошёл проверку импорта');
 writeFileSync(join(output,'defops-gis-runtime.json'),JSON.stringify({platform:process.platform,arch:process.arch,python:spawnSync(python,['-c','import sys;print("%d.%d"%sys.version_info[:2])'],{encoding:'utf8'}).stdout.trim(),requirements:'rasterio 1.4.3; osmium 4.1.1; Pillow 11.3.0'},null,2));
 if(!existsSync(output))throw Error('GIS-runtime не создан');
}
