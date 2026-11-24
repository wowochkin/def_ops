import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTION_TAXONOMY, operationalAt, wallClockAt, type Quantity, type SourceRef } from '../src/index';

// Эти ошибочные литералы должны отклоняться TypeScript до попадания в JSON/PostgreSQL.
// @ts-expect-error KNOWN всегда содержит число
const invalidKnownQuantity: Quantity = { status: 'KNOWN', value: null, unit: 'kg' };
// @ts-expect-error SourceRef обязан фиксировать редакцию и SHA-256
const invalidSource: SourceRef = { sourceId: 'book', revision: 1 };
void invalidKnownQuantity;
void invalidSource;

describe('регрессии границ доменной модели', () => {
  it('JSON Schema отклоняет KNOWN null и UNKNOWN number', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(readFileSync(new URL('../schemas/model.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema.definitions.Quantity);
    expect(validate({ status: 'KNOWN', value: null, unit: 'kg' })).toBe(false);
    expect(validate({ status: 'UNKNOWN', value: 1, unit: 'kg' })).toBe(false);
    expect(validate({ status: 'KNOWN', value: 0, unit: 'kg' })).toBe(true);
    expect(validate({ status: 'UNKNOWN', value: null, unit: 'kg' })).toBe(true);
  });

  it('все обязательные свойства сущностей имеют типы, а версионные поля используют VersionRef', () => {
    const schema = JSON.parse(readFileSync(new URL('../schemas/model.schema.json', import.meta.url), 'utf8')) as {
      definitions: Record<string, { required?: string[]; properties?: Record<string, object> }>;
    };
    for (const [name, definition] of Object.entries(schema.definitions)) {
      if (name === 'VersionRef' || name === 'Quantity') continue;
      for (const property of definition.required ?? []) {
        expect(definition.properties?.[property], `${name}.${property}`).toBeDefined();
      }
    }
    expect(schema.definitions.DomainEvent.properties!.versions).toBeDefined();
    expect(schema.definitions.DomainEvent.required).toContain('hashVersion');
    expect(schema.definitions.Snapshot.properties!.environment).toEqual({ $ref: '#/definitions/VersionRef' });
  });

  it('не принимает naive wall clock и строго проверяет календарь и смещение', () => {
    expect(() => wallClockAt('2026-01-01T12:00:00')).toThrow('UTC');
    expect(() => wallClockAt('2026-02-30T12:00:00Z')).toThrow('календар');
    expect(wallClockAt('2026-01-01T12:00:00+03:00')).toBe('2026-01-01T09:00:00.000Z');
  });

  it('проверяет IANA-зону и соответствие заявленного offset этой зоне', () => {
    expect(() => operationalAt('2026-01-01T12:00:00+03:00', 'Mars/Olympus')).toThrow('IANA');
    expect(() => operationalAt('2026-01-01T12:00:00+04:00', 'Europe/Moscow')).toThrow(/смещени/i);
    expect(operationalAt('2026-07-01T12:00:00-04:00', 'America/New_York').normalizedAt).toBe('2026-07-01T16:00:00.000Z');
  });

  it('глубоко замораживает список категорий таксономии', () => {
    expect(Object.isFrozen(DEFAULT_ACTION_TAXONOMY.categories)).toBe(true);
    expect(() => { (DEFAULT_ACTION_TAXONOMY.categories as unknown[]).push({}); }).toThrow();
  });
});
