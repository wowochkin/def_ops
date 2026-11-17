// Отдельное отключение аудио: настоящее изолированное ядро, LLM mock, отсутствие TTS-запросов.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const url=process.env.EXPO_URL??'http://127.0.0.1:5178';
const hybrid = process.env.EXPO_HYBRID_CHECK === '1';
const liveDebrief = process.env.EXPO_HYBRID_LIVE === '1';
const bank = JSON.parse(readFileSync('apps/editor/src/expo/bank-data/berlin-1945.cards.json', 'utf8'));
const missing = 'По темпу как в истории.';
const catalog = hybrid ? JSON.parse(readFileSync('apps/editor/public/expo-debrief/manifest.json', 'utf8')) : null;
if (liveDebrief) {
  assert.ok(catalog?.voices['konev-12s'][missing]);
  delete catalog.voices['konev-12s'][missing];
}
const core=agentsProcess();const browser=await chromium.launch();
const page=await expoPage(browser,{core,cfg:{...EXPO_CFG,aiMode:'ai',timer:{on:false,seconds:30},idleSeconds:600,resultSeconds:120},voice:'running'});
const errors=[],audio=[],recordings=[];let comments=0;
page.on('pageerror',e=>errors.push(String(e)));
page.on('response', response => {
  if (response.ok() && /\/expo-debrief\/clips\/[^/]+\.ogg$/.test(response.url())) recordings.push(response.url());
});
if (catalog) await page.route('**/expo-debrief/manifest.json', route => route.fulfill({ json: catalog }));
await page.addInitScript(()=>{
  localStorage.setItem('def_ops.portable.setup.v1','1');
  localStorage.setItem('def_ops.llm',JSON.stringify({model:'prism-ml/bonsai-27b'}));
  const original=window.__expoNative;
  window.__expoNative=(cmd,args)=>{
    if(cmd==='expo_settings_write'&&!args.bad)localStorage.setItem('test-expo-settings',args.text);
    if(cmd==='expo_settings_read'&&localStorage.getItem('test-expo-settings'))return localStorage.getItem('test-expo-settings');
    return original(cmd,args);
  };
});
await page.route('**/api/portable/library',r=>r.fulfill({status:404,body:''}));
await page.route('**/api/portable/stress',r=>r.fulfill({contentType:'application/json',body:readFileSync('apps/editor/src/expo/bank-data/stress.json','utf8')}));
await page.routeWebSocket(`ws://${new URL(url).host}/**`,s=>s.close());
await page.routeWebSocket('ws://127.0.0.1:47645/**',socket=>socket.onMessage(raw=>{
  if(typeof raw!=='string')return;const m=JSON.parse(raw);
  if(m.type==='hello')socket.send(JSON.stringify({type:'ready',voices:[],roles:{},loaded:true,capabilities:{prepare_batch:true,tts_temperature:true,tts_cpu_threads:true},tts:{current:'qwen3-ru-stress',state:'ready',engines:[],managed:false,resident:true}}));
  if(['prepare','prepare-batch','say','tts-resource'].includes(m.type))audio.push(m);
  if (m.type === 'prepare-batch') socket.send(JSON.stringify({ type: 'prepared-batch', id: m.id, done: m.texts.length, total: m.texts.length, audio_s: m.texts.map(() => 1) }));
  if (m.type === 'say') socket.send(JSON.stringify({ type: 'say-done', id: m.id }));
}));
await page.route('**/llm/v1/chat/completions',async route=>{
  const body=route.request().postDataJSON();assert.equal(body.max_tokens,50);comments++;
  await route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'Резервы сохранены. Продвижение продолжается.'}}]})+'\n\ndata: [DONE]\n\n'});
});
const open=async()=>{await page.keyboard.press('Control+Alt+Shift+KeyO');await page.getByLabel('ПИН',{exact:true}).fill('0000');await page.getByRole('button',{name:'Открыть меню'}).click();};
try {
  await page.goto(`${url}/?expo=0`);await page.getByRole('button',{name:'Коснитесь, чтобы принять командование'}).waitFor({timeout:120000});
  await open();
  if (liveDebrief) {
    await page.getByRole('group', { name: 'Генерация и озвучка' }).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: 'docs/img/expo-operator.jpg', type: 'jpeg', quality: 90 });
  }
  await page.getByRole('checkbox',{name:'Озвучивать комментарии',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Догенерировать озвучку итога',exact:true}).setChecked(liveDebrief);
  await page.getByLabel('Потоки CPU для TTS',{exact:true}).selectOption('1');
  await page.waitForFunction(live=>{const s=JSON.parse(localStorage.getItem('test-expo-settings')??'null');return s?.generation?.commentVoice===false&&s.generation.debriefVoice===live&&s.generation.cpuThreads===1;}, liveDebrief);
  await page.reload();await page.getByRole('button',{name:'Коснитесь, чтобы принять командование'}).waitFor({timeout:120000});
  await open();
  for(const name of ['Комментарии после решений','Итоговый разбор'])assert.equal(await page.getByRole('checkbox',{name,exact:true}).isChecked(),true);
  assert.equal(await page.getByRole('checkbox',{name:'Озвучивать комментарии',exact:true}).isChecked(),false);
  assert.equal(await page.getByRole('checkbox',{name:'Догенерировать озвучку итога',exact:true}).isChecked(),liveDebrief);
  assert.equal(await page.getByLabel('Потоки CPU для TTS',{exact:true}).inputValue(),'1');
  await page.getByRole('group',{name:'Генерация и озвучка'}).scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);
  if (!liveDebrief) await page.screenshot({path:'docs/img/expo-operator-voice.jpg',type:'jpeg',quality:90});
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  console.log('ok отдельные флаги аудио и CPU1 сохранены, текстовые этапы включены');
  await page.waitForTimeout(1800);await page.getByRole('button',{name:'Коснитесь, чтобы принять командование'}).click();
  await page.getByRole('button',{name:/1-й Украинский/}).click();await page.getByRole('button',{name:'Начать операцию'}).click();await page.getByRole('button',{name:'К решениям'}).click();
  for(const n of [1,2,3]){
    const title = bank.cards.find(card => card.front === 'su_1uf' && card.turn === n && card.historical).title;
    const card = page.getByRole('button',{name:/^Карточка [123]$/}).filter({hasText:title});
    await card.click({timeout:90000});await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
    await page.locator('.expo-subs-text').filter({hasText:'Резервы сохранены. Продвижение продолжается.'}).waitFor({timeout:90000});
    const reading = performance.now();
    assert.equal(comments,n);assert.deepEqual(audio,[]);
    if(n<3) {
      await page.waitForFunction(n=>document.querySelector('.expo-header')?.textContent.includes(`Перелом ${n} из 3`),n+1,{timeout:8000});
      const elapsed = performance.now() - reading;
      assert.ok(elapsed >= 3000 && elapsed < 4600, `Пауза чтения комментария ${n}: ${elapsed} мс`);
    }
  }
  await page.locator('.expo[data-phase="result"]').waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.expo')?.textContent.includes('Разбираю, как она прошла'),{},{timeout:10000});
  if (catalog && !recordings.length) await page.waitForResponse(response => response.ok() && /\/expo-debrief\/clips\/[^/]+\.ogg$/.test(response.url()), { timeout: 10000 });
  assert.equal(comments,3);assert.deepEqual(errors,[]);
  if (liveDebrief) {
    assert.deepEqual(audio.map(m => m.type), ['prepare-batch']);
    assert.deepEqual(audio[0].texts.map(text => text.replace(/\u0301/g, '')), [missing]);
    console.log('ok включённая догенерация запросила только намеренно исключённую фразу, вступление загружено из OGG');
  } else {
    assert.deepEqual(audio,[]);
    if (catalog) assert.ok(recordings.length > 0);
    console.log('ok три LLM-комментария с паузой чтения, итог открыт без запросов TTS');
  }
} catch(error) { await page.screenshot({path:`/tmp/defops-hybrid-${liveDebrief?'live':'off'}-failed.jpg`,type:'jpeg'}).catch(()=>{}); console.error('Аудио:',audio.map(m=>m.type), 'загруженные клипы:', recordings.length, 'ошибки окна:', errors); throw error; } finally {await browser.close();core.stop();}
