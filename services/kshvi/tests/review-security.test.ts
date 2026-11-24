import { expect, it } from 'vitest';
import { createService, Router } from '@def-ops/service-kit';
import { registerProjectionRoutes } from '../src/http/projection-routes';
import { ProjectionService } from '../src/instances/projection-service';
import { projectWorld } from '../../../packages/kshvi/src/projections/project';

const world = {
  forces: [{ id: 'blue-force', side: 'blue' }, { id: 'red-secret', side: 'red' }],
  observations: [
    { id: 'own-observation', side: 'blue', observedSide: 'red', summary: 'разрешённое наблюдение' },
    { id: 'red-observation', side: 'red', summary: 'чужая служебная запись' },
    { id: 'addressed', recipients: ['blue-user'], summary: 'личное сообщение' },
    { id: 'future', side: 'blue', availableAt: '2030-01-02T00:00:00Z', summary: 'будущее наблюдение' },
  ],
};

it('C1: observations фильтруются по владельцу, получателю и оперативному времени', () => {
  const projection = projectWorld(world, {
    side: 'blue', role: 'TRAINEE', scope: 'own', operationalAt: '2030-01-01T00:00:00Z', nodeId: 'blue-user',
  });
  expect(projection.observations.map(item => item.id)).toEqual(['own-observation', 'addressed']);
  expect(JSON.stringify(projection)).not.toContain('red-secret');
});

it('C1: HTTP игнорирует подменённые side/role/scope/authority и проверяет Instance', async () => {
  const router = new Router();
  registerProjectionRoutes(router, new ProjectionService(), world, async (_ctx, instanceId) => ({
    organizationId: 'org-1', instanceIds: instanceId === 'allowed' ? ['allowed'] : ['allowed'],
    side: 'blue', role: 'LEADER', scope: 'own', authorities: [], demonstration: false,
  }));
  const service = createService({ name: 'projection-security', port: 0, router });
  const port = await service.listen();
  try {
    const allowed = await fetch(`http://127.0.0.1:${port}/kshvi/instances/allowed/projection?operationalAt=2030-01-01T00:00:00Z&side=red&role=LEADER&scope=truth&authority=TRUTH_READ`, {
      headers: { authorization: 'Bearer server-session' },
    });
    expect(allowed.status).toBe(200);
    const projection = await allowed.json() as { forces: Array<{ id: string }>; observations: Array<{ id: string }>; perspective: string };
    expect(projection.perspective).toBe('PARTICIPANT');
    expect(projection.forces.map(item => item.id)).toEqual(['blue-force']);
    expect(projection.observations.map(item => item.id)).toEqual(['own-observation']);
    const forbidden = await fetch(`http://127.0.0.1:${port}/kshvi/instances/forbidden/projection?operationalAt=2030-01-01T00:00:00Z&side=blue&role=LEADER&scope=truth&authority=TRUTH_READ`, {
      headers: { authorization: 'Bearer server-session' },
    });
    expect(forbidden.status).toBe(403);
  } finally {
    await service.close();
  }
});

it('C1: маршрут без серверного resolver не допускает анонимную проекцию', async () => {
  const router = new Router();
  registerProjectionRoutes(router, new ProjectionService(), world);
  const service = createService({ name: 'projection-anonymous', port: 0, router });
  const port = await service.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/instances/i1/projection?operationalAt=2030-01-01T00:00:00Z&side=blue&role=LEADER&scope=truth&authority=TRUTH_READ`);
    expect(response.status).toBe(401);
  } finally {
    await service.close();
  }
});
