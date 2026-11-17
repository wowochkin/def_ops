// Проверка реального собранного шлюза: чистое хранилище, импорт, словарь, локальная карта.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base=process.env.PORTABLE_URL || 'http://127.0.0.1:47815';
const browser=await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}:{});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:async(cmd)=>{if(cmd==='expo_settings_read')return null;throw Error(`Проверка не вызывает native ${cmd}`)}}});
try{
 await page.goto(base); await page.getByRole('heading',{name:'Подготовка к первому запуску'}).waitFor({timeout:120000});
 const counts=await page.evaluate(async()=>{
  const result={};
  for(const name of ['def_ops_kb','def_ops_sim']){
   const db=await new Promise((ok,no)=>{const r=indexedDB.open(name);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
   const rows={};for(const store of db.objectStoreNames) rows[store]=await new Promise(ok=>{const r=db.transaction(store).objectStore(store).count();r.onsuccess=()=>ok(r.result)});
   result[name]=rows;db.close();
  }return result;
 });
 assert.equal(counts.def_ops_kb.vectors,2220);assert.equal(counts.def_ops_kb.entries,1);assert.equal(counts.def_ops_sim.edits,3);
 await page.getByRole('button',{name:'Словарь ударений',exact:true}).click();
 await page.getByLabel('Найти слово').fill('Кетцин'); await page.getByRole('button',{name:'Выбрать',exact:true}).first().click();
 await page.getByLabel('Слово без ударения',{exact:true}).fill('Автономность');
 await page.getByLabel('Произношение',{exact:true}).fill('Автон+омность');
 await page.getByRole('button',{name:'Сохранить слово',exact:true}).click();await page.getByRole('status').filter({hasText:'сохранено'}).waitFor();
 const dict=await page.evaluate(()=>fetch('/api/portable/stress').then(r=>r.json()));assert.equal(dict.words.Автономность,'Автон+омность');
 const maps=await page.evaluate(()=>fetch('/api/cartography/maps').then(r=>r.json()));
 assert.ok(JSON.stringify(maps).includes('ohm'));
 assert.deepEqual(errors,[]);
 writeFileSync('/tmp/defops-portable-ui.json',JSON.stringify({counts,maps,errors},null,2));
 console.log('ok собранный UI: чистый профиль, 2226 записей, реальный API словаря, каталог локальных карт');
}catch(e){await page.screenshot({path:'/tmp/portable-ui-fail.jpg'});throw e;}finally{await browser.close()}
