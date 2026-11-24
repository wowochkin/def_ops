import { expect, it } from 'vitest';
import { projectWorld } from '../../../packages/kshvi/src/projections/project';
import { ProjectionService } from '../src/instances/projection-service';

const world = {
  forces: [{ id: 'own', side: 'blue', position: [1, 1] }, { id: 'secret-force', side: 'red', position: [2, 2] }],
  observations: [{ id: 'observation-1', side: 'blue', observedSide: 'red', reportedGeometry: [2, 2] }],
  inputs: [{ id: 'future', availableAt: '2030-01-02T00:00:00Z', recipients: ['blue'] }, { id: 'current', availableAt: '2030-01-01T00:00:00Z', recipients: ['blue'] }],
  reference: { secret: true },
};

it('не возвращает истинный объект противника и будущую вводную', () => {
  const projection = projectWorld(world, { side: 'blue', role: 'TRAINEE', operationalAt: '2030-01-01T00:00:00Z', scope: 'own' });
  expect(JSON.stringify(projection)).not.toContain('secret-force');
  expect(JSON.stringify(projection)).not.toContain('future');
  expect(JSON.stringify(projection)).toContain('observation-1');
  expect(JSON.stringify(projection)).toContain('current');
  expect(JSON.stringify(projection)).not.toContain('reference');
});

it('разрешает истину только отдельному праву и не раскрывает её администратору по должности', () => {
  expect(() => projectWorld(world, { side: 'blue', role: 'TECH_ADMIN', operationalAt: '2030-01-01T00:00:00Z', scope: 'own' })).toThrow('403');
  const projection = projectWorld(world, { side: 'blue', role: 'LEADER', operationalAt: '2030-01-01T00:00:00Z', scope: 'truth', authorities: ['TRUTH_READ'] });
  expect(projection.forces).toHaveLength(2);
});

it('не допускает совмещение обучаемого и руководства без демонстрационной метки', () => {
  expect(() => new ProjectionService().project(world, { side: 'blue', role: 'TRAINEE_LEADER', operationalAt: '2030-01-01T00:00:00Z', scope: 'own' })).toThrow('403');
  expect(() => new ProjectionService().project(world, { side: 'blue', role: 'TRAINEE_LEADER', operationalAt: '2030-01-01T00:00:00Z', scope: 'own', demonstration: true })).not.toThrow();
});
