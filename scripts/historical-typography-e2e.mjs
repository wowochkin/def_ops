import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.KSHVI_PREVIEW_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('def_ops.app.mode', 'historical'));
  await page.goto(origin);
  for (const [section, tab, selector] of [
    ['start'], ['knowledge', 'docs', '.kb-docs'], ['knowledge', 'coverage', 'table td'], ['replay'], ['maps'],
  ]) {
    await page.locator(`[data-tour="rail-${section}"]`).click();
    const region = page.locator(section === 'start' ? '.shell .stage' : `[data-tour="section-${section}"]`);
    if (tab) {
      await region.locator(`[data-tour="knowledge-tab-${tab}"]`).click();
      await region.locator(selector).first().waitFor();
    }
    await region.getByText(/\S/).first().waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    const report = await region.evaluate(root => {
      function luminance(color) {
        const [r, g, b] = color.match(/[\d.]+/g).map(Number).slice(0, 3).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      let checked = 0;
      const defects = [];
      for (const element of root.querySelectorAll('h1,h2,h3,p,label,caption,th,td,dt,dd,legend')) {
        if (!element.getClientRects().length || !element.textContent.trim()) continue;
        let ancestor = element;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          if (style.backgroundImage !== 'none') { ancestor = null; break; }
          if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') break;
          ancestor = ancestor.parentElement;
        }
        if (!ancestor) continue;
        const surface = getComputedStyle(ancestor).backgroundColor;
        if (luminance(surface) < 0.65) continue;
        checked++;
        const color = getComputedStyle(element).color;
        if (luminance(color) > 0.55) defects.push({ text: element.textContent.trim().slice(0, 60), color, surface });
      }
      return { checked, defects };
    });
    assert(report.checked > 0, `Раздел ${section}: нет проверенных надписей`);
    assert.deepEqual(report.defects, [], section);
    console.log(`${tab ?? section}: проверено надписей — ${report.checked}`);
  }
} finally { await browser.close(); }
