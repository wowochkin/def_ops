// Кадры монтажа в браузере разработки: реальные данные и renderer, выбор сцены для визуальной проверки.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { expoPage } from './expo-mock.mjs';
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = process.env.INTRO_FRAMES ?? '/tmp/expo-intro-frames';
const browser = await chromium.launch();
const core = agentsProcess();
const page = await expoPage(browser, { core });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.routeWebSocket(`ws://${new URL(url).host}/**`, s => s.close());
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await page.evaluate(async (previewProgress) => {
    const source = await (await fetch('/src/expo/intro-view.tsx')).text();
    const reactUrl = source.match(/from "([^\"]*deps\/react.js[^\"]*)"/)[1];
    const React = (await import(reactUrl)).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { IntroView } = await import('/src/expo/intro-view.tsx');
    const { INTRO_CUES, introGap } = await import('/src/expo/intro-story.ts');
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;inset:0;background:#050c16;z-index:9999;overflow:hidden';
    const mount = document.createElement('div');
    mount.style.cssText = 'position:absolute;width:1920px;height:1080px;left:50%;top:50%;transform:translate(-50%,-50%) scale(.75)';
    wrapper.append(mount); document.body.append(wrapper);
    const root = createRoot(mount);
    window.__introPreview = (line, pane = 'film', progress = previewProgress) => {
      const ms = INTRO_CUES.slice(0, line - 1).reduce((s, c, i) => s + c.durationMs + introGap(i), 0) + INTRO_CUES[line - 1].durationMs * progress;
      // Один и тот же момент реплики на обоих экранах, независимо от скорости снимка.
      root.render(React.createElement(IntroView, { pane, line, elapsedMs: ms, cueElapsedMs: INTRO_CUES[line - 1].durationMs * progress, paused: true, onSkip: () => {} }));
    };
    window.__introPreview(1);
  }, Number(process.env.INTRO_PROGRESS ?? .45));
  await page.locator('.expo-intro3d canvas').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(out, { recursive: true });
  const scenes = process.env.INTRO_SCENES === 'none' ? [] : process.env.INTRO_SCENES?.split(',').map(Number) ?? Array.from({ length: 13 }, (_, i) => i + 1);
  const allSideScenes = Boolean(process.env.INTRO_SIDE_ALL || process.env.INTRO_ALL_PANES);
  for (const line of process.env.INTRO_SIDE_ALL ? [] : scenes) {
    await page.evaluate(n => window.__introPreview(n), line);
    await page.waitForTimeout(2200);
    await page.locator('.intro-heading').evaluateAll(els => els.forEach(el => el.getAnimations().forEach(a => a.finish())));
    await page.screenshot({ path: `${out}/${String(line).padStart(2,'0')}.jpg`, type: 'jpeg', quality: 88 });
  }
  for (const pane of ['factors','swarm']) for (const line of allSideScenes ? scenes : [6]) {
    await page.evaluate(({line,pane}) => window.__introPreview(line,pane), {line,pane});
    await page.locator(`.expo-intro3d-${pane} canvas`).waitFor();
    await page.waitForTimeout(2200);
    if (await page.locator('.intro-no-webgl, .intro-heading, .expo-intro3d-line').count()) throw new Error(`Некорректный боковой экран: ${pane}, раздел ${line}`);
    await page.locator('.intro-heading').evaluateAll(els => els.forEach(el => el.getAnimations().forEach(a => a.finish())));
    await page.screenshot({ path: `${out}/${pane}${allSideScenes ? '-' + String(line).padStart(2,'0') : ''}.jpg`, type: 'jpeg', quality: 88 });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`ok ${(process.env.INTRO_SIDE_ALL ? 0 : scenes.length) + (allSideScenes ? scenes.length * 2 : 2)} кадров: ${out}`);
} finally { await browser.close(); core.stop(); }
