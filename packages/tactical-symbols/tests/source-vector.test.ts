import { expect, it } from 'vitest';
import { registerSourceVectorData, registerSourceVectorPage, renderSourceVector, sourceVectorPage } from '../src/source-vector';
import { renderSymbol } from '../src/render-svg';
import type { RenderSymbolInput } from '../src/model';

it('использует общий SVG страницы с разными точными охватами без внешних ресурсов', () => {
  registerSourceVectorPage('test-page', '<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="glyph"><path d="M0 0L1 1"/></g></defs><use xlink:href="#glyph"/></svg>');
  const first = renderSourceVector('test-page', '80 100 160 120', { width: 320, height: 240, label: 'Знак 75' });
  const second = renderSourceVector('test-page', '80 200 160 120', { width: 320, height: 240, label: 'Знак 76' });
  expect(first).toContain('viewBox="80 100 160 120"');
  expect(second).toContain('viewBox="80 200 160 120"');
  expect(first).toContain('<defs>');
  expect(first).toContain('aria-label="Знак 75"');
  expect(first).not.toContain('https://');
  expect(sourceVectorPage('test-page')).toContain('<defs>');
});

it('не принимает внешний ресурс и не скрывает отсутствующую страницу', () => {
  expect(() => registerSourceVectorPage('bad', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>')).toThrow('внеш');
  expect(() => sourceVectorPage('missing')).toThrow('не найдена');
  expect(() => renderSourceVector('test-page', '0 0 0 100', { width: 100, height: 100 })).toThrow('viewBox');
});


it('общий рендер библиотеки использует исходную векторную геометрию без параметрической подмены', () => {
  const symbol = {
    id: 'source-75', name: 'Танк', frame: 'NONE', anchor: [0.5, 0.5], modifiers: [], labels: {},
    geometry: { version: 1, template: 'SOURCE_VECTOR', parameters: { pageId: 'test-page', viewBox: '80 100 160 120' } },
  } as unknown as RenderSymbolInput;
  const svg = renderSymbol(symbol, { width: 320, height: 240 });
  expect(svg).toContain('data-source-page="test-page"');
  expect(svg).toContain('data-symbol-id="source-75"');
  expect(svg).toContain('viewBox="80 100 160 120"');
});


it('собирает образец только из выбранных элементов общей векторной страницы', () => {
  registerSourceVectorData('structured-page', {
    defs: '<g id="shape"><path d="M0 0L1 1"/></g>',
    elements: [
      { html: '<use id="heading" xlink:href="#shape"/>', x: 150, y: 60, width: 30, height: 10 },
      { html: '<use id="tank" xlink:href="#shape"/>', x: 150, y: 90, width: 30, height: 20 },
    ],
  });
  const svg = renderSourceVector('structured-page', '145 85 40 30', { width: 200, height: 150, elements: '1' });
  expect(svg).toContain('id="tank"');
  expect(svg).not.toContain('id="heading"');
  expect(svg).toContain('<defs><g id="shape">');
});


it('накладывает пользовательскую подпись отдельно от неизменного исходного контура', () => {
  const symbol = {
    id: 'source-75', name: 'Танк', frame: 'NONE', anchor: [0.5, 0.5], modifiers: [], labels: { top: 'Р-17' },
    geometry: { version: 1, template: 'SOURCE_VECTOR', parameters: { pageId: 'test-page', viewBox: '80 100 160 120' } },
  } as unknown as RenderSymbolInput;
  const svg = renderSymbol(symbol, { width: 320, height: 240 });
  expect(svg).toContain('data-label="top"');
  expect(svg).toContain('>Р-17</text>');
  expect(svg).toContain('data-source-page="test-page"');
});
