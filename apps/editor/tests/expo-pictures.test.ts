import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { PICTURES } from '../src/expo/pictures';

const DIR = join(__dirname, '../src/expo/pictures');

it('every picture of the stand has a public-domain source or is marked generated; files exist and are compressed', () => {
  const files = readdirSync(DIR).filter((f) => /\.(jpe?g|webp|png)$/.test(f));
  expect(new Set(files)).toEqual(new Set(PICTURES.map((p) => p.file)));
  for (const p of PICTURES) {
    expect(existsSync(join(DIR, p.file))).toBe(true);
    expect(statSync(join(DIR, p.file)).size).toBeLessThanOrEqual(310_000);
    expect(p.caption).toBeTruthy();
    if (p.generated) expect(p.kind).toBe('generated');
    else {
      expect(p.author && p.url && p.pd).toBeTruthy();
      expect(p.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(p.pd).toMatch(/^PD-/);
    }
  }
});
