import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import { cameraAt } from '../../../packages/kshvi/src/exposition/camera-route';
import { startArchiveShow } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { createProjectorProfile, projectExpositionForAudience } from '../../../services/kshvi/src/exposition/exposition-projection';
import { createExpositionMapStyle } from '../src/modern/kshvi/exposition/map-style';

describe('настоящая карта экспозиции', () => {
  it('строит географические источники местности, МТО, маршрутов и знаков и применяет всю позицию камеры', () => {
    const source = officialArchive();
    const map: Record<string, unknown> = { ...source.map };
    const archive = { ...source, map };
    map.terrain = {
      summary: 'Лесной массив',
      geojson: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Лесной массив', kind: 'forest' }, geometry: {
          type: 'Polygon', coordinates: [[[30, 50], [30.4, 50], [30.4, 50.3], [30, 50.3], [30, 50]]],
        } }],
      },
    };
    map.logistics = {
      summary: 'Склад и подвоз',
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Склад' }, geometry: { type: 'Point', coordinates: [30.1, 50.1] } }] },
    };
    map.routes = {
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Маршрут' }, geometry: { type: 'LineString', coordinates: [[30.1, 50.1], [30.2, 50.2]] } }] },
    };
    map.modernSymbols = [{ id: 'unit-1', label: 'Батальон', side: 'BLUE', position: [30.2, 50.2] }];
    const program = { ...expositionProgram(), layers: [...expositionProgram().layers, 'routes'] as const };
    const session = startArchiveShow({ sourceArchive: archive, program, sessionId: 'map-show', branchId: 'map-branch' });
    const projection = projectExpositionForAudience({
      session,
      policy: createAudiencePolicy({ id: 'map-policy', allowedLayers: ['terrain', 'logistics', 'routes', 'modern-symbols'], showPlanFact: false, showExplanations: false, publicCaptionIds: [], publicDecisionIds: [] }),
      projector: createProjectorProfile({ id: 'map-projector', allowedLayers: ['terrain', 'logistics', 'routes', 'modern-symbols'] }),
    });
    const style = createExpositionMapStyle(projection.map, projection.program.layers);
    const serialized = JSON.stringify(style);
    expect(serialized).toContain('Лесной массив');
    expect(serialized).toContain('Склад');
    expect(serialized).toContain('Маршрут');
    expect(serialized).toContain('Батальон');
    expect(style.sources['exposition-terrain']).toMatchObject({ type: 'geojson' });
    expect(style.sources['exposition-routes']).toMatchObject({ type: 'geojson' });
    expect(style.layers.some(layer => layer.id === 'exposition-terrain-fill')).toBe(true);

    const camera = cameraAt(program.cameraRoute, 2_000);
    expect(camera).toEqual({ atMs: 2_000, center: [32, 52], zoom: 8, heading: 90 });
    const reduced = createExpositionMapStyle(projection.map, ['terrain']);
    expect(JSON.stringify(reduced.sources)).not.toContain('exposition-routes');
    expect(JSON.stringify(reduced.sources)).not.toContain('Батальон');
  });
});

describe('изоляция browser entry и CSS', () => {
  it('не содержит официальный архив, секреты, локальную проекцию и Node-зависимости', () => {
    const source = readFileSync(resolve('apps/editor/src/modern/kshvi/exposition/browser-entry.tsx'), 'utf8');
    for (const forbidden of ['browserArchive', 'browserProjection', 'serviceIntent', 'hiddenRationale', 'officialAssessments', 'startArchiveShow(', 'startAutonomousShow(', 'node:']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('ExpositionClient');
    const projector = readFileSync(resolve('apps/editor/src/modern/kshvi/exposition/AudienceProjector.tsx'), 'utf8');
    expect(projector).not.toContain('<svg');
    expect(projector).toContain('ExpositionMap');
  });

  it('не переопределяет :root, body, глобальные controls или непрефиксные классы', () => {
    const css = readFileSync(resolve('apps/editor/src/modern/kshvi/exposition/exposition.css'), 'utf8');
    expect(css).not.toMatch(/:root|\bbody\s*[,{]|(^|\n)\s*\*\s*\{/);
    expect(css).not.toMatch(/(^|\n)\s*(button|input|textarea|select|label|fieldset|h1|h2|h3|p)(\s|,|:|\{)/);
    expect(css).not.toMatch(/(^|\n)\s*\.is-projector-preview/);
    expect(css).toContain('.exposition-browser-shell');
  });
});
