import { expect, it } from 'vitest';
import { initialMapAudiences } from '../src/modern/kshvi/preparation/initial-map-audiences';

it('AC-22: формирует проекции из фактической видимости отметок без фиктивных инстанций', () => {
  expect(initialMapAudiences([
    { sideId: 'blue', visibility: { instanceIds: ['blue-hq'], sideIds: ['blue'] } },
    { sideId: 'red', visibility: { instanceIds: ['red-hq'], sideIds: ['red'] } },
    { sideId: 'blue', visibility: { instanceIds: ['blue-hq'], sideIds: ['blue'] } },
  ])).toEqual([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Штаб blue · blue-hq' },
    { sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE', label: 'Штаб red · red-hq' },
  ]);
});

it('AC-22: различает сторону наблюдаемого противника и сторону штаба', () => {
  expect(initialMapAudiences([
    { sideId: 'red', visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] } },
    { sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] } },
  ])).toEqual([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Штаб blue · blue-hq' },
  ]);
});

it('AC-22: не выбирает сторону при противоречивой привязке инстанции', () => {
  expect(() => initialMapAudiences([
    { sideId: 'blue', visibility: { instanceIds: ['shared-hq'] } },
    { sideId: 'red', visibility: { instanceIds: ['shared-hq'] } },
  ])).toThrow('AMBIGUOUS_INSTANCE_SIDE');
});
