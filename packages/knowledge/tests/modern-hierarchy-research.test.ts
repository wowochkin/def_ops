import { describe, it, expect } from 'vitest';
import { modernCorpus, validateModernCorpus } from '../src/modern';
import coverage from '../data/modern/research/hierarchy-coverage.json';
describe('наполнение национальных организационных схем', () => {
 it('сохраняет варианты состава и происхождение численности вместо единого условного штата', () => {
  const quantified = new Set(modernCorpus.hierarchyTemplates.filter(t => t.levels.some(l => l.passport.characteristics.some(c => /^(personnel_|component_count_)/.test(c.field)))).map(t => t.country));
  expect(quantified.size).toBeGreaterThanOrEqual(12);
  const iran = modernCorpus.hierarchyTemplates.find(t => t.id === 'ir-educational-brigade-variants');
  expect(iran?.levels.map(l => l.id)).toEqual(['infantry-brigade','armoured-brigade','mechanized-brigade']);
  expect(iran?.levels[1].passport.characteristics.filter(c => c.field === 'composition_description').length).toBeGreaterThan(1);
  expect(modernCorpus.hierarchyTemplates.find(t => t.id === 'ua-hierarchy-research')?.levels).toHaveLength(2);
  expect(modernCorpus.sources.find(s => s.id === 'ua-org-kingu-2024')?.scopeDate).toBe('2024');
  expect(modernCorpus.sources.find(s => s.id === 'fi-r-s-levels')?.scopeDate).toBe('2004-12-08');
  expect(validateModernCorpus(modernCorpus)).toEqual([]);
  expect(coverage.complete).toBe(false);
  for (const row of coverage.countries) {
    const levels = modernCorpus.hierarchyTemplates.filter(t => t.country === row.country).flatMap(t => t.levels);
    expect(row.levels).toBe(levels.length);
    expect(row.personnelLevels).toBe(levels.filter(l => l.passport.characteristics.some(c => c.field.startsWith('personnel_'))).length);
  }
 });
});

describe('авиационные и морские организационные примеры', () => {
 it('различает число людей, число самолётов и число подразделений', () => {
  const air = modernCorpus.hierarchyTemplates.find(t => t.id === 'in-r-hierarchy-air')!;
  const section = air.levels.find(l => l.id === 'section')!;
  expect(section.passport.characteristics.find(c => c.field === 'equipment_count_reference')?.value).toBe(3);
  expect(section.passport.characteristics.some(c => c.field.startsWith('personnel_'))).toBe(false);
  const flight = air.levels.find(l => l.id === 'flight')!;
  expect(flight.passport.characteristics.find(c => c.field === 'component_count_reference')?.value).toBe(2);
  expect(flight.passport.characteristics.some(c => c.field === 'equipment_count_reference')).toBe(false);
 });
 it('не переносит состав авиационной пары на корабельную группу', () => {
  const air = modernCorpus.hierarchyTemplates.find(t => t.id === 'se-r-air-levels')!.levels.find(l => l.id === 'se-r-level-air-rote')!;
  const navy = modernCorpus.hierarchyTemplates.find(t => t.id === 'se-r-navy-levels')!.levels.find(l => l.id === 'se-r-level-navy-rote')!;
  expect(air.passport.characteristics.find(c => c.field === 'equipment_count_reference')?.value).toBe(2);
  expect(navy.passport.characteristics.find(c => c.field === 'equipment_count_min')?.value).toBe(2);
  expect(navy.passport.characteristics.find(c => c.field === 'equipment_count_max')?.value).toBe(3);
 });
 it('не приравнивает внутренние секции катера и фрегата', () => {
  const navy = modernCorpus.hierarchyTemplates.find(t => t.id === 'de-r-navy-levels')!;
  expect(navy.levels.find(l => l.id === 'boat-reference')?.passport.characteristics.find(c => c.field === 'component_count_reference')?.value).toBe(2);
  expect(navy.levels.find(l => l.id === 'frigate-reference')?.passport.characteristics.find(c => c.field === 'component_count_reference')?.value).toBe(5);
  expect(modernCorpus.hierarchyTemplates.find(t => t.id === 'es-navy-organizational-forms')?.service).toBe('es-navy');
 });
});
