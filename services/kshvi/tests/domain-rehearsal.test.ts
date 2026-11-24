import { REHEARSAL_CHECKS } from '@def-ops/kshvi';
import { expect, it } from 'vitest';
import { executeDomainRehearsal } from '../src/store/domain-rehearsal';
import { rehearsalProfile } from './helpers/rehearsal-profile';

it('выполняет и журналирует все 14 доменных действий репетиции', async () => {
  const result = await executeDomainRehearsal(rehearsalProfile(), 'rehearsal-test-log');
  expect(result.events.map(event => event.check)).toEqual(REHEARSAL_CHECKS);
  expect(result.events.every(event => event.sha256.match(/^[0-9a-f]{64}$/))).toBe(true);
  expect(result.checks).toEqual(Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])));
});
