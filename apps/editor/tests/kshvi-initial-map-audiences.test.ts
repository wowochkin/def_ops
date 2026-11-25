import { expect, it } from 'vitest';
import { initialMapAudiences } from '../src/modern/kshvi/preparation/initial-map-audiences';

it('AC-22: формирует проекции из состава участников даже без отметок', () => {
  expect(initialMapAudiences([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Штаб blue · blue-hq' },
    { sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE', label: 'Штаб red · red-hq' },
    { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Штаб blue · blue-hq' },
  ])).toEqual([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Штаб blue · blue-hq' },
    { sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE', label: 'Штаб red · red-hq' },
  ]);
});

it('AC-22: не подставляет роль или название вместо назначения', () => {
  expect(initialMapAudiences([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'OBSERVER', label: 'Наблюдатель учения' },
  ])).toEqual([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'OBSERVER', label: 'Наблюдатель учения' },
  ]);
});

it('AC-22: не выбирает сторону при противоречивой привязке инстанции', () => {
  expect(() => initialMapAudiences([
    { sideId: 'blue', instanceId: 'shared-hq', role: 'TRAINEE', label: 'Первое назначение' },
    { sideId: 'red', instanceId: 'shared-hq', role: 'TRAINEE', label: 'Противоречащее назначение' },
  ])).toThrow('AMBIGUOUS_INSTANCE_SIDE');
});
