import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('фиксирует отсутствие поддерживаемого CPU-троттлинга без заявления NF-04', () => {
  const protocol = JSON.parse(readFileSync(resolve('docs/release/kshvi/cpu-control.json'), 'utf8')) as {
    status: string;
    nf04Confirmed: boolean;
    measurement: string;
    reason: string;
  };
  expect(protocol.status).toBe('BLOCKED');
  expect(protocol.nf04Confirmed).toBe(false);
  expect(protocol.measurement).toBe('process.cpuUsage');
  expect(protocol.reason).toContain('CPU');
});
