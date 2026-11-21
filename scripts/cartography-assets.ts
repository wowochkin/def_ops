/** Одинаковые локальные шрифты для исторической и современной карты. */
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { homedir } from 'node:os';
import { ensureAssets, OHM_DEFAULTS } from '../services/cartography/src/ohm';
const target=fileURLToPath(new URL('../apps/desktop/server/gis/assets',import.meta.url));
const data=process.env.DEFOPS_DATA_DIR??(process.platform==='win32'?path.join(process.env.APPDATA??homedir(),'ru.defops.desktop'):path.join(homedir(),'Library/Application Support/ru.defops.desktop'));
const cache=path.join(data,'tiles/.ohm-assets');
await fs.mkdir(target,{recursive:true});
if(await fs.access(cache).then(()=>true,()=>false))await fs.cp(cache,target,{recursive:true,force:false,errorOnExist:false});
const r=await ensureAssets(target,OHM_DEFAULTS);
await fs.writeFile(path.join(target,'SOURCE.txt'),'Шрифты и значки для локальной карты\nИсточник: https://www.openhistoricalmap.org/map-styles\nПовторное использование ресурсов действующего стиля OpenHistoricalMap.\nИсходный проект и сведения о лицензиях: https://github.com/OpenHistoricalMap/map-styles\n','utf8');
console.log(`Локальные ресурсы карты готовы; скачано файлов: ${r.fetched}`);
