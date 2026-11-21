import { describe, expect, it } from 'vitest';
import { modernCorpus, validateModernCorpus } from '../src/modern';
import coverage from '../data/modern/research/coverage.json';
import inventory from '../data/modern/inventory/baseline.json';

describe('исследовательский корпус современного режима', () => {
  it('сводка охвата соответствует корпусу и не объявляет его полным', () => {
    expect(coverage.complete).toBe(false);
    expect(coverage.countries.map(c => c.country).sort()).toEqual(modernCorpus.countries.map(c => c.code).sort());
    for (const country of coverage.countries) {
      const records = modernCorpus.representatives.filter(r => r.countryContext === country.country);
      expect(country.models).toBe(records.length);
      expect(country.characteristics).toBe(records.reduce((n, r) => n + r.passport.characteristics.length, 0));
      expect(country.gaps.length).toBeGreaterThan(0);
    }
  });
  it('каждая номенклатурная строка ведёт на карточку и энциклопедический источник, а числа не подменяют паспорт', () => {
    expect(inventory.complete).toBe(false);
    expect(inventory.pages.filter(p => p.domain === 'ground')).toHaveLength(15);
    for (const page of inventory.pages) {
      expect(modernCorpus.sources.find(s => s.id === page.source)?.kind).toBe('encyclopedia');
      for (const row of page.records) {
        const card = modernCorpus.representatives.find(r => r.id === row.record)!;
        expect(card?.countryContext).toBe(page.country);
        expect(card.sources).toContain(page.source);
        expect(card.inventoryReferences?.some(r => r.designation === row.designation && r.source === page.source)).toBe(true);
      }
    }
    expect(modernCorpus.representatives.filter(r => r.catalogueOnly).every(r => r.passport.characteristics.length === 0)).toBe(true);
    expect(modernCorpus.representatives.flatMap(r => r.passport.characteristics).every(c => !c.source.includes('-inventory-'))).toBe(true);
  });

  it('покрывает согласованные страны и содержит непротиворечивые ссылки', () => {
    expect(modernCorpus.countries.map(c => c.code).sort()).toEqual(['US', 'CN', 'IN', 'KP', 'UA', 'RU', 'IR', 'GB', 'FR', 'DE', 'IT', 'ES', 'PL', 'SE', 'FI'].sort());
    expect(validateModernCorpus(modernCorpus)).toEqual([]);
    expect(modernCorpus.sources.length).toBeGreaterThan(20);
    expect(modernCorpus.organizations.length).toBeGreaterThan(50);
    expect(modernCorpus.representatives.length).toBeGreaterThan(10);
  });

  it('различает род войск, модель техники и экземпляр, не выдаёт справочник за параметры симуляции', () => {
    expect(modernCorpus.modelInputs).toBe(false);
    expect(modernCorpus.organizations.some(n => n.id === 'gb-royal-artillery' && n.kind === 'branch')).toBe(true);
    expect(modernCorpus.representatives.some(n => n.id === 'de-puma' && n.objectClass === 'ifv')).toBe(true);
    expect(modernCorpus.representatives.every(n => n.kind === 'equipment_model')).toBe(true);
    expect(modernCorpus.countries.every(c => c.coverage === 'partial')).toBe(true);
    expect(modernCorpus.sources.find(s => s.id === 'kp-dia')?.scopeDate).toBe('2021');
  });

  it('сохраняет национальные особенности и не привязывает все самостоятельные рода к сухопутным войскам', () => {
    const nodes = new Map(modernCorpus.organizations.map(n => [n.id, n]));
    expect(nodes.get('cn-information-support')?.parent).toBe('cn-pla');
    expect(nodes.get('us-marines')?.kind).toBe('service');
    expect(nodes.get('de-cir')?.kind).toBe('service');
    expect(nodes.get('ir-artesh')?.parent).toBe('ir-armed-forces');
    expect(nodes.get('ir-irgc')?.parent).toBe('ir-armed-forces');
    expect(nodes.get('ua-unmanned')?.kind).toBe('independent_branch');
    expect(nodes.get('ua-unmanned')?.parent).toBe('ua-armed-forces');
  });

  it('обнаруживает подмену организации типом техники, чужую страну, цикл и отсутствующий источник', () => {
    const copy = structuredClone(modernCorpus);
    const n = copy.organizations.find(n => n.id === 'gb-royal-artillery')!;
    n.kind = 'tank' as never;
    n.parent = n.id;
    n.sources = ['missing-source'];
    const cross = copy.organizations.find(n => n.id === 'us-army')!;
    cross.parent = 'cn-pla';
    const errors = validateModernCorpus(copy).join('\n');
    expect(errors).toMatch(/вид узла/);
    expect(errors).toMatch(/цикл/);
    expect(errors).toMatch(/источник/);
    expect(errors).toMatch(/другой страны/);
  });
});
