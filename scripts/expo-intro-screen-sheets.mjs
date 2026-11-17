// Три развёртки настоящего ExpoView: по тринадцать сцен на левом, центральном и правом экране.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';

const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve(process.env.INTRO_SHEETS ?? '.superpowers/sdd/2026-11-07-expo-intro/screen-sheets');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const core = agentsProcess();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, intro: true }, viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
await page.route('**/expo-voice/**', route => route.fulfill({ status: 404, body: '' }));

try {
  mkdirSync(out, { recursive: true });
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.locator('.expo[data-phase="intro"]').waitFor();
  await page.locator('.expo-intro3d canvas').waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const names = await page.locator('.intro-scene-link').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label').replace(/^Перейти к сцене \d+: /, '')));
  assert.equal(names.length, 13);
  assert.equal(names[1], 'Демонстрационный стенд');
  assert.equal(names[2], 'Возможности развития');
  assert.equal(await page.locator('.intro-scene-number').count(), 0);

  if (process.env.INTRO_SHEETS_COMPOSE_ONLY !== '1') for (const [name, display, pane] of [['left', 1, 'factors'], ['center', 2, 'film'], ['right', 3, 'swarm']]) {
    await page.locator('.expo-intro-switch').getByRole('button', { name: String(display), exact: true }).click();
    await page.locator(`.expo-intro3d-${pane} canvas`).waitFor({ timeout: 30_000 });
    for (let scene = 1; scene <= names.length; scene++) {
      await page.getByRole('button', { name: new RegExp(`^Перейти к сцене ${scene}:`) }).click();
      await page.locator(`.expo-intro3d-${pane}[data-line="${scene}"] canvas`).waitFor();
      await page.waitForTimeout(1600);
      await page.mouse.move(1435, 5);
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.intro-scene-navigation button:hover, .intro-scene-navigation button:focus-visible').count(), 0);
      assert.equal(await page.locator(`.expo-intro3d-${pane}`).getAttribute('data-line'), String(scene));
      assert.equal(await page.locator('.intro-no-webgl').count(), 0);
      assert.equal(await page.locator('.intro-scene-link[aria-current="step"]').getAttribute('aria-label'), `Перейти к сцене ${scene}: ${names[scene - 1]}`);
      await page.screenshot({ path: `${out}/${name}-${String(scene).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 92 });
    }
    console.log(`ok ${name}: тринадцать сцен сняты через ручное переключение`);
  }
  assert.deepEqual(errors, []);

  // Контактные листы собираются из снятых кадров; номера здесь находятся вне интерфейса.
  execFileSync('python3', ['-c', `
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
data = json.load(sys.stdin)
root = Path(data['out'])
font_paths = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
font = ImageFont.truetype(next(p for p in font_paths if Path(p).exists()), 22)
for pane in ['left', 'center', 'right']:
    sheet = Image.new('RGB', (2160, ((len(data['names']) + 2) // 3) * 490), '#050c16')
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(data['names']):
        x, y = index % 3 * 720, index // 3 * 490
        with Image.open(root / f'{pane}-{index + 1:02d}.jpg') as frame:
            assert frame.size == (1440, 900), (pane, index + 1, frame.size)
            sheet.paste(frame.resize((720, 450), Image.Resampling.LANCZOS), (x, y + 40))
        draw.text((x + 18, y + 8), f'{index + 1:02d}  {name}', fill='#77e2df', font=font)
    sheet.save(root / f'{pane}-overview.jpg', quality=94, subsampling=0)
`], { input: JSON.stringify({ out, names }), stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`ok три развёртки 2160×2450 и 39 кадров 1440×900: ${out}`);
} catch (error) {
  await page.screenshot({ path: `${out}/capture-failed.jpg`, type: 'jpeg' }).catch(() => {});
  if (errors.length) console.error(errors.join('\n'));
  throw error;
} finally {
  await browser.close();
  core.stop();
}
