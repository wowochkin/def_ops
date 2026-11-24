import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { DeletionService, type DeletionPorts } from '../src/admin/deletion-service';
import { SecurityAudit } from '../src/auth/security-audit';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('реально блокирует, планирует и удаляет с повторной retention-проверкой и durable восстановлением', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-deletion-'));
  roots.push(root);
  const stateFile = join(root, 'deletion.jsonl');
  let now = new Date('2026-11-22T08:00:00.000Z');
  let retained = false;
  const calls: string[] = [];
  const ports: DeletionPorts = {
    lockExercise: async (exerciseId, organizationId, requestId) => { calls.push(`lock:${exerciseId}:${organizationId}:${requestId}`); },
    scheduleDeletion: async request => { calls.push(`schedule:${request.jobId}:${request.executeAfter}`); },
    hasRetentionHold: async () => { calls.push('retention'); return retained; },
    deleteExercise: async (exerciseId, organizationId, requestId) => { calls.push(`delete:${exerciseId}:${organizationId}:${requestId}`); },
  };
  const audit = new SecurityAudit({ now: () => now });
  const service = new DeletionService({ now: () => now, audit, ports, stateFile });
  const request = await service.request(
    { userId: 'security-1', organizationId: 'org-1', domainPermissions: ['exercise.delete'] },
    { exerciseId: 'exercise-1', organizationId: 'org-1' },
  );
  expect(calls[0]).toBe('retention');
  expect(calls[1]).toBe(`lock:exercise-1:org-1:${request.id}`);
  const scheduled = await service.confirm({ userId: 'security-2', organizationId: 'org-1', domainPermissions: ['deletion.confirm'] }, request.id);
  expect(calls[2]).toBe(`schedule:${scheduled.jobId}:${scheduled.executeAfter}`);

  const restarted = new DeletionService({ now: () => now, audit, ports, stateFile });
  retained = true;
  now = new Date(scheduled.executeAfter);
  await expect(restarted.execute(request.id)).rejects.toThrow(/удержан/);
  expect(calls.some(call => call.startsWith('delete:'))).toBe(false);
  retained = false;
  expect((await restarted.executeDue()).map(request => request.status)).toEqual(['EXECUTED']);
  expect(calls.at(-1)).toBe(`delete:exercise-1:org-1:${request.id}`);
  expect(audit.entries().map(event => event.action)).toEqual(expect.arrayContaining(['deletion.requested', 'deletion.confirmed', 'deletion.executed']));
});
