import { expect, it } from 'vitest';
import { operationalAt } from '../src/runtime/clock';

it('не зависит от часов клиента и не двигает мир на паузе', () => {
  const anchor = { anchorOperational: '2030-01-01T00:00:00Z', anchorWall: '2030-01-01T00:00:00Z', speed: 4, paused: true };
  expect(operationalAt(anchor, '2030-01-01T01:00:00Z')).toBe('2030-01-01T00:00:00.000Z');
  expect(operationalAt({ ...anchor, paused: false }, '2030-01-01T01:00:00Z')).toBe('2030-01-01T04:00:00.000Z');
});

it('сохраняет время последней паузы и возобновляет без скачка', () => {
  const anchor = { anchorOperational: '2030-01-01T02:00:00Z', anchorWall: '2030-01-01T01:00:00Z', speed: 2, paused: false };
  expect(operationalAt(anchor, '2030-01-01T01:30:00Z')).toBe('2030-01-01T03:00:00.000Z');
});
