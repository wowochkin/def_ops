// Границы архивных снимков и подписей: настоящий ExpoView и CSS, без запуска GAME и служб.
// EXPO_URL=http://127.0.0.1:5179 node scripts/expo-photo-layout-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.EXPO_URL ?? 'http://127.0.0.1:5179';
const out = resolve(process.env.EXPO_PHOTO_OUT ?? '.superpowers/sdd/2026-11-08-tts-batch/photos');
const baseline = process.argv.includes('--baseline');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [], samples = [];
page.on('pageerror', e => errors.push(String(e)));
const fixture = `${url}/photo-layout-check`;
await page.route('**/photo-layout-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;window.__photoReady=true;</script></head><body></body></html>' }));

async function render({ kind = 'attract', count = 1, window: index = 0, point = 0, front = 'su_1bf' } = {}) {
  await page.evaluate(async ({ kind, count, index, point, front }) => {
    if (!window.__photoFixture) {
      await import('/demo/fonts.ts');
      await import('/src/styles.css');
      const source = await (await fetch('/src/expo/ExpoView.tsx')).text();
      const reactUrl = source.match(/from "([^\"]*deps\/react.js[^\"]*)"/)[1];
      const React = (await import(reactUrl)).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js' + new URL(reactUrl, location.href).search)).default;
      const { ExpoView } = await import('/src/expo/ExpoView.tsx');
      const { initialState } = await import('/src/expo/director.ts');
      const { EXPO_DEFAULTS } = await import('/src/expo/settings.ts');
      document.documentElement.classList.add('expo-active');
      const mount = document.createElement('div');
      document.body.append(mount);
      window.__photoFixture = { React, root: createRoot(mount), ExpoView, initialState, EXPO_DEFAULTS };
    }
    const { React, root, ExpoView, initialState, EXPO_DEFAULTS } = window.__photoFixture;
    root.render(React.createElement(ExpoView, { key: `${kind}-${count}-${index}-${point}-${front}`, count, window: index,
      settings: EXPO_DEFAULTS, state: { ...initialState(0), front, phase: kind === 'briefing' ? { kind, point } : { kind } }, send: () => {} }));
  }, { kind, count, index, point, front });
  await page.locator(`.expo[data-phase="${kind}"]`).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.expo-reel img, .expo-brief-photo img, .expo-note-photo img').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.expo-reel img, .expo-brief-photo img, .expo-note-photo img')].every(img => img.complete && img.naturalWidth));
}

async function inspect(label) {
  const result = await page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const stage = box(document.querySelector('.expo')), content = box(document.querySelector('.expo-content'));
    const photos = [...document.querySelectorAll('.expo-reel, .expo-brief-photo, .expo-note-photo')].map(el => {
      const img = el.querySelector('img'), caption = el.querySelector('figcaption'), cs = getComputedStyle(img), scale = stage.width / 1920;
      const image = box(img), text = box(caption);
      const paddingX = (parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)) * scale;
      const paddingY = (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)) * scale;
      const roomW = image.width - paddingX, roomH = image.height - paddingY;
      // «contain» сохраняет все края кадра; если пропорции уже совпали, fit не важен.
      const whole = cs.objectFit === 'contain' || Math.abs(roomW / roomH - img.naturalWidth / img.naturalHeight) < .02;
      const captionStyle = getComputedStyle(caption);
      return { class: el.className, figure: box(el), image, caption: text,
        preceding: el.previousElementSibling ? box(el.previousElementSibling) : null,
        following: el.nextElementSibling ? box(el.nextElementSibling) : null,
        whole, loaded: img.complete && img.naturalWidth > 0,
        captionClipped: (captionStyle.overflowY !== 'visible' && caption.scrollHeight > caption.clientHeight + 1)
          || (captionStyle.overflowX !== 'visible' && caption.scrollWidth > caption.clientWidth + 1),
        captionFont: parseFloat(getComputedStyle(caption).fontSize), text: caption.textContent };
    });
    return { stage, content, photos, buttons: [...document.querySelectorAll('.expo-attract-actions button, .expo-brief-go button')].map(box) };
  });
  const bad = [];
  const inside = (a, b) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
  for (const p of result.photos) {
    if (!inside(p.figure, result.content) || !inside(p.image, p.figure) || !inside(p.caption, p.figure)) bad.push(`${p.class}: фото или подпись вышли из доступной области`);
    if (!p.whole) bad.push(`${p.class}: кадр обрезается`);
    if (p.preceding?.bottom > p.figure.top + 1 || p.following?.top < p.figure.bottom - 1) bad.push(`${p.class}: фото перекрывает текст или управление`);
    if (p.captionClipped) bad.push(`${p.class}: подпись скрыта`);
    if (p.captionFont < 24) bad.push(`${p.class}: подпись меньше 24 px холста`);
    if (p.image.width < 50 || p.image.height < 50) bad.push(`${p.class}: кадр исчез`);
  }
  for (const button of result.buttons) if (!inside(button, result.content)) bad.push('кнопка вышла из доступной области');
  samples.push({ label, ...result, bad });
  if (!baseline) assert.deepEqual(bad, [], label);
}

