// Регрессия длинного комментария рядом с подтверждением: настоящий ExpoView, 1440×900.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { expoPage, EXPO_CFG } from './expo-mock.mjs';
const browser = await chromium.launch();
const core = agentsProcess();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, timer: {on: false, seconds: 30} } });
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const comment = 'Посетитель выбрал удар во фланг 9-й армии. Модель показывает последствия принятого решения: изменение положения соединений, расход ресурсов и продвижение к поставленным целям. Итог следует оценивать с учётом ограничений снабжения и состояния войск. ';
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', {name: 'Коснитесь, чтобы принять командование'}).waitFor({timeout:120000});
  await page.waitForTimeout(1800);
  await page.getByRole('button', {name: 'Коснитесь, чтобы принять командование'}).click();
  await page.getByRole('button', {name: /1-й Украинский/}).click();
  await page.getByRole('button', {name: 'Начать операцию'}).click();
  await page.getByRole('button', {name: 'К решениям'}).click();
  await page.locator('.expo-card-main strong').first().filter({hasNotText: 'Карточка готовится'}).waitFor({timeout:90000});
  await page.locator('.expo-card-main').first().click();
  await page.getByRole('group', {name:'Подтверждение выбора'}).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.expo-gis [data-id]').first().waitFor({state:'attached',timeout:90000});
  await page.waitForTimeout(900);
  for (const repeat of [1, 5]) {
    await page.locator('.expo-subs-text').evaluate((el, text) => el.textContent = text, comment.repeat(repeat));
    await page.waitForTimeout(300);
    const boxes = await page.evaluate(() => {
      const rect = el => {const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const footer=document.querySelector('.expo-footer'), subs=document.querySelector('.expo-subs'), confirm=document.querySelector('.expo-confirm');
      return {footer:rect(footer), subs:rect(subs), confirm:rect(confirm), stage:rect(document.querySelector('.expo')), question:rect(confirm.querySelector('p')), buttons:[...footer.querySelectorAll('button')].map(rect)};
    });
    await page.screenshot({path: repeat===1 ? 'docs/img/expo-confirm-comment.jpg' : '/tmp/expo-long-comment.jpg',type:'jpeg',quality:90});
    assert.ok(boxes.subs.bottom <= boxes.confirm.y + 1, 'Комментарий должен быть отдельной строкой над подтверждением');
    assert.ok(boxes.question.width > 500, 'Вопрос подтверждения не должен сжиматься в узкую колонку');
    assert.ok(boxes.footer.bottom <= boxes.stage.bottom, 'Подвал внутри холста');
    for(const b of boxes.buttons) assert.ok(b.right<=boxes.stage.right && b.bottom<=boxes.stage.bottom,'Все кнопки внутри холста');
    assert.ok(boxes.subs.height <= 100, 'Длинный комментарий не увеличивает высоту подвала');
    console.log(`ok комментарий ${repeat}×: подтверждение и кнопки внутри холста`);
  }
} catch (e) { await page.screenshot({path:'/tmp/expo-comment-fail.jpg'}); throw e; } finally {await browser.close();core.stop();}
