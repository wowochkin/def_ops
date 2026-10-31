/**
 * Подготовка содержания выставочного режима (на машине разработки).
 *
 *   npm run expo:prepare                 — проверка банка карточек и заготовок фраз (форма, длина, стоп-слова)
 *   npm run expo:prepare -- --generate   — дополнить каждый перелом карточками языковой модели (LM Studio, :1234)
 *                                          до --per (по умолчанию 10) своих; кандидат проходит автопроверку формы
 *                                          и текста, отобранное записывается в банк
 *   npm run expo:prepare -- --voice      — заготовить звук всех фраз голосовым сервисом (проверка, что синтез идёт)
 *
 * Ручного отбора нет: что не прошло проверку — отбрасывается.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANK, bankErrors, cardErrors, turnCards, type Bank, type Card } from '../apps/editor/src/expo/bank';
import { cardPrompt, parseCard, type CardContext } from '../apps/editor/src/expo/ai';
import { allLines, textErrors } from '../apps/editor/src/expo/lines';
import type { FrontId } from '../apps/editor/src/expo/settings';

const ROOT = join(import.meta.dirname, '..');
const BANK_PATH = join(ROOT, 'apps/editor/src/expo/bank-data/berlin-1945.cards.json');
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string, d: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);

const scenario = JSON.parse(readFileSync(join(ROOT, BANK.scenario), 'utf8')) as { hqs: { id: string; parent: string | null; echelon: string }[] };
const theatre = JSON.parse(readFileSync(join(ROOT, 'packages/sim/data/theatres/oder-berlin-1945.json'), 'utf8')) as { areas: { id: string }[] };
const armiesOf = (front: string) => scenario.hqs.filter((h) => h.parent === front && h.echelon === 'army').map((h) => h.id);
const places = new Set(theatre.areas.map((a) => a.id));

function check(bank: Bank): string[] {
  const errs = bankErrors(bank, armiesOf, places);
  for (const c of bank.cards) for (const t of [c.title, ...c.lines]) errs.push(...textErrors(t).map((e) => `${c.id}: ${e}`));
  for (const t of allLines()) errs.push(...textErrors(t));
  return errs;
}

async function ask(system: string, text: string): Promise<string> {
  const url = opt('--llm', 'http://127.0.0.1:1234/v1');
  const r = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: text }], temperature: 0.8, max_tokens: 600, reasoning_effort: 'none' }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`модель: ${r.status}`);
  const j = (await r.json()) as { choices: { message: { content: string } }[] };
  return j.choices[0]?.message?.content ?? '';
}

async function generate(bank: Bank) {
  const per = Number(opt('--per', '10'));
  const system = 'Ты — офицер оперативного отдела штаба фронта, апрель 1945 года. Пишешь варианты решения для выставочного стенда. Только JSON.';
  let added = 0;
  for (const [front, f] of Object.entries(bank.fronts) as [FrontId, Bank['fronts'][FrontId]][]) {
    const armies = armiesOf(front);
    const own = bank.cards.filter((c) => c.front === front);
    const ownPlaces = [...new Set(own.flatMap((c) => c.orders.map((o) => o.place)).filter((p): p is string => !!p))];
    for (const t of f.turns) {
      for (let tries = 0; turnCards(bank, front, t.n).filter((c) => !c.historical).length < per && tries < per * 3; tries++) {
        const ctx: CardContext = {
          front, frontName: f.name, marshal: f.marshal, n: t.n, turnTitle: t.title, situation: t.situation,
          armies, places: ownPlaces, shownTitles: turnCards(bank, front, t.n).map((c) => c.title),
        };
        const id = `${front === 'su_1bf' ? 'bf' : 'uf'}${t.n}-ai${tries + 1}-${Date.now().toString(36)}`;
        let card: Card | null = null;
        try {
          card = parseCard(await ask(system, cardPrompt(ctx)), ctx, id, (c) => cardErrors(c, new Set(armies), places));
        } catch (e) {
          console.error(`  ${front} ${t.n}: ${(e as Error).message}`);
          return added;
        }
        if (!card) continue;
        // разные исходы: не повторять набор распоряжений уже отобранной карточки
        const sig = (c: Card) => c.orders.map((o) => `${o.army}:${o.kind}:${o.place}`).sort().join('|');
        if (turnCards(bank, front, t.n).some((c) => sig(c) === sig(card!))) continue;
        bank.cards.push({ ...card, prepared: 'ai', basis: { assumption: 'Составлено языковой моделью при подготовке, отобрано автопроверкой' } });
        added++;
      }
    }
  }
  return added;
}

async function voice() {
  const r = await fetch('http://127.0.0.1:47645/api/voice', { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!r?.ok) {
    console.log('Голосовой сервис не отвечает (:47645) — озвучка пропущена; на стенде фразы скажет синтез при показе.');
    return;
  }
  console.log(`Голосовой сервис: ${JSON.stringify(await r.json()).slice(0, 80)}; фраз к заготовке: ${allLines().length}`);
}

const bank = structuredClone(BANK);
if (flag('--generate')) {
  const n = await generate(bank);
  const errs = check(bank);
  if (errs.length) {
    console.error(`Банк после генерации не прошёл проверку (${errs.length}), не записан:\n${errs.slice(0, 10).join('\n')}`);
    process.exit(1);
  }
  if (n) writeFileSync(BANK_PATH, `${JSON.stringify(bank, null, 2)}\n`);
  console.log(`Добавлено карточек модели: ${n}`);
}
if (flag('--voice')) await voice();
const errs = check(bank);
const cards = bank.cards.length;
console.log(`Банк: ${cards} карточек, заготовок фраз: ${allLines().length}; ошибок: ${errs.length}`);
for (const e of errs.slice(0, 20)) console.log(`  ${e}`);
process.exit(errs.length ? 1 : 0);
