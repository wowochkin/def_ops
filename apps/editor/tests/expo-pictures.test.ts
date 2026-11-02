import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { cardCaption, pictureByFile, PICTURES } from '../src/expo/pictures';

const DIR = join(__dirname, '../src/expo/pictures');

it('every picture of the stand has a public-domain source or is marked generated; files exist and are compressed', () => {
  const files = readdirSync(DIR).filter((f) => /\.(jpe?g|webp|png)$/.test(f));
  expect(new Set(files)).toEqual(new Set(PICTURES.map((p) => p.file)));
  for (const p of PICTURES) {
    expect(existsSync(join(DIR, p.file))).toBe(true);
    expect(statSync(join(DIR, p.file)).size).toBeLessThanOrEqual(310_000);
    expect(p.caption).toBeTruthy();
    if (p.generated) expect(p.kind).toBe('generated');
    else if (p.supplied) expect(p.note).toMatch(/автор/);
    else {
      expect(p.author && p.url && p.pd).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(p.pd).toMatch(/^PD-/);
    }
  }
});

it('снимок берётся только по имени файла', () => {
  expect(pictureByFile('elbe-day-1945.jpg')?.caption).toMatch(/25 апреля 1945/);
  expect(pictureByFile('нет-такого.jpg')).toBeNull();
});

it('на карточке варианта нет автора и даты, в хронике подпись целая', () => {
  expect(cardCaption('Встреча на Эльбе: советские и американские солдаты, 25 апреля 1945')).toBe('Встреча на Эльбе: советские и американские солдаты');
  expect(cardCaption('Берлин, 5 июня 1945: маршал Жуков с командующими союзников')).toBe('Берлин: маршал Жуков с командующими союзников');
  expect(cardCaption('Выход к Берлину, 20 апреля: артиллерия на позициях')).toBe('Выход к Берлину: артиллерия на позициях');
  expect(cardCaption('Ночной штурм: прожектор')).toBe('Ночной штурм: прожектор');
});
