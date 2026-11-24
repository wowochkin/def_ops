// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ObservationCard } from '../src/modern/kshvi/conduct/ObservationCard';

afterEach(cleanup);

it('карточка наблюдения показывает источник, время, неопределённость и устаревание без скрытых полей', () => {
  const { container } = render(<ObservationCard observation={{
    id: 'observation-1', source: { id: 'sensor-1', kind: 'UAV', sideId: 'blue', profileVersion: 'uav-v1' },
    observedAt: '2030-01-01T00:00:00Z', deliveredAt: '2030-01-01T00:01:00Z', validUntil: '2030-01-01T00:10:00Z',
    reportedGeometry: { lon: 37.6, lat: 55.7 }, reportedAttributes: { type: 'motorized' },
    reportedAccuracyMeters: 150, completeness: 0.75, reliability: 0.8, status: 'STALE', staleSince: '2030-01-01T00:11:00Z',
  }} />);
  expect(screen.getByRole('heading', { name: 'Наблюдение observation-1' })).toBeTruthy();
  expect(screen.getByText('UAV · sensor-1')).toBeTruthy();
  expect(screen.getByText('±150 м')).toBeTruthy();
  expect(screen.getByText('Полнота: 75 %; достоверность: 80 %')).toBeTruthy();
  expect(screen.getByText('Устарело')).toBeTruthy();
  expect(container.textContent).not.toContain('trueForceId');
  expect(container.textContent).not.toContain('actualErrorMeters');
});
