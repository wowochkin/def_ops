import schema from '../schemas/event-template.schema.json' with { type: 'json' };
import type { ValidationIssue } from './model/event-template';

export const eventTemplateSchema = schema;

type SchemaObject = Record<string, unknown>;

function isObject(value: unknown): value is SchemaObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function childPath(path: string, key: string | number): string {
  const escaped = String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${path}/${escaped}`;
}

function issue(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path: path || '/', message, severity: 'ERROR' });
}

function resolveReference(root: SchemaObject, reference: string): SchemaObject | null {
  if (!reference.startsWith('#/')) return null;
  let current: unknown = root;
  for (const part of reference.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isObject(current) || !(key in current)) return null;
    current = current[key];
  }
  return isObject(current) ? current : null;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function validateNode(
  value: unknown,
  schemaValue: unknown,
  path: string,
  root: SchemaObject,
  issues: ValidationIssue[],
): void {
  if (typeof schemaValue === 'boolean') {
    if (!schemaValue) issue(issues, 'SCHEMA_REJECTED', path, 'Значение запрещено схемой.');
    return;
  }
  if (!isObject(schemaValue)) return;

  if (typeof schemaValue.$ref === 'string') {
    const referenced = resolveReference(root, schemaValue.$ref);
    if (!referenced) {
      issue(issues, 'SCHEMA_REFERENCE', path, 'Схема содержит неизвестную внутреннюю ссылку.');
      return;
    }
    validateNode(value, referenced, path, root, issues);
  }

  if (Array.isArray(schemaValue.oneOf)) {
    const candidates = schemaValue.oneOf.map(candidate => {
      const candidateIssues: ValidationIssue[] = [];
      validateNode(value, candidate, path, root, candidateIssues);
      return { candidate, candidateIssues };
    });
    const matches = candidates.filter(candidate => candidate.candidateIssues.length === 0);
    if (matches.length !== 1) {
      if (matches.length === 0) {
        const discriminator = isObject(value) && typeof value.type === 'string' ? value.type : null;
        let detailed = discriminator
          ? candidates.filter(({ candidate }) => (
              isObject(candidate)
              && isObject(candidate.properties)
              && isObject(candidate.properties.type)
              && candidate.properties.type.const === discriminator
            ))
          : [];
        if (detailed.length === 0) {
          detailed = candidates.filter(({ candidate }) => {
            if (!isObject(candidate)) return false;
            if (typeof candidate.type === 'string') return matchesType(value, candidate.type);
            if (Array.isArray(candidate.type)) {
              return candidate.type.some(type => typeof type === 'string' && matchesType(value, type));
            }
            return false;
          });
        }
        if (detailed.length === 1) issues.push(...detailed[0].candidateIssues);
      }
      issue(
        issues,
        matches.length === 0 ? 'SCHEMA_UNION' : 'SCHEMA_UNION_AMBIGUOUS',
        path,
        matches.length === 0
          ? 'Значение не соответствует ни одному разрешённому варианту.'
          : 'Значение соответствует нескольким вариантам закрытого типа.',
      );
    }
  }

  if (Array.isArray(schemaValue.allOf)) {
    for (const candidate of schemaValue.allOf) validateNode(value, candidate, path, root, issues);
  }

  const expectedTypes = typeof schemaValue.type === 'string'
    ? [schemaValue.type]
    : Array.isArray(schemaValue.type)
      ? schemaValue.type.filter((type): type is string => typeof type === 'string')
      : [];
  if (expectedTypes.length > 0 && !expectedTypes.some(type => matchesType(value, type))) {
    issue(issues, 'SCHEMA_TYPE', path, `Ожидался тип ${expectedTypes.join(' или ')}; проверьте значение поля.`);
    return;
  }

  if ('const' in schemaValue && !Object.is(value, schemaValue.const)) {
    issue(issues, 'SCHEMA_CONST', path, 'Значение не совпадает с обязательной константой схемы.');
  }

  if (Array.isArray(schemaValue.enum) && !schemaValue.enum.some(candidate => Object.is(value, candidate))) {
    issue(issues, 'SCHEMA_ENUM', path, 'Значение не входит в перечень разрешённых схемой.');
  }

  if (typeof value === 'string') {
    if (typeof schemaValue.minLength === 'number' && value.length < schemaValue.minLength) {
      issue(issues, 'REQUIRED_TEXT', path, 'Поле не должно быть пустым.');
    }
    if (typeof schemaValue.pattern === 'string' && !new RegExp(schemaValue.pattern, 'u').test(value)) {
      issue(issues, 'SCHEMA_PATTERN', path, 'Значение не соответствует требуемому формату.');
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schemaValue.minimum === 'number' && value < schemaValue.minimum) {
      issue(issues, 'SCHEMA_MINIMUM', path, `Значение должно быть не меньше ${schemaValue.minimum}.`);
    }
    if (typeof schemaValue.maximum === 'number' && value > schemaValue.maximum) {
      issue(issues, 'SCHEMA_MAXIMUM', path, `Значение должно быть не больше ${schemaValue.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schemaValue.minItems === 'number' && value.length < schemaValue.minItems) {
      issue(issues, 'SCHEMA_MIN_ITEMS', path, `Нужно не меньше элементов: ${schemaValue.minItems}.`);
    }
    if ('items' in schemaValue) {
      value.forEach((item, index) => validateNode(item, schemaValue.items, childPath(path, index), root, issues));
    }
  }

  if (isObject(value)) {
    const properties = isObject(schemaValue.properties) ? schemaValue.properties : {};
    if (Array.isArray(schemaValue.required)) {
      for (const key of schemaValue.required) {
        if (typeof key === 'string' && !Object.hasOwn(value, key)) {
          issue(issues, 'REQUIRED_FIELD', childPath(path, key), 'Обязательное поле отсутствует.');
        }
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(item, properties[key], childPath(path, key), root, issues);
      } else if (schemaValue.additionalProperties === false) {
        issue(issues, 'ADDITIONAL_PROPERTY', childPath(path, key), 'Дополнительное поле запрещено закрытой схемой.');
      } else if (isObject(schemaValue.additionalProperties)) {
        validateNode(item, schemaValue.additionalProperties, childPath(path, key), root, issues);
      }
    }
  }
}

export function validateTemplateAgainstSchema(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateNode(value, eventTemplateSchema, '', eventTemplateSchema, issues);
  return issues;
}
