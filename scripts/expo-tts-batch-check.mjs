// Пакетная подготовка: реальные core/stage/WebAudio, контролируемый WS batch и native LM mock.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const firstOnly = process.env.EXPO_COMMENT_FIRST_ONLY === '1';
const allThree = true;
const resident = process.env.EXPO_RESIDENT === '1';
const cpuThreads = resident ? 2 : 4;
const llmMs = Number(process.env.EXPO_COMMENT_LLM_MS ?? 3000);
const generatedCommentText = 'Вы выбрали продолжение наступления на широком фронте. Это позволило сохранить резервы и не ослаблять соседние участки. Армии продолжили движение в соответствии с вашим приказом. Результат следует оценивать по достигнутым рубежам и выполненным задачам.';
const commentText = 'Вы выбрали продолжение наступления на широком фронте. Это позволило сохранить резервы и не ослаблять соседние участки.';
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve('.superpowers/sdd/2026-11-08-tts-batch/browser');
mkdirSync(out, { recursive: true });
const core = agentsProcess();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, aiMode:'ai', timer:{on:false,seconds:30}, idleSeconds:600, resultSeconds:120 }, voice:'running' });
await page.addInitScript(() => {
  localStorage.setItem('def_ops.llm', JSON.stringify({ model: 'prism-ml/bonsai-27b', voiceModel: 'unused-voice-model' }));
  localStorage.setItem('def_ops.portable.setup.v1', '1');
});
await page.route('**/api/portable/library', route => route.fulfill({ status: 404, body: '' }));
// Проверка полного пакетного пути для комплекта без готовой озвучки итогов.
await page.route('**/expo-debrief/manifest.json', route => route.fulfill({ status: 404, body: '' }));
await page.route('**/api/portable/stress', route => route.fulfill({ contentType: 'application/json', body: readFileSync('apps/editor/src/expo/bank-data/stress.json', 'utf8') }));
const errors = [], events = [];
let lastSay = null, closed = false;
let modelLoaded=resident, ttsResident=resident, nativeId='prism-ml/bonsai-27b';
let nativeLoads=0, nativeUnloads=0, weightLoads=resident?1:0, prepareCount=0, batchCalls=0, batchTexts=0;
page.on('pageerror', error => errors.push(String(error)));
const read = () => page.evaluate(() => ({ now:performance.now(), phase:document.querySelector('.expo')?.dataset.phase, header:document.querySelector('.expo-header')?.textContent, reveal:!!document.querySelector('.expo-reveal'), caption:document.querySelector('.expo-subs-text')?.textContent?.trim() }));
const record = async (kind, data={}) => { const event={kind,...data,...await read()}; events.push(event); return event; };
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket=>socket.close());
await page.route('**/llm/api/v1/models**', async route => {
  const request=route.request(); const path=new URL(request.url()).pathname;
  if(request.method()==='GET') return route.fulfill({json:{models:[{key:'prism-ml/bonsai-27b',type:'llm',loaded_instances:modelLoaded?[{id:nativeId,config:{context_length:4096,eval_batch_size:512,parallel:1,flash_attention:true}}]:[]}]}});
  const body=request.postDataJSON();
  if(path.endsWith('/unload')) {
    assert.equal(resident,false,'постоянный режим не делает eject LLM');
    assert.equal(body.instance_id,nativeId); await record('native-unload');
    await new Promise(r=>setTimeout(r,150)); modelLoaded=false; nativeUnloads++;
    return route.fulfill({json:{instance_id:nativeId}});
  }
  if(path.endsWith('/load')) {
    assert.equal(resident,false,'постоянный режим использует уже загруженную Bonsai');
    assert.equal(body.model,'prism-ml/bonsai-27b'); assert.equal(ttsResident,false,'LLM не загружается поверх TTS');
    await record('native-load'); await new Promise(r=>setTimeout(r,1500));
    nativeId='bonsai-instance-'+(++nativeLoads); modelLoaded=true;
    return route.fulfill({json:{instance_id:nativeId,status:'loaded'}});
  }
  throw Error(path);
});
await page.route('**/llm/v1/chat/completions', async route => {
  const body = route.request().postDataJSON();
  assert.equal(body.model, nativeId); assert.equal(modelLoaded,true); assert.equal(ttsResident,resident);
  assert.equal(body.ttl, 86400);
  assert.equal(body.max_tokens, 50);
  const event = await record('llm');
  await new Promise(r=>setTimeout(r,llmMs));
  if(closed)return;
  const content=generatedCommentText;
  await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`}).catch(()=>{});
  await record('llm-return', {requestAt:event.now});
});
function pcm(id) { const bytes=Buffer.alloc(9+8000*8*2); bytes[0]=1; bytes.writeUInt32LE(id,1); bytes.writeUInt32LE(8000,5); return bytes; }
await page.routeWebSocket('ws://127.0.0.1:47645/**', socket=>{
  const cancelled=new Set();
  socket.onMessage(async raw=>{
    if(typeof raw!=='string')return;
    const m=JSON.parse(raw);
    if(['prepare','prepare-batch','say'].includes(m.type)) assert.equal(m.cpu_threads,cpuThreads,'CPU-потоки из меню доходят до TTS');
    if(m.type==='hello') socket.send(JSON.stringify({type:'ready',capabilities:{prepare_batch:true,tts_temperature:true,tts_cpu_threads:true}, voices:[],roles:{},loaded:true,tts:{current:'qwen3-ru-stress',state:'ready',engines:[],managed:!resident,resident:ttsResident,phase:ttsResident?'ready':'unloaded'}}));
    if(m.type==='tts-resource') {
      assert.equal(resident,false,'постоянный режим не выгружает/загружает TTS');
      if(m.op==='load') {
        assert.equal(modelLoaded,false,'TTS не загружается поверх LLM');
        await record('tts-load',{voice:m.voice_id});
        if(!ttsResident)weightLoads++;
        await new Promise(r=>setTimeout(r,300));ttsResident=true;
      } else { await record('tts-unload');await new Promise(r=>setTimeout(r,100));ttsResident=false; }
      socket.send(JSON.stringify({type:'tts-resource-done',id:m.id,tts:{current:'qwen3-ru-stress',state:'ready',engines:[],managed:!resident,resident:ttsResident,phase:ttsResident?'ready':'unloaded'}}));
    }
    if(m.type==='prepare-batch') {
      assert.equal(ttsResident,true); assert.equal(modelLoaded,resident);
      assert.equal(m.temperature,0.2); assert.equal(m.batch_size,4); assert.equal(m.role,'chief');
      assert.equal(m.voice_id,'konev-12s'); batchTexts=m.texts.length;
      for(let start=0;start<m.texts.length;start+=m.batch_size) {
        const chunk=m.texts.slice(start,start+m.batch_size); batchCalls++;
        await record('native-batch-call',{size:chunk.length,temperature:m.temperature});
        await new Promise(r=>setTimeout(r,1000));
        for(const text of chunk) await record('prepare',{id:m.id,text});
        const done=Math.min(m.texts.length,start+chunk.length);
        socket.send(JSON.stringify({type:'prepared-batch',id:m.id,done,total:m.texts.length,...(done===m.texts.length?{audio_s:m.texts.map(()=>8)}:{})}));
        if(start===0 && done<m.texts.length) {
          const percent=Math.floor(done/m.texts.length*100);
          await page.waitForFunction(p=>document.querySelector('.expo-scroll-rest')?.textContent===`Готовим итог — ${p}%`,percent);
          await page.evaluate(()=>document.fonts.ready);
          await page.screenshot({path:resolve('docs/img/expo-preparing-result.jpg'),type:'jpeg',quality:90});
          console.log(`ok плашка содержит только фактический процент ${percent}%`);
        }
      }
    }
    if(m.type==='prepare') {
      assert.equal(ttsResident,true);assert.equal(modelLoaded,resident);
      prepareCount++; assert.equal(m.temperature,0.2);
      if(prepareCount===6) {
        await page.waitForTimeout(150);await page.evaluate(()=>document.fonts.ready);
        const banner=await page.locator('.expo-scroll-rest').textContent();
        assert.match(banner,/^Готовим итог — \d+%$/);
        await page.screenshot({path:resolve('docs/img/expo-preparing-result.jpg'),type:'jpeg',quality:90});
        console.log('ok плашка итога показывает только фактический процент готовности');
      }
      assert.equal(m.role, 'chief');
      assert.equal(m.voice_id, 'konev-12s');
      await record('prepare',{id:m.id,text:m.text});
      await new Promise(r=>setTimeout(r,1000));
      if(!closed)socket.send(JSON.stringify({type:'prepared',id:m.id,audio_s:8}));
    }
    if(m.type==='cancel-prepare') { cancelled.add(m.id); await record('cancel-prepare',{id:m.id}); }
    if(m.type==='say') {
      lastSay={socket,id:m.id};
      await record('say',{id:m.id,text:m.text});
      socket.send(pcm(m.id));
      socket.send(JSON.stringify({type:'say-done',id:m.id}));
      await record('say-done',{id:m.id});
    }
    if(m.type==='played') await record('played',{id:m.id});
    if(m.type==='stop') await record('stop',{id:m.id});
  });
});
async function waitEvent(kind, after=0) {
  const deadline=Date.now()+180000;
  while(Date.now()<deadline) { const event=events.find(e=>e.kind===kind&&e.now>after); if(event)return event; await page.waitForTimeout(100); }
  throw new Error(`Не дождались ${kind}`);
}
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button',{name:'Коснитесь, чтобы принять командование'}).waitFor({timeout:120000});
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН',{exact:true}).fill('0000');
  await page.getByRole('button',{name:'Открыть меню'}).click();
  assert.equal(await page.getByLabel('Температура голоса',{exact:true}).inputValue(),'0.2');
  assert.equal(await page.getByLabel('Размер пакета',{exact:true}).inputValue(),'4');
  assert.equal(await page.getByLabel('Потоки CPU для TTS',{exact:true}).inputValue(),'2');
  for(const name of ['Озвучивать комментарии','Догенерировать озвучку итога']) assert.equal(await page.getByRole('checkbox',{name,exact:true}).isChecked(),true);
  await page.getByRole('group',{name:'Генерация и озвучка'}).scrollIntoViewIfNeeded();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:resolve('docs/img/expo-operator.jpg'),type:'jpeg',quality:90});
  if(!resident) await page.getByLabel('Потоки CPU для TTS',{exact:true}).selectOption('4');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.waitForTimeout(500);
  await page.getByRole('button',{name:'Коснитесь, чтобы принять командование'}).click();
  await page.getByRole('button',{name:/1-й Украинский/}).click();
  await page.getByRole('button',{name:'Начать операцию'}).click();
  await page.getByRole('button',{name:'К решениям'}).click();
  await page.getByRole('button',{name:'Карточка 1',exact:true}).click();
  await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
  const llm=await waitEvent('llm');
  assert.match(llm.header,/Перелом 1 из 3/);
  await page.waitForTimeout(2300);
  assert.match((await read()).header,/Перелом 1 из 3/,'во время медленной генерации нельзя перейти дальше');
  const say=await waitEvent('say',llm.now);
  for(let i=0;i<12;i++) {
    await page.waitForTimeout(500);
    const state=await read();
    assert.match(state.header,/Перелом 1 из 3/,'до конца аудио должен оставаться первый перелом');
    assert.equal(state.caption,commentText,'комментарий должен оставаться видимым');
    if(i===3) { await page.mouse.move(10,10); await page.screenshot({path:resolve('docs/img/expo-scroll-comment.jpg'),type:'jpeg',quality:90}); }
  }
  const played=await waitEvent('played',say.now);
  assert.ok(played.now-say.now>=7600,`WebAudio должен отыграть 8с: ${played.now-say.now}`);
  await page.waitForFunction(()=>document.querySelector('.expo-header')?.textContent.includes('Перелом 2 из 3'),{},{timeout:10000});
  const next=await record('next-turn');
  // Событие конца звука приходит между тиками режиссёра (250 мс); его logical now — последний тик.
  assert.ok(next.now-played.now>=0 && next.now-played.now<1000,`немедленный переход после played: ${next.now-played.now}`);
  console.log(`ok LLM${llmMs/1000}с + prepare1с + настоящий WebAudio8с, без дополнительной паузы, переход только после played`);
  if(allThree) {
    let after = next.now;
    for (const n of [2, 3]) {
      await page.getByRole('button',{name:'Карточка 1',exact:true}).waitFor({timeout:60000});
      await page.getByRole('button',{name:'Карточка 1',exact:true}).click();
      await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
      const request = await waitEvent('llm', after);
      assert.match(request.header,new RegExp(`Перелом ${n} из 3`));
      const spoken = await waitEvent('say',request.now);
      assert.equal(spoken.text.replaceAll('́',''), commentText);
      const end = await waitEvent('played',spoken.now);
      if(n===2) {
        await page.waitForFunction(()=>document.querySelector('.expo-header')?.textContent.includes('Перелом 3 из 3'),{},{timeout:15000});
        after = (await record('third-turn')).now;
      } else {
        assert.equal(events.filter(e=>e.kind==='llm').length,3,'у каждого из трёх решений свой запрос LLM');
        await page.waitForFunction(()=>document.querySelector('.expo')?.dataset.phase==='result',{},{timeout:120000});
        const result = await record('result');
        const prepared = events.filter(e=>e.kind==='prepare' && e.now>end.now && /Перелом 3 из 3/.test(e.header));
        assert.ok(prepared.length>1,'до итога должен быть подготовлен весь разбор');
        assert.ok(prepared.every(e=>e.now<result.now));
        console.log(`ok все 3 ответа LLM сокращены до 220 символов и переданы в TTS; ${prepared.length} реплик итога подготовлены до показа`);
      }
    }
  } else if(!firstOnly) {
  await page.getByRole('button',{name:'Карточка 1',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Карточка 1',exact:true}).click();
  await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
  const second=await waitEvent('say',next.now);
  await page.waitForTimeout(500);
  const old=lastSay;
  await page.getByRole('button',{name:'Начать заново',exact:true}).click();
  const restarted=await record('restart');
  old.socket.send(pcm(old.id));
  old.socket.send(JSON.stringify({type:'say-done',id:old.id}));
  await page.waitForTimeout(8500);
  assert.ok(!events.some(e=>e.kind==='played'&&e.id===old.id&&e.now>restarted.now),'поздний старый звук не должен доигрываться после restart');
  assert.doesNotMatch((await read()).header??'',/Перелом 2 из 3/);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/after-restart.jpg`,type:'jpeg',quality:90});
  console.log('ok restart обрывает активный звук; поздний PCM/say-done не возвращается на экран');
  }
  assert.equal(batchCalls,Math.ceil(batchTexts/4));
  assert.ok(batchTexts>4);
  assert.equal(prepareCount,3,'итог не готовится одиночными prepare');
  console.log(`ok ${batchTexts} фраз итога через ${batchCalls} пакетных вызова, температура0.2, CPU${cpuThreads}, без повторного prepare`);
  assert.equal(nativeLoads,resident?0:3,'число загрузок LLM соответствует режиму');
  assert.equal(nativeUnloads,resident?0:3);assert.equal(weightLoads,resident?1:3,'resident TTS сохраняется на всех решениях');
  assert.deepEqual(errors,[]);
  console.log(resident ? 'ok постоянный режим:0 загрузок/выгрузок Bonsai, одна прогретая TTS для трёх решений и итога' : 'ok native LLM load/eject и TTS load/unload: три цикла, третья TTS сохранена для всего итога');
  writeFileSync(`${out}/${firstOnly?'first-only-verification':'verification'}.json`,JSON.stringify({events,errors},null,2));
} catch(error) {
  writeFileSync(`${out}/verification.json`,JSON.stringify({events,errors,error:String(error)},null,2));
  await page.screenshot({path:`${out}/failed.jpg`,type:'jpeg',quality:85}).catch(()=>{});
  throw error;
} finally {closed=true;await browser.close();core.stop();}
