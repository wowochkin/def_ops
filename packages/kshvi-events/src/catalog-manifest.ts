import { createHash } from 'node:crypto';
import type { EventTemplate, ValidationIssue, ValidationResult } from './model/event-template';
import { validateEventTemplate } from './validate-template';

export type CatalogReviewStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export type CatalogManifestEntry = {
  templateId: string;
  version: number;
  sha256: string;
  reviewStatus: CatalogReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type CatalogManifest = {
  schemaVersion: 1;
  catalogId: string;
  version: number;
  templates: CatalogManifestEntry[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value: unknown, path = ''): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalize(item, `${path}/${index}`)).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort((left, right) => left.localeCompare(right)).map(key => {
      if (!(key in value)) throw new Error(`Нельзя хешировать отсутствующее поле ${path}/${key}.`);
      return `${JSON.stringify(key)}:${canonicalize(value[key], `${path}/${key}`)}`;
    }).join(',')}}`;
  }
  throw new Error(`Нельзя хешировать не-JSON значение по пути ${path || '/'}.`);
}

export function templateContentHash(template: EventTemplate): string {
  return createHash('sha256').update(canonicalize(template)).digest('hex');
}

function result(issues: ValidationIssue[]): ValidationResult {
  return { valid: !issues.some(issue => issue.severity === 'ERROR'), issues };
}

function add(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message, severity: 'ERROR' });
}

function rejectAdditionalFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) add(issues, 'ADDITIONAL_PROPERTY', `${path}/${key}`, 'Дополнительное поле запрещено закрытым контрактом.');
  }
}

export function validateCatalogManifest(value: unknown, templates: readonly EventTemplate[] = []): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) {
    add(issues, 'SCHEMA_TYPE', '/', 'Манифест каталога должен быть JSON-объектом.');
    return result(issues);
  }

  rejectAdditionalFields(value, ['schemaVersion', 'catalogId', 'version', 'templates'], '', issues);
  if (value.schemaVersion !== 1) add(issues, 'SCHEMA_VERSION', '/schemaVersion', 'Поддерживается только версия схемы 1.');
  if (typeof value.catalogId !== 'string' || !value.catalogId.trim()) {
    add(issues, 'REQUIRED_TEXT', '/catalogId', 'Укажите непустой идентификатор каталога.');
  }
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    add(issues, 'INVALID_VERSION', '/version', 'Версия каталога должна быть положительным целым числом.');
  }
  if (!Array.isArray(value.templates)) {
    add(issues, 'SCHEMA_TYPE', '/templates', 'Перечень шаблонов должен быть массивом.');
    return result(issues);
  }

  const identities = new Set<string>();
  value.templates.forEach((entryValue, index) => {
    const base = `/templates/${index}`;
    if (!isObject(entryValue)) {
      add(issues, 'SCHEMA_TYPE', base, 'Запись манифеста должна быть JSON-объектом.');
      return;
    }
    rejectAdditionalFields(
      entryValue,
      ['templateId', 'version', 'sha256', 'reviewStatus', 'reviewedBy', 'reviewedAt'],
      base,
      issues,
    );
    const { templateId, version, sha256, reviewStatus, reviewedBy, reviewedAt } = entryValue;
    if (typeof templateId !== 'string' || !templateId.trim()) {
      add(issues, 'REQUIRED_TEXT', `${base}/templateId`, 'Укажите идентификатор шаблона.');
    }
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
      add(issues, 'INVALID_VERSION', `${base}/version`, 'Версия шаблона должна быть положительным целым числом.');
    }
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      add(issues, 'INVALID_CONTENT_HASH', `${base}/sha256`, 'Требуется SHA-256 из 64 строчных шестнадцатеричных символов.');
    }
    if (!['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'].includes(String(reviewStatus))) {
      add(issues, 'REVIEW_STATUS', `${base}/reviewStatus`, 'Неизвестный статус рецензирования шаблона.');
    }
    if (reviewStatus === 'APPROVED') {
      if (typeof reviewedBy !== 'string' || !reviewedBy.trim()) {
        add(issues, 'REVIEW_REQUIRED', `${base}/reviewedBy`, 'Утверждённый шаблон требует указания рецензента.');
      }
      if (typeof reviewedAt !== 'string' || !reviewedAt.trim()) {
        add(issues, 'REVIEW_REQUIRED', `${base}/reviewedAt`, 'Утверждённый шаблон требует времени рецензирования.');
      }
    }

    if (typeof templateId === 'string' && Number.isSafeInteger(version)) {
      const identity = `${templateId}@${String(version)}`;
      if (identities.has(identity)) {
        add(issues, 'DUPLICATE_TEMPLATE_VERSION', `${base}/templateId`, 'Та же версия шаблона уже записана в манифесте.');
      }
      identities.add(identity);

      const content = templates.find(template => template.templateId === templateId && template.version === version);
      if (!content) {
        add(issues, 'TEMPLATE_CONTENT_MISSING', `${base}/templateId`, 'Содержимое указанной версии шаблона не предоставлено.');
      } else {
        const contentValidation = validateEventTemplate(content);
        if (!contentValidation.valid) {
          add(issues, 'INVALID_TEMPLATE_CONTENT', base, 'Манифест ссылается на шаблон, не прошедший доменную валидацию.');
        } else if (typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256) && templateContentHash(content) !== sha256) {
          add(issues, 'CONTENT_HASH_MISMATCH', `${base}/sha256`, 'SHA-256 не совпадает с каноническим содержимым шаблона.');
        }
      }
    }
  });

  return result(issues);
}
