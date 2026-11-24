import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';

const openapiUrl = new URL('../../../../packages/kshvi/schemas/openapi.json', import.meta.url);
const apiSchemaUrl = new URL('../../../../packages/kshvi/schemas/api.schema.json', import.meta.url);

it('публикует OpenAPI и JSON Schema для фактических серверных маршрутов и DTO', () => {
  expect(existsSync(openapiUrl)).toBe(true);
  expect(existsSync(apiSchemaUrl)).toBe(true);
  if (!existsSync(openapiUrl) || !existsSync(apiSchemaUrl)) return;
  const openapi = JSON.parse(readFileSync(openapiUrl, 'utf8')) as {
    openapi: string;
    paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    components: { schemas: Record<string, { $ref?: string; required?: string[]; properties?: Record<string, unknown> }> };
  };
  const schema = JSON.parse(readFileSync(apiSchemaUrl, 'utf8')) as { definitions: Record<string, { required?: string[]; properties?: Record<string, unknown> }> };
  const router = buildRouter({ sessions: new SessionManager({ store: new InMemorySessionStore() }) });
  expect(openapi.openapi).toBe('3.1.0');
  for (const [path, operations] of Object.entries(openapi.paths)) {
    const routePath = path.replaceAll('{id}', ':id').replaceAll('{sessionId}', ':sessionId').replaceAll('{archiveId}', ':archiveId').replaceAll('{accountId}', ':accountId');
    for (const [method, operation] of Object.entries(operations)) {
      expect(router.match(method.toUpperCase(), routePath), `${method.toUpperCase()} ${routePath}`).not.toBeNull();
      expect(operation.responses?.['200'] ?? operation.responses?.['201']).toBeDefined();
    }
  }
  expect(openapi.paths['/kshvi/exercises'].post.responses?.['201']).toBeDefined();
  expect(openapi.paths['/kshvi/exercises'].post.responses?.['200']).toBeUndefined();
  expect(JSON.stringify(openapi.paths['/kshvi/exercises'].post.responses?.['201'])).not.toContain('ExerciseSession');
  expect(openapi.paths['/kshvi/exercises/{id}/revisions'].post.responses?.['201']).toBeDefined();
  expect(openapi.paths['/kshvi/exercises/{id}/revisions'].post.responses?.['200']).toBeUndefined();
  expect(openapi.paths['/kshvi/exercises/{id}/sessions'].post.responses?.['201']).toBeDefined();
  expect(openapi.paths['/kshvi/exercises/{id}/sessions'].post.responses?.['200']).toBeUndefined();
  expect(JSON.stringify(openapi.paths['/kshvi/exercises/{id}/sessions'].post.responses?.['201'])).toContain('ExerciseSession');
  for (const [name, definition] of Object.entries(schema.definitions)) {
    expect(openapi.components.schemas[name], name).toBeDefined();
    expect(openapi.components.schemas[name].required).toEqual(definition.required);
    expect(Object.keys(openapi.components.schemas[name].properties ?? {})).toEqual(Object.keys(definition.properties ?? {}));
  }
  expect(schema.definitions.ExerciseSession.required).toEqual(expect.arrayContaining(['id', 'exerciseId', 'scenarioRevisionId', 'revision', 'state', 'mode', 'authority', 'confirmedRevision', 'createdBy', 'createdAt']));
  expect(schema.definitions.ExerciseSession.properties?.state).toEqual({ enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED', 'ARCHIVED'] });
  expect(schema.definitions.ReplayFrame.required).toEqual(expect.arrayContaining(['sequence', 'operationalAt', 'wallClockAt', 'perspective', 'stateHash', 'domains', 'events']));
  expect(schema.definitions.ArchiveRecord.required).toEqual(expect.arrayContaining(['archiveId', 'manifestSha256', 'mode', 'missing']));
});