try {
  await page.goto(fixture);
  await page.waitForFunction(() => window.__photoReady);
  await render();
  await inspect('attract / исходный архивный кадр / 1440×900');
  await page.screenshot({ path: `${out}/${baseline ? 'before' : 'after'}-attract.jpg`, type: 'jpeg', quality: 90 });
  const archive = await page.evaluate(async () => (await import('/src/expo/pictures.ts')).picturesOf('archive').map(({ file, src, caption }) => ({ file, src, caption })));
  for (const photo of archive) {
    await page.locator('.expo-reel').evaluate((el, photo) => {
      el.querySelector('img').src = photo.src;
      el.querySelector('figcaption').textContent = photo.caption;
    }, photo);
    await page.waitForFunction(src => { const img = document.querySelector('.expo-reel img'); return img?.getAttribute('src') === src && img.complete && img.naturalWidth; }, photo.src);
    await inspect(`attract / ${photo.file}`);
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const front of ['su_1bf', 'su_1uf']) for (const point of [0, 1, 2, 3, 4, 5]) {
      for (const layout of [{ count: 3, window: 0 }, { count: 3, window: 2 }, { count: 2, window: 1 }]) {
        await render({ kind: 'briefing', front, point, ...layout });
        await inspect(`briefing / ${front} / пункт ${point + 1} / ${layout.count}:${layout.window} / ${viewport.width}×${viewport.height}`);
      }
    }
  }
  // Проверка ограничения высоты на поздно загруженном горизонтальном/вертикальном кадре,
  // с короткой и многострочной подписью, на тех же настоящих узлах компонентов.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scene of [{}, { kind: 'briefing', count: 3, window: 0 }, { kind: 'briefing', count: 3, window: 2 }, { kind: 'briefing', count: 2, window: 1 }]) {
    for (const shape of [{ width: 1600, height: 900 }, { width: 900, height: 1600 }]) for (const repeat of [1, 3]) {
      await render(scene);
      let release;
      const loaded = new Promise(resolve => { release = resolve; });
      const imageUrl = `${url}/photo-test-${shape.width}-${repeat}.svg`;
      await page.route(imageUrl, async route => {
        await loaded;
        await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${shape.width}" height="${shape.height}"><rect x="2" y="2" width="${shape.width - 4}" height="${shape.height - 4}" fill="#a09275" stroke="#fff" stroke-width="4"/><path d="M0 0L${shape.width} ${shape.height}M${shape.width} 0L0 ${shape.height}" stroke="#111" stroke-width="12"/></svg>` });
      });
      await page.locator('.expo-reel, .expo-brief-photo, .expo-note-photo').first().evaluate((el, { src, repeat }) => {
        el.querySelector('img').src = src;
        el.querySelector('figcaption').textContent = 'Встреча на Эльбе: советские и американские солдаты, 25 апреля 1945. '.repeat(repeat);
      }, { src: imageUrl, repeat });
      await inspect(`ожидание фото / ${JSON.stringify(scene)} / ${shape.width}:${shape.height} / подпись ×${repeat}`);
      release();
      await page.waitForFunction(src => { const img = document.querySelector(`img[src="${src}"]`); return img?.complete && img.naturalWidth; }, imageUrl);
      await inspect(`загружено фото / ${JSON.stringify(scene)} / ${shape.width}:${shape.height} / подпись ×${repeat}`);
      await page.unroute(imageUrl);
    }
  }
  assert.deepEqual(errors, [], 'Ошибки страницы');
} finally {
  writeFileSync(`${out}/${baseline ? 'before' : 'after'}-bounds.json`, JSON.stringify({ samples, errors }, null, 2));
  await browser.close();
}
const failures = samples.filter(s => s.bad.length);
if (baseline) {
  console.log(`baseline: ${failures.length}/${samples.length} кадров с нарушениями; ${failures[0]?.bad.join('; ')}`);
  assert.equal(failures.length, 0, 'Фото и подпись должны помещаться целиком');
}
console.log(`ok фото: ${samples.length} проверок границ, 3 размера окна, 2 фронта, 6 пунктов, 3 раскладки, поздняя загрузка и разные пропорции`);
