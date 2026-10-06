import { describe, it, expect } from 'vitest';
import { LIBRARY, CATEGORIES, PRESETS, STYLES, emptyDocument, makeProjection, createFeature, renderDocument, variantFor, searchLibrary, GLYPHS, SYMBOL_PRESETS, SOURCES, sourceText } from '@def-ops/core';

describe('библиотека знаков', () => {
  it('у всех элементов есть категория, описание и существующие пресеты', () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    const ids = new Set<string>();
    for (const e of LIBRARY) {
      expect(cats.has(e.category), e.id).toBe(true);
      expect(e.description.length, e.id).toBeGreaterThan(10);
      expect(ids.has(e.id), `дубль ${e.id}`).toBe(false);
      ids.add(e.id);
      const table = PRESETS[e.kind] as Record<string, unknown>;
      for (const [, p] of Object.entries(e.variants)) expect(table[p!], `${e.id} → ${p}`).toBeTruthy();
    }
    expect(LIBRARY.length).toBeGreaterThan(120);
    // каждая категория не пуста
    for (const c of CATEGORIES) expect(LIBRARY.some((e) => e.category === c.id), c.id).toBe(true);
  });

  it('все пресеты попали в библиотеку', () => {
    const used = new Set(LIBRARY.flatMap((e) => Object.values(e.variants)));
    const all = Object.values(PRESETS).flatMap((t) => Object.keys(t));
    const missing = all.filter((id) => !used.has(id));
    expect(missing).toEqual([]);
  });

  it('все глифы точечных знаков существуют', () => {
    const builtin = new Set(['settlement', 'town', 'tankArmy', 'cavalryCorps', 'armyOval', 'reserve', 'fortifiedCity', 'aviation', 'victoryFlag', 'pennant', 'dateBox', 'meeting']);
    for (const [id, p] of Object.entries(SYMBOL_PRESETS)) {
      const t = p.style().type;
      expect(builtin.has(t) || !!GLYPHS[t], `${id}: ${t}`).toBe(true);
    }
  });

  it('каждый вариант рендерится для своих и противника', () => {
    const doc = emptyDocument([14, 52.5], 8);
    const pr = makeProjection(doc.origin, doc.refZoom);
    const ll = (x: number, y: number) => pr.toLngLat([x, y]);
    for (const e of LIBRARY) {
      for (const style of STYLES) {
        const v = variantFor(e, style.id);
        for (const side of e.sideAware ? (['own', 'enemy'] as const) : [undefined]) {
          const geom = e.kind === 'symbol' || e.kind === 'label' ? { at: ll(0, 0), text: 'Т' }
            : e.kind === 'area' ? { points: [ll(0, 0), ll(80, 0), ll(80, 50), ll(0, 50)] } : { points: [ll(0, 0), ll(100, -20), ll(200, 0)] };
          doc.features.push(createFeature(e.kind, v.preset, geom, 1, side));
        }
      }
    }
    const r = renderDocument(doc);
    expect(r.features.length).toBe(doc.features.length);
    for (const f of r.features) expect(f.svg.length, f.id).toBeGreaterThan(20);
  });

  it('противник рисуется синим, свои — красным', () => {
    const own = createFeature('symbol', 'sa.tank', { at: [14, 52] }, 1, 'own');
    const enemy = createFeature('symbol', 'sa.tank', { at: [14, 52] }, 1, 'enemy');
    expect(own.kind === 'symbol' && own.style.color).toBe('#d43834');
    expect(enemy.kind === 'symbol' && enemy.style.color).toBe('#2f6fae');
  });

  it('поиск по синонимам', () => {
    expect(searchLibrary('катюша').map((e) => e.id)).toContain('rocket');
    expect(searchLibrary('котёл').map((e) => e.id)).toContain('area.encircled');
    expect(searchLibrary('ПТУР').map((e) => e.id)).toContain('atgm');
  });
});

describe('первоисточники', () => {
  it('ссылки указывают на известные источники; без источника — только с пометкой «сверить» или неуставные стили', () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const e of LIBRARY) {
      for (const r of e.sources ?? []) expect(ids.has(r.split(':')[0]), `${e.id}: ${r}`).toBe(true);
      const ustav = Object.values(e.variants).some((p) => /^(rkka|sa)\./.test(p!));
      if (ustav && !e.verify) expect(e.sources?.length, e.id).toBeGreaterThan(0);
    }
    expect(sourceText(['tm:XII-7', 'ouo:6'])).toBe('TM 30-430, с. XII-7; ОУО, л. 6');
  });

  it('по TM 30-430: ПП мины — светлые кружки, ПТ — залитые точки', () => {
    const ap = createFeature('area', 'rkka.minefieldAP', { points: [[14, 52], [14.1, 52], [14.1, 52.1]] });
    const at = createFeature('area', 'rkka.minefieldAT', { points: [[14, 52], [14.1, 52], [14.1, 52.1]] });
    expect(ap.kind === 'area' && ap.style.hatch?.pattern).toBe('circles');
    expect(at.kind === 'area' && at.style.hatch?.pattern).toBe('dots');
  });

  it('СА: артиллерия своих — чёрным, мотострелки — красным', () => {
    const gun = createFeature('symbol', 'sa.gun', { at: [14, 52] }, 1, 'own');
    const bmp = createFeature('symbol', 'sa.bmp', { at: [14, 52] }, 1, 'own');
    const gunE = createFeature('symbol', 'sa.gun', { at: [14, 52] }, 1, 'enemy');
    expect(gun.kind === 'symbol' && gun.style.color).toBe('#1f1f1f');
    expect(bmp.kind === 'symbol' && bmp.style.color).toBe('#d43834');
    expect(gunE.kind === 'symbol' && gunE.style.color).toBe('#2f6fae');
  });
});

describe('корректность SVG', () => {
  it('у знаков нет битых атрибутов', () => {
    const doc = emptyDocument([14, 52.5], 8);
    for (const id of Object.keys(SYMBOL_PRESETS)) doc.features.push(createFeature('symbol', id, { at: [14, 52.5] }));
    const svg = renderDocument(doc).features.map((f) => f.svg).join('');
    expect(svg).not.toMatch(/=""[a-z]/);
    expect(svg).toMatch(/transform="translate\(/);
  });
});
