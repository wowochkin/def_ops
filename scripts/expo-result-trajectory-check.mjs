// Изолированный сеанс ядра: проверка пути 5-й гв. армии и времени итогового повтора.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { expoPage } from './expo-mock.mjs';
const core = agentsProcess(), browser = await chromium.launch();
const page = await expoPage(browser, { core });
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve('.superpowers/sdd/2026-11-07-expo-result-trajectory'); mkdirSync(out, { recursive: true });
try {
  await page.route('**/trajectory-check', r => r.fulfill({ contentType: 'text/html', body: `<html><body><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;window.__ready=true;</script></body></html>` }));
  await page.goto(`${url}/trajectory-check`); await page.waitForFunction(() => window.__ready);
  const report = await page.evaluate(async () => {
    const [{ coreEnv }, { ExpoSession }, { BANK }, { stageMaps }, { mapPlan }, { initialState }, { operationDebrief, debriefUtterances, resultBeat }] = await Promise.all([
      import('/src/expo/model.ts'), import('/src/expo/session.ts'), import('/src/expo/bank.ts'), import('/src/expo/stage-maps.ts'), import('/src/expo/ExpoView.tsx'), import('/src/expo/director.ts'), import('/src/expo/debrief.ts')
    ]);
    const env = await coreEnv();
    const session = new ExpoSession(env, BANK, 'su_1uf', () => .01);
    await session.start();
    for (const n of [1,2,3]) {
      session.deal(n);
      let slot = session.view.cards.findIndex(c => c.id === `uf${n}-hist`);
      if (n === 3) {
        const card = BANK.cards.find(c => c.id === 'uf3-elbe');
        slot = session.view.cards.findIndex(c => c.id !== 'uf3-hist');
        if (!session.replace(slot, card)) throw Error('Не удалось поставить вариант Эльбы');
      }
      await session.decide(n, slot);
    }
    const maps = stageMaps(() => {});
    await maps.session(session.lastTrace, env.history, 'su_1uf');
    const doc = maps.docs.session.doc, mv = session.view;
    const { followHistory, unitAt, dailyPaths } = await import('/src/expo/stage-doc.ts');
    const followed = followHistory(doc, mv.front);
    const inspectArmy = f => ({id:f.id,ref:f.ref,name:f.name,at:f.at,time:f.time,layer:f.layerId, keyframes:f.keyframes});
    const armyFeatures = doc.features.filter(f => f.kind === 'symbol' && ['su_5gva','su_2awp'].includes(f.ref)).map(inspectArmy);
    const state = { ...initialState(0), front: mv.front, phase: { kind: 'result' } };
    const rows = debriefUtterances(operationDebrief(mv).paragraphs).map(spoken => {
      const plan = mapPlan({ state, mv, maps: maps.docs, lit:null, count:3,index:1,spoken });
      return { spoken,beat:resultBeat(mv,spoken),run:plan.run,time:plan.time,camera:plan.camera };
    });
    await import('/demo/fonts.ts'); await import('/src/styles.css');
    const source = await (await fetch('/src/expo/StageMap.tsx')).text();
    const reactUrl = source.match(/from "([^\"]*deps\/react.js[^\"]*)"/)[1];
    const React = (await import(reactUrl)).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js' + new URL(reactUrl,location.href).search)).default;
    const { StageMap } = await import('/src/expo/StageMap.tsx');
    document.body.style.cssText = 'margin:0;background:#10201d';
    const mount = document.createElement('div'); mount.style.cssText='width:1440px;height:900px;position:relative'; document.body.append(mount);
    const root = createRoot(mount);
    window.__trajectorySamples = [];
    const camera = { bbox: [12.4,50.95,14.5,52.1], key: 'trajectory-test', ms: 0, pad: .04 };
    window.__trajectoryPlay = () => root.render(React.createElement(StageMap, { doc:followed, time:'1945-04-25T14:00', camera, run:{from:'1945-04-25T14:00',to:'1945-05-02T05:00',ms:6000,key:'elbe',linear:true}, onTime:t=>window.__trajectorySamples.push({t,actual:unitAt(followed,'su_5gva',t),raw:unitAt(doc,'su_5gva',t)}), onDone:()=>window.__trajectoryDone=true }));
    root.render(React.createElement(StageMap,{doc:followed,time:'1945-04-25T14:00',camera}));
    maps.dispose();
    return { decisions:mv.decisions, armies:armyFeatures, followed:followed.features.filter(f=>f.kind==='symbol'&&f.ref==='su_5gva').map(inspectArmy), rows };
  });
  const label = process.env.TRAJECTORY_LABEL ?? 'before';
  writeFileSync(`${out}/trace-${label}.json`,JSON.stringify(report,null,2));
  if (label === 'after') {
    assert.deepEqual(report.followed.map(f=>f.keyframes),report.armies.filter(f=>f.ref==='su_5gva').map(f=>f.keyframes));
    await page.waitForTimeout(1000);
    await page.screenshot({path:`${out}/trajectory-start.jpg`,type:'jpeg',quality:90});
    await page.evaluate(()=>window.__trajectoryPlay());
    await page.waitForFunction(()=>window.__trajectoryDone,{},{timeout:20000});
    await page.waitForTimeout(150);
    const samples=await page.evaluate(()=>window.__trajectorySamples);
    assert.ok(samples.length>100);
    assert.ok(samples.every(s=>JSON.stringify(s.actual)===JSON.stringify(s.raw)));
    assert.deepEqual(samples.at(-1).actual,[12.9934,51.5383]);
    await page.screenshot({path:`${out}/trajectory-end.jpg`,type:'jpeg',quality:90});
    writeFileSync(`${out}/replay-verification.json`,JSON.stringify({frames:samples.length,first:samples[0],last:samples.at(-1),allPositionsMatchCore:true},null,2));
    console.log(`ok browser replay: ${samples.length} кадров, все положения совпадают с исходным расчётом`);
  }
  console.log(JSON.stringify({decisions:report.decisions,armies:report.armies.map(f=>({id:f.id,ref:f.ref,layer:f.layer,frames:f.keyframes?.length,first:f.keyframes?.[0],last:f.keyframes?.at(-1)})),rows:report.rows.map(r=>({text:r.spoken.slice(0,55),phase:r.beat.phase,turn:r.beat.turn,run:r.run,time:r.time}))}));
} finally { await browser.close(); core.stop(); }
