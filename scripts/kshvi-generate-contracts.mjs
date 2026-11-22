import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const sources = new Map();
function source(file) {
  if (!sources.has(file)) sources.set(file, readFileSync(resolve(root, file), 'utf8'));
  return sources.get(file);
}
function declaration(file, name) {
  const text = source(file);
  const marker = `export type ${name} =`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Не найден тип ${name} в ${file}`);
  let cursor = start + marker.length;
  let braces = 0;
  let angles = 0;
  for (; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '<') angles += 1;
    else if (char === '>') angles -= 1;
    else if (char === ';' && braces === 0 && angles === 0) return text.slice(start + marker.length, cursor).trim();
  }
  throw new Error(`Незавершённый тип ${name} в ${file}`);
}
function splitTop(text, delimiter) {
  const parts = [];
  let start = 0;
  let braces = 0;
  let angles = 0;
  let parentheses = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '<') angles += 1;
    else if (char === '>') angles -= 1;
    else if (char === '(') parentheses += 1;
    else if (char === ')') parentheses -= 1;
    else if (char === delimiter && braces === 0 && angles === 0 && parentheses === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}
const aliases = {
  ExerciseSession: ['services/kshvi/src/store/exercise-store.ts', 'ExerciseSession'],
  SessionProjection: ['services/kshvi/src/runtime/official-session-service.ts', 'SessionProjection'],
  ReplayFrame: ['services/kshvi/src/runtime/official-session-service.ts', 'ReplayFrameDto'],
  ArchiveRecord: ['services/kshvi/src/runtime/official-session-service.ts', 'ArchiveRecord'],
};
function schemaFor(raw) {
  let text = raw.trim().replace(/^readonly\s+/, '');
  if (text.startsWith('Readonly<') && text.endsWith('>')) text = text.slice('Readonly<'.length, -1);
  if (text.endsWith('[]')) return { type: 'array', items: schemaFor(text.slice(0, -2)) };
  if (text === 'string') return { type: 'string' };
  if (text === 'number') return { type: 'number' };
  if (text === 'boolean') return { type: 'boolean' };
  if (text === 'unknown' || text === 'JsonValue') return {};
  if (text === 'null') return { type: 'null' };
  if (text === 'Record<string, unknown>') return { type: 'object', additionalProperties: true };
  if (text === "ProjectedReplayFrame['source']") return { enum: ['TRUTH', 'RECORDED_PARTICIPANT_PROJECTION'] };
  if (aliases[text]) return { $ref: `#/definitions/${text}` };
  const union = splitTop(text, '|');
  if (union.length > 1) {
    const values = union.map(schemaFor);
    if (values.every(value => typeof value.const === 'string')) return { enum: values.map(value => value.const) };
    return { anyOf: values };
  }
  if (/^'.*'$/.test(text)) return { const: text.slice(1, -1) };
  if (text.startsWith('{') && text.endsWith('}')) {
    const properties = {};
    const required = [];
    for (const part of splitTop(text.slice(1, -1), ';')) {
      const match = part.match(/^(\w+)(\?)?:\s*([\s\S]+)$/);
      if (!match) throw new Error(`Не разобрано свойство: ${part}`);
      properties[match[1]] = schemaFor(match[3]);
      if (!match[2]) required.push(match[1]);
    }
    return { type: 'object', required, additionalProperties: false, properties };
  }
  throw new Error(`Не разобран фрагмент типа: ${text}`);
}
const definitions = Object.fromEntries(Object.entries(aliases).map(([name, [file, typeName]]) => [name, schemaFor(declaration(file, typeName))]));
function dereference(value) {
  if (Array.isArray(value)) return value.map(dereference);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') return { ...dereference(definitions[value.$ref.split('/').at(-1)]), description: `См. ${value.$ref.split('/').at(-1)}` };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dereference(item)]));
}
const openapiDefinitions = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, dereference(definition)]));
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://def-ops.local/schemas/kshvi/api.schema.json',
  title: 'Фактические HTTP DTO КШВИ',
  definitions,
};
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const response = (body = { type: 'object', additionalProperties: true }) => ({ '200': { description: 'Подтверждённый серверный результат', content: { 'application/json': { schema: body } } } });
const created = name => ({ '201': { description: 'Создано сервером', content: { 'application/json': { schema: ref(name) } } } });
const createdCard = () => ({ '201': { description: 'Карточка учения создана сервером', content: { 'application/json': { schema: { type: 'object', description: 'ExerciseCard с редакциями и серверными сеансами' } } } } });
const operation = (responses = response()) => ({ responses: { ...responses, '400': { description: 'Ошибка запроса' }, '403': { description: 'Действие недоступно' }, '409': { description: 'Конфликт версии или состояния' } } });
const sessionRef = response(ref('ExerciseSession'));
const paths = {
  '/kshvi/exercises': { get: operation(), post: operation(createdCard()) },
  '/kshvi/exercises/{id}': { get: operation() },
  '/kshvi/exercises/{id}/revisions': { get: operation(), post: operation(createdCard()) },
  '/kshvi/exercises/{id}/sessions': { get: operation(), post: operation(created('ExerciseSession')) },
  '/kshvi/exercises/{id}/sessions/{sessionId}': { get: operation(sessionRef) },
  '/kshvi/exercises/{id}/sessions/{sessionId}/commands': { post: operation(sessionRef) },
  '/kshvi/exercises/{id}/sessions/{sessionId}/projection': { get: operation(response(ref('SessionProjection'))) },
  '/kshvi/exercises/{id}/sessions/{sessionId}/replay': { get: operation(response(ref('ReplayFrame'))) },
  '/kshvi/exercises/{id}/sessions/{sessionId}/debrief': { get: operation() },
  '/kshvi/exercises/{id}/sessions/{sessionId}/debrief/assessment': { post: operation() },
  '/kshvi/archives': { post: operation(created('ArchiveRecord')) },
  '/kshvi/archives/{archiveId}/export': { get: operation() },
  '/kshvi/expositions/{archiveId}': { get: operation() },
  '/kshvi/admin/overview': { get: operation() },
  '/kshvi/admin/accounts/{accountId}/block': { post: operation() },
  '/kshvi/admin/accounts/{accountId}/archive': { post: operation() },
  '/kshvi/admin/assignments/{assignmentId}/revoke': { post: operation() },
  '/kshvi/admin/audit/export': { post: operation() },
};
const openapi = {
  openapi: '3.1.0', info: { title: 'КШВИ: фактический серверный API', version: '1.0.0' },
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema', paths,
  components: {
    schemas: openapiDefinitions,
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'kshvi_session' } },
  },
  security: [{ cookieAuth: [] }],
};
for (const [file, value] of [['packages/kshvi/schemas/api.schema.json', schema], ['packages/kshvi/schemas/openapi.json', openapi]]) {
  const output = resolve(root, file);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Сформирован ${file}`);
}
