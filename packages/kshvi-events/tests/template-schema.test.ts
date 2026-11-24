import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CatalogManifest } from '../src/catalog-manifest';
import type { EventEffect } from '../src/model/event-effect';
import { eventTemplateSchema } from '../src/template-schema';
import { templateContentHash, validateCatalogManifest } from '../src/catalog-manifest';
import { validTemplate } from './fixtures/valid-template';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function manifest(): CatalogManifest {
  return {
    schemaVersion: 1,
    catalogId: 'training-events',
    version: 1,
    templates: [
      {
        templateId: validTemplate.templateId,
        version: validTemplate.version,
        sha256: createHash('sha256').update(JSON.stringify(canonical(validTemplate))).digest('hex'),
        reviewStatus: 'APPROVED',
        reviewedBy: 'Независимый методист',
        reviewedAt: '2026-11-21T09:00:00.000Z',
      },
    ],
  };
}

describe('JSON Schema и манифест каталога', () => {
  it('публикует закрытый discriminated union эффектов', () => {
    expect(eventTemplateSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(eventTemplateSchema.additionalProperties).toBe(false);
    const effects = eventTemplateSchema.$defs.effect.oneOf;
    expect(effects.length).toBeGreaterThanOrEqual(6);
    for (const effect of effects) {
      expect(effect.additionalProperties).toBe(false);
      expect(effect.properties.type.const).toBeTruthy();
    }

    const typedEffect: EventEffect = {
      type: 'communication.state',
      channelId: 'channel-1',
      status: 'DEGRADED',
    };
    expect(typedEffect.type).toBe('communication.state');
  });

  it('сверяет канонический хеш и статус рецензирования в манифесте', () => {
    const value = manifest();
    expect(value.templates[0].sha256).toBe(templateContentHash(validTemplate));
    expect(validateCatalogManifest(value, [validTemplate])).toEqual({ valid: true, issues: [] });
  });

  it('отклоняет не совпадающий хеш содержимого', () => {
    const value = manifest();
    value.templates[0].sha256 = '0'.repeat(64);
    expect(validateCatalogManifest(value, [validTemplate]).issues).toContainEqual(
      expect.objectContaining({ code: 'CONTENT_HASH_MISMATCH', path: '/templates/0/sha256' }),
    );
  });

  it('отклоняет дубликат версии и неподтверждённое утверждение', () => {
    const duplicate = manifest();
    duplicate.templates.push({ ...duplicate.templates[0] });
    expect(validateCatalogManifest(duplicate, [validTemplate]).issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_TEMPLATE_VERSION', path: '/templates/1/templateId' }),
    );

    const review = manifest();
    delete review.templates[0].reviewedBy;
    expect(validateCatalogManifest(review, [validTemplate]).issues).toContainEqual(
      expect.objectContaining({ code: 'REVIEW_REQUIRED', path: '/templates/0/reviewedBy' }),
    );
  });

  it('отклоняет ссылку манифеста на отсутствующее содержимое', () => {
    expect(validateCatalogManifest(manifest(), []).issues).toContainEqual(
      expect.objectContaining({ code: 'TEMPLATE_CONTENT_MISSING', path: '/templates/0/templateId' }),
    );
  });

  it('возвращает ошибку вместо сбоя хеширования не-JSON содержимого', () => {
    const unsafe = { ...structuredClone(validTemplate), predicate: () => true };
    expect(validateCatalogManifest(manifest(), [unsafe]).issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_TEMPLATE_CONTENT', path: '/templates/0' }),
    );
  });
});
