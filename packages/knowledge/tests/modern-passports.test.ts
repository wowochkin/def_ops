import { expect, it } from 'vitest';
import { modernCorpus, passportCoverage, modernSeedEntries, validateModernCorpus, characteristicPrefix, organizationSizeLabels } from '../src/modern';

it('сохраняет источники, единицы измерения и применимость справочных характеристик', () => {
  const challenger = modernCorpus.representatives.find(r => r.id === 'gb-challenger2')!;
  expect(challenger.passport.characteristics.find(f => f.field === 'mass_kg')).toMatchObject({ value: 62500, unit: 'kg', source: 'gb-challenger' });
  expect(challenger.passport.characteristics.every(f => f.locator && f.scope)).toBe(true);
  expect(passportCoverage(challenger).simulationValidated).toBe(false);
  expect(passportCoverage(challenger).missing).toContain('environment_limits');
  expect(modernSeedEntries().find(e => e.id === 'modern:equipment:gb-challenger2')?.facts?.some(f => f.key === 'mass_kg' && f.source)).toBe(true);
});

it('разделяет семейства и варианты и не наследует числа в другую модификацию', () => {
  const family = modernCorpus.representatives.find(r => r.id === 'se-gripen')!;
  const e = modernCorpus.representatives.find(r => r.id === 'se-gripen-e')!;
  const f = modernCorpus.representatives.find(r => r.id === 'se-gripen-f')!;
  expect(family.granularity).toBe('family');
  expect(e.parentModel).toBe(family.id);
  expect(e.passport.characteristics.find(c => c.field === 'crew_count')?.value).toBe(1);
  expect(f.passport.characteristics.find(c => c.field === 'crew_count')?.value).toBe(2);
  expect(family.passport.characteristics).toEqual([]);
});

it('проверяет размерности и не принимает паспорт за готового агента при пробелах', () => {
  expect(validateModernCorpus(modernCorpus)).toEqual([]);
  const copy = structuredClone(modernCorpus);
  copy.representatives.find(r => r.id === 'gb-challenger2')!.passport.characteristics[0].unit = 'm';
  expect(validateModernCorpus(copy).join('\n')).toMatch(/единица измерения/);
  expect(modernCorpus.representatives.every(r => passportCoverage(r).simulationValidated === false)).toBe(true);
  expect(modernCorpus.hierarchyTemplates.every(h => h.passport.simulationValidated === false)).toBe(true);
  for (const hierarchy of modernCorpus.hierarchyTemplates) for (const level of hierarchy.levels) {
    expect(level.nativeName.trim()).not.toBe('');
    expect(level.passport.profile).toBe('organization-levels');
    expect(level.passport.simulationValidated).toBe(false);
  }
});

it('сохраняет разные комплектации и отделяет экипаж от перевозимых людей', () => {
  const btr = modernCorpus.representatives.find(r => r.id === 'ru-btr82a')!;
  expect(btr.passport.characteristics.find(c => c.field === 'crew_count')?.value).toBe(3);
  expect(btr.passport.characteristics.find(c => c.field === 'passenger_capacity')?.value).toBe(7);
  const centauro = modernCorpus.representatives.find(r => r.id === 'it-centauro2')!;
  expect(centauro.passport.characteristics.filter(c => c.field === 'mass_kg').map(c => [c.value, c.source])).toEqual([
    [30000, 'it-centauro-idv'], [32000, 'it-centauro-army'],
  ]);
  const trainer = modernCorpus.representatives.find(r => r.id === 'in-tejas-air-trainer')!;
  expect(trainer.passport.characteristics.find(c => c.field === 'crew_count')?.value).toBe(2);
  expect(trainer.passport.characteristics.some(c => c.field === 'maximum_takeoff_mass_kg')).toBe(false);
  const rafaleF4 = modernCorpus.representatives.find(r => r.id === 'fr-rafale')!;
  const rafaleB = modernCorpus.representatives.find(r => r.id === 'fr-rafale-b')!;
  expect(rafaleB.parentModel).toBe(rafaleF4.parentModel);
  expect(rafaleB.parentModel).not.toBe(rafaleF4.id);
});

it('не считает дополнительные характеристики заполнением обязательных полей', () => {
  const row = structuredClone(modernCorpus.representatives.find(r => r.id === 'gb-challenger2')!);
  row.passport.characteristics = row.passport.characteristics.filter(c => c.field !== 'speed_road_max_kmh');
  const before = passportCoverage(row);
  row.passport.characteristics.push({ field: 'speed_road_max_kmh', value: 1, unit: 'km/h', source: 'gb-challenger', locator: 'Тестовый пример', scope: 'Тест, не сведения корпуса', status: 'reported' });
  const after = passportCoverage(row);
  expect(after.documented).toBe(before.documented);
  expect(after.totalDocumented).toBe(before.totalDocumented + 1);
});

it('отклоняет неизвестный квалификатор числового значения', () => {
  const copy = structuredClone(modernCorpus);
  Object.assign(copy.representatives[0].passport.characteristics[0], { qualifier: 'guess' });
  expect(validateModernCorpus(copy).join('\n')).toMatch(/квалификатор/);
});

it('отличает строгую границу от нестрогой', () => {
  const fact = structuredClone(modernCorpus.representatives[0].passport.characteristics[0]);
  Object.assign(fact, { value: 600, qualifier: 'greater_than' });
  expect(characteristicPrefix(fact)).toBe('> ');
  Object.assign(fact, { qualifier: 'at_least' });
  expect(characteristicPrefix(fact)).toBe('≥ ');
});

it('не соединяет границы численности из разных источников в выдуманный диапазон', () => {
  const base = { unit: 'person', locator: 'Обзор', scope: 'Типовой пример', status: 'reported' as const };
  const passport = { profile: 'organization-levels', simulationValidated: false as const, characteristics: [
    { ...base, field: 'personnel_min', value: 10, source: 'a' },
    { ...base, field: 'personnel_max', value: 50, source: 'b' },
  ] };
  expect(organizationSizeLabels(passport)).toEqual(['≥ 10 чел.', '≤ 50 чел.']);
  passport.characteristics[1].source = 'a';
  expect(organizationSizeLabels(passport)).toEqual(['10–50 чел.']);
});

it('показывает строгую границу численности, а не превращает «меньше» в «не больше»', () => {
  expect(organizationSizeLabels({ profile: 'organization-levels', simulationValidated: false, characteristics: [
    { field: 'personnel_max', value: 10, qualifier: 'less_than', unit: 'person', source: 'source', locator: 'Таблица', scope: 'Обзор', status: 'reported' },
  ] })).toEqual(['< 10 чел.']);
});

it('переносит паспорта каждого организационного уровня в отдельную базу знаний с источниками и связью со схемой', () => {
  const entries = modernSeedEntries();
  const section = entries.find(e => e.id === 'modern:hierarchy-level:in-r-hierarchy-air:section');
  expect(section?.aliases).toContain('Section');
  expect(section?.facts?.find(f => f.key === 'equipment_count_reference')).toMatchObject({ source: 'modern:source:in-structure-nios', pages: 'Печатная с. 37, §4.3.3' });
  expect(section?.facts?.find(f => f.key === 'equipment_count_reference')?.value).toContain('3 item');
  expect(section?.relations).toContainEqual({ type: 'part_of', target: 'modern:hierarchy:in-r-hierarchy-air' });
  expect(section?.facts?.some(f => f.key.startsWith('personnel_'))).toBe(false);
  const squad = entries.find(e => e.id === 'modern:hierarchy-level:ua-hierarchy-research:squad');
  expect(squad?.facts?.find(f => f.key === 'personnel_reference')?.value).toContain('9 person');
  expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
});
