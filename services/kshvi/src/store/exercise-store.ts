import { createHash, randomUUID } from 'node:crypto';
import { createPool, migrate, tx, type Client, type Migration, type Pool } from '@def-ops/db';
import { canonicalJson, type JsonValue } from '@def-ops/kshvi';

export type ExercisePurpose = 'planned' | 'special' | 'inspection' | 'research' | 'exposition' | 'custom';
export type ExerciseScale = 'tactical' | 'operational' | 'strategic' | 'custom';
export type ExerciseState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SEALED' | 'CANCELLED' | 'ARCHIVED';
export type ExerciseValidation = 'NOT_RUN' | 'OK' | 'WARNING' | 'ERROR';
export type ExerciseActor = Readonly<{ organizationId: string; userId: string }>;

export type ExerciseSummary = Readonly<{
  id: string;
  title: string;
  purpose: ExercisePurpose;
  scale: ExerciseScale;
  state: ExerciseState;
  revision: number;
  ownerId: string;
  startsAt: string | null;
  endsAt: string | null;
  readiness: number;
  validation: ExerciseValidation;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastSessionId: string | null;
}>;

export type ExerciseRevision = Readonly<{
  id: string;
  exerciseId: string;
  revision: number;
  payload: JsonValue;
  sha256: string;
  state: Exclude<ExerciseState, 'ARCHIVED'>;
  createdBy: string;
  createdAt: string;
  supersedesId: string | null;
}>;

export type ExerciseSession = Readonly<{
  id: string;
  exerciseId: string;
  scenarioRevisionId: string;
  revision: number;
  state: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED';
  mode: 'NETWORK';
  authority: 'SERVER';
  confirmedRevision: number;
  createdBy: string;
  createdAt: string;
}>;

export type ExerciseCard = ExerciseSummary & Readonly<{
  revisions: readonly ExerciseRevision[];
  sessions: readonly ExerciseSession[];
}>;

export type CreateExerciseInput = Readonly<{
  title: string;
  purpose: ExercisePurpose;
  scale: ExerciseScale;
  startsAt?: string | null;
  endsAt?: string | null;
  payload?: JsonValue;
}>;

export type CreateRevisionInput = Readonly<{
  expectedRevision: number;
  title?: string;
  purpose?: ExercisePurpose;
  scale?: ExerciseScale;
  startsAt?: string | null;
  endsAt?: string | null;
  state?: Exclude<ExerciseState, 'ARCHIVED'>;
  readiness?: number;
  validation?: ExerciseValidation;
  payload?: JsonValue;
}>;

export type ExerciseFilters = Readonly<{
  query?: string;
  state?: ExerciseState;
  scale?: ExerciseScale;
  purpose?: ExercisePurpose;
  includeArchived?: boolean;
}>;

export type CreateSessionInput = Readonly<{
  revision: number;
  /** Черновик клиента принимается только как транспортный шум и никогда не становится официальным миром. */
  optimisticWorld?: unknown;
}>;

export interface ExerciseStore {
  create(actor: ExerciseActor, input: CreateExerciseInput): Promise<ExerciseCard>;
  list(organizationId: string, filters: ExerciseFilters): Promise<readonly ExerciseSummary[]>;
  get(organizationId: string, exerciseId: string): Promise<ExerciseCard | null>;
  copy(actor: ExerciseActor, exerciseId: string, title?: string): Promise<ExerciseCard>;
  archive(actor: ExerciseActor, exerciseId: string, expectedRevision: number): Promise<ExerciseCard>;
  createRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput): Promise<ExerciseCard>;
  createSession(actor: ExerciseActor, exerciseId: string, input: CreateSessionInput): Promise<ExerciseSession>;
  getSession(organizationId: string, exerciseId: string, sessionId: string): Promise<ExerciseSession | null>;
  listSessions(organizationId: string, exerciseId: string): Promise<readonly ExerciseSession[]>;
}

export type ExerciseStoreErrorCode = 'NOT_FOUND' | 'REVISION_NOT_FOUND' | 'REVISION_CONFLICT' | 'ARCHIVED' | 'VALIDATION';
export class ExerciseStoreError extends Error {
  constructor(readonly code: ExerciseStoreErrorCode, message: string) { super(message); }
}

export const KSHVI_EXERCISE_MIGRATIONS: Migration[] = [{
  id: 3,
  name: 'exercise-library',
  sql: await import('node:fs').then(fs => fs.readFileSync(new URL('./migrations/003-exercises.sql', import.meta.url), 'utf8')),
}];

const purposes = new Set<ExercisePurpose>(['planned', 'special', 'inspection', 'research', 'exposition', 'custom']);
const scales = new Set<ExerciseScale>(['tactical', 'operational', 'strategic', 'custom']);
const validations = new Set<ExerciseValidation>(['NOT_RUN', 'OK', 'WARNING', 'ERROR']);
const editableStates = new Set<ExerciseRevision['state']>(['DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED', 'CANCELLED']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code: ExerciseStoreErrorCode, message: string): never { throw new ExerciseStoreError(code, message); }
function clone<T>(value: T): T { return structuredClone(value); }
function digest(payload: JsonValue): string { return createHash('sha256').update(canonicalJson(payload)).digest('hex'); }
function instant(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function checkDate(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('VALIDATION', `Укажите корректную дату: ${label}`);
}
function validateRevisionInput(input: CreateRevisionInput): void {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'Проверьте данные учения');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('VALIDATION', 'Укажите ожидаемую редакцию');
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) fail('VALIDATION', 'Введите название учения');
  if (input.purpose !== undefined && !purposes.has(input.purpose)) fail('VALIDATION', 'Выберите назначение учения');
  if (input.scale !== undefined && !scales.has(input.scale)) fail('VALIDATION', 'Выберите масштаб учения');
  if (input.state !== undefined && !editableStates.has(input.state)) fail('VALIDATION', 'Недопустимое состояние редакции');
  if (input.validation !== undefined && !validations.has(input.validation)) fail('VALIDATION', 'Недопустимый результат проверки');
  if (input.readiness !== undefined && (!Number.isSafeInteger(input.readiness) || input.readiness < 0 || input.readiness > 100)) {
    fail('VALIDATION', 'Готовность должна быть целым числом от 0 до 100');
  }
  checkDate(input.startsAt, 'начало');
  checkDate(input.endsAt, 'окончание');
}
function validateCreate(input: CreateExerciseInput): void {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'Проверьте данные учения');
  validateRevisionInput({ ...input, expectedRevision: 1 });
  if (typeof input.title !== 'string' || !input.title.trim()) fail('VALIDATION', 'Введите название учения');
  if (!purposes.has(input.purpose)) fail('VALIDATION', 'Выберите назначение учения');
  if (!scales.has(input.scale)) fail('VALIDATION', 'Выберите масштаб учения');
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    fail('VALIDATION', 'Окончание должно следовать за началом');
  }
}
function validateCopyTitle(title: unknown): void {
  if (title !== undefined && typeof title !== 'string') fail('VALIDATION', 'Название копии должно быть строкой');
}
function validateSessionInput(input: CreateSessionInput): void {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'Проверьте данные сеанса');
  validateRevisionInput({ expectedRevision: input.revision });
}
function copyUuids(value: JsonValue, ids: Map<string, string>): JsonValue {
  if (typeof value === 'string' && uuidPattern.test(value)) {
    const replacement = ids.get(value) ?? randomUUID();
    ids.set(value, replacement);
    return replacement;
  }
  if (Array.isArray(value)) return value.map(item => copyUuids(item, ids));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyUuids(item, ids)]));
  }
  return value;
}
function summaryOf(card: ExerciseCard): ExerciseSummary {
  const { revisions: _revisions, sessions: _sessions, ...summary } = card;
  return clone(summary);
}
function matches(card: ExerciseCard, filters: ExerciseFilters): boolean {
  const query = filters.query?.trim().toLocaleLowerCase('ru');
  return (!query || card.title.toLocaleLowerCase('ru').includes(query) || card.ownerId.toLocaleLowerCase('ru').includes(query))
    && (!filters.state || card.state === filters.state)
    && (!filters.scale || card.scale === filters.scale)
    && (!filters.purpose || card.purpose === filters.purpose)
    && (filters.includeArchived || filters.state === 'ARCHIVED' || card.state !== 'ARCHIVED');
}

type MutableExercise = {
  -readonly [K in keyof ExerciseCard]: ExerciseCard[K] extends readonly unknown[] ? ExerciseCard[K] : ExerciseCard[K];
};

function publicCard(record: ExerciseCard): ExerciseCard {
  return clone({
    ...record,
    lastSessionId: record.sessions.at(-1)?.id ?? null,
    revisions: [...record.revisions].sort((a, b) => a.revision - b.revision),
    sessions: [...record.sessions],
  });
}

function copiedCard(source: ExerciseCard, actor: ExerciseActor, now: string, title?: string): ExerciseCard {
  const exerciseId = randomUUID();
  const ids = new Map<string, string>([[source.id, exerciseId]]);
  const revisionIds = new Map(source.revisions.map(revision => [revision.id, randomUUID()] as const));
  for (const [oldId, newId] of revisionIds) ids.set(oldId, newId);
  const revisions = source.revisions.map(revision => {
    const id = revisionIds.get(revision.id)!;
    const payload = copyUuids(clone(revision.payload), ids);
    return {
      ...clone(revision),
      id,
      exerciseId,
      payload,
      sha256: digest(payload),
      createdBy: actor.userId,
      createdAt: now,
      supersedesId: revision.supersedesId ? revisionIds.get(revision.supersedesId) ?? null : null,
    };
  });
  return {
    ...summaryOf(source),
    id: exerciseId,
    title: title?.trim() || `Копия — ${source.title}`,
    state: 'DRAFT',
    readiness: 0,
    validation: 'NOT_RUN',
    ownerId: actor.userId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    lastSessionId: null,
    revisions,
    sessions: [],
  };
}

export class InMemoryExerciseStore implements ExerciseStore {
  private readonly records = new Map<string, ExerciseCard>();
  private readonly now: () => Date;
  constructor(options: { now?: () => Date } = {}) { this.now = options.now ?? (() => new Date()); }
  private key(organizationId: string, exerciseId: string): string { return `${organizationId}/${exerciseId}`; }
  private required(organizationId: string, exerciseId: string): ExerciseCard {
    const record = this.records.get(this.key(organizationId, exerciseId));
    if (!record) fail('NOT_FOUND', 'Учение не найдено');
    return record;
  }

  async create(actor: ExerciseActor, input: CreateExerciseInput): Promise<ExerciseCard> {
    validateCreate(input);
    const now = this.now().toISOString();
    const exerciseId = randomUUID();
    const payload = clone(input.payload ?? {});
    const record: ExerciseCard = {
      id: exerciseId,
      title: input.title.trim(),
      purpose: input.purpose,
      scale: input.scale,
      state: 'DRAFT',
      revision: 1,
      ownerId: actor.userId,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      readiness: 0,
      validation: 'NOT_RUN',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      lastSessionId: null,
      revisions: [{
        id: randomUUID(), exerciseId, revision: 1, payload, sha256: digest(payload), state: 'DRAFT',
        createdBy: actor.userId, createdAt: now, supersedesId: null,
      }],
      sessions: [],
    };
    this.records.set(this.key(actor.organizationId, exerciseId), record);
    return publicCard(record);
  }

  async list(organizationId: string, filters: ExerciseFilters): Promise<readonly ExerciseSummary[]> {
    return [...this.records.entries()]
      .filter(([key, record]) => key === this.key(organizationId, record.id))
      .map(([, record]) => publicCard(record))
      .filter(record => matches(record, filters))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .map(summaryOf);
  }

  async get(organizationId: string, exerciseId: string): Promise<ExerciseCard | null> {
    const record = this.records.get(this.key(organizationId, exerciseId));
    return record ? publicCard(record) : null;
  }

  async copy(actor: ExerciseActor, exerciseId: string, title?: string): Promise<ExerciseCard> {
    validateCopyTitle(title);
    const source = publicCard(this.required(actor.organizationId, exerciseId));
    const copy = copiedCard(source, actor, this.now().toISOString(), title);
    this.records.set(this.key(actor.organizationId, copy.id), copy);
    return publicCard(copy);
  }

  async archive(actor: ExerciseActor, exerciseId: string, expectedRevision: number): Promise<ExerciseCard> {
    validateRevisionInput({ expectedRevision });
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    if (record.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    const now = this.now().toISOString();
    record.state = 'ARCHIVED';
    record.archivedAt = now;
    record.updatedAt = now;
    return publicCard(record);
  }

  async createRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput): Promise<ExerciseCard> {
    validateRevisionInput(input);
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    if (record.state === 'ARCHIVED') fail('ARCHIVED', 'Архивное учение нельзя изменить');
    if (record.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    const startsAt = input.startsAt === undefined ? record.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? record.endsAt : input.endsAt;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail('VALIDATION', 'Окончание должно следовать за началом');
    const now = this.now().toISOString();
    const previous = record.revisions.find(revision => revision.revision === record.revision)!;
    const payload = clone(input.payload ?? previous.payload);
    const state = input.state ?? 'DRAFT';
    const revision: ExerciseRevision = {
      id: randomUUID(), exerciseId, revision: record.revision + 1, payload, sha256: digest(payload), state,
      createdBy: actor.userId, createdAt: now, supersedesId: previous.id,
    };
    record.title = input.title?.trim() ?? record.title;
    record.purpose = input.purpose ?? record.purpose;
    record.scale = input.scale ?? record.scale;
    record.startsAt = startsAt;
    record.endsAt = endsAt;
    record.state = state;
    record.readiness = input.readiness ?? record.readiness;
    record.validation = input.validation ?? record.validation;
    record.revision = revision.revision;
    record.updatedAt = now;
    (record.revisions as ExerciseRevision[]).push(revision);
    return publicCard(record);
  }

  async createSession(actor: ExerciseActor, exerciseId: string, input: CreateSessionInput): Promise<ExerciseSession> {
    validateSessionInput(input);
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    if (record.state === 'ARCHIVED') fail('ARCHIVED', 'Для архивного учения нельзя создать сеанс');
    const revision = record.revisions.find(item => item.revision === input.revision);
    if (!revision) fail('REVISION_NOT_FOUND', 'Редакция сценария не найдена');
    const session: ExerciseSession = {
      id: randomUUID(), exerciseId, scenarioRevisionId: revision.id, revision: revision.revision,
      state: 'ACTIVE', mode: 'NETWORK', authority: 'SERVER', confirmedRevision: 0,
      createdBy: actor.userId, createdAt: this.now().toISOString(),
    };
    (record.sessions as ExerciseSession[]).push(session);
    record.lastSessionId = session.id;
    record.updatedAt = session.createdAt;
    return clone(session);
  }

  async getSession(organizationId: string, exerciseId: string, sessionId: string): Promise<ExerciseSession | null> {
    const session = this.records.get(this.key(organizationId, exerciseId))?.sessions.find(item => item.id === sessionId);
    return session ? clone(session) : null;
  }

  async listSessions(organizationId: string, exerciseId: string): Promise<readonly ExerciseSession[]> {
    return clone(this.records.get(this.key(organizationId, exerciseId))?.sessions ?? []);
  }
}

type Queryable = Pool | Client;
type ExerciseRow = Record<string, any>;

const exerciseColumns = `id, title, purpose, scale, state, revision, owner_id, starts_at, ends_at,
  readiness, validation, created_at, updated_at, archived_at`;
function mapSummary(row: ExerciseRow): ExerciseSummary {
  return {
    id: row.id, title: row.title, purpose: row.purpose, scale: row.scale, state: row.state,
    revision: Number(row.revision), ownerId: row.owner_id,
    startsAt: row.starts_at ? instant(row.starts_at) : null, endsAt: row.ends_at ? instant(row.ends_at) : null,
    readiness: Number(row.readiness), validation: row.validation,
    createdAt: instant(row.created_at), updatedAt: instant(row.updated_at),
    archivedAt: row.archived_at ? instant(row.archived_at) : null, lastSessionId: row.last_session_id ?? null,
  };
}
function mapRevision(row: ExerciseRow): ExerciseRevision {
  return {
    id: row.id, exerciseId: row.exercise_id, revision: Number(row.revision), payload: row.payload,
    sha256: row.sha256, state: row.state, createdBy: row.created_by, createdAt: instant(row.created_at),
    supersedesId: row.supersedes_id ?? null,
  };
}
function mapSession(row: ExerciseRow): ExerciseSession {
  return {
    id: row.id, exerciseId: row.exercise_id, scenarioRevisionId: row.scenario_revision_id,
    revision: Number(row.revision), state: row.state, mode: row.mode, authority: row.authority,
    confirmedRevision: Number(row.confirmed_revision), createdBy: row.created_by, createdAt: instant(row.created_at),
  };
}
async function lockExercise(db: Queryable, schema: string, organizationId: string, exerciseId: string): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`${organizationId}/${exerciseId}`]);
  const result = await db.query(`select id from ${schema}.exercises where organization_id=$1 and id=$2 for update`, [organizationId, exerciseId]);
  if (!result.rows[0]) fail('NOT_FOUND', 'Учение не найдено');
}
async function readCard(db: Queryable, schema: string, organizationId: string, exerciseId: string): Promise<ExerciseCard | null> {
  const exercise = await db.query(
    `select ${exerciseColumns}, (select id from ${schema}.exercise_sessions s where s.organization_id=e.organization_id and s.exercise_id=e.id order by created_at desc, id desc limit 1) last_session_id
     from ${schema}.exercises e where organization_id=$1 and id=$2`,
    [organizationId, exerciseId],
  );
  if (!exercise.rows[0]) return null;
  const [revisions, sessions] = await Promise.all([
    db.query(`select * from ${schema}.exercise_revisions where organization_id=$1 and exercise_id=$2 order by revision`, [organizationId, exerciseId]),
    db.query(`select * from ${schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 order by created_at, id`, [organizationId, exerciseId]),
  ]);
  return {
    ...mapSummary(exercise.rows[0]),
    revisions: revisions.rows.map(mapRevision),
    sessions: sessions.rows.map(mapSession),
  };
}
async function requiredCard(db: Queryable, schema: string, organizationId: string, exerciseId: string): Promise<ExerciseCard> {
  const card = await readCard(db, schema, organizationId, exerciseId);
  if (!card) fail('NOT_FOUND', 'Учение не найдено');
  return card;
}
async function insertCard(db: Queryable, schema: string, organizationId: string, card: ExerciseCard): Promise<void> {
  await db.query(
    `insert into ${schema}.exercises (organization_id, id, title, purpose, scale, state, revision, owner_id, starts_at, ends_at,
      readiness, validation, created_at, updated_at, archived_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [organizationId, card.id, card.title, card.purpose, card.scale, card.state, card.revision, card.ownerId, card.startsAt, card.endsAt,
      card.readiness, card.validation, card.createdAt, card.updatedAt, card.archivedAt],
  );
  for (const revision of card.revisions) {
    await db.query(
      `insert into ${schema}.exercise_revisions (organization_id, id, exercise_id, revision, payload, sha256, state, created_by, created_at, supersedes_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [organizationId, revision.id, card.id, revision.revision, revision.payload, revision.sha256, revision.state, revision.createdBy, revision.createdAt, revision.supersedesId],
    );
  }
}

export class PgExerciseStore implements ExerciseStore {
  readonly pool: Pool;
  readonly schema: string;
  constructor(options: { pool?: Pool; url?: string; schema?: string } = {}) {
    this.pool = options.pool ?? createPool(options.url);
    this.schema = options.schema ?? 'kshvi';
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) throw new Error('Недопустимое имя схемы КШВИ');
  }
  async init(): Promise<void> { await migrate(this.pool, this.schema, KSHVI_EXERCISE_MIGRATIONS); }

  async create(actor: ExerciseActor, input: CreateExerciseInput): Promise<ExerciseCard> {
    validateCreate(input);
    return tx(this.pool, async db => {
      const now = new Date().toISOString();
      const exerciseId = randomUUID();
      const payload = clone(input.payload ?? {});
      const card: ExerciseCard = {
        id: exerciseId, title: input.title.trim(), purpose: input.purpose, scale: input.scale,
        state: 'DRAFT', revision: 1, ownerId: actor.userId, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
        readiness: 0, validation: 'NOT_RUN', createdAt: now, updatedAt: now, archivedAt: null, lastSessionId: null,
        revisions: [{ id: randomUUID(), exerciseId, revision: 1, payload, sha256: digest(payload), state: 'DRAFT', createdBy: actor.userId, createdAt: now, supersedesId: null }],
        sessions: [],
      };
      await insertCard(db, this.schema, actor.organizationId, card);
      return card;
    });
  }

  async list(organizationId: string, filters: ExerciseFilters): Promise<readonly ExerciseSummary[]> {
    const values: unknown[] = [organizationId];
    const where = ['e.organization_id=$1'];
    if (!filters.includeArchived && filters.state !== 'ARCHIVED') where.push(`e.state<>'ARCHIVED'`);
    if (filters.query?.trim()) {
      values.push(`%${filters.query.trim()}%`);
      where.push(`(e.title ilike $${values.length} or e.owner_id ilike $${values.length})`);
    }
    if (filters.state) { values.push(filters.state); where.push(`e.state=$${values.length}`); }
    if (filters.scale) { values.push(filters.scale); where.push(`e.scale=$${values.length}`); }
    if (filters.purpose) { values.push(filters.purpose); where.push(`e.purpose=$${values.length}`); }
    const result = await this.pool.query(
      `select ${exerciseColumns}, (select id from ${this.schema}.exercise_sessions s where s.organization_id=e.organization_id and s.exercise_id=e.id order by created_at desc, id desc limit 1) last_session_id
       from ${this.schema}.exercises e where ${where.join(' and ')} order by e.updated_at desc, e.id`,
      values,
    );
    return result.rows.map(mapSummary);
  }

  async get(organizationId: string, exerciseId: string): Promise<ExerciseCard | null> {
    return readCard(this.pool, this.schema, organizationId, exerciseId);
  }

  async copy(actor: ExerciseActor, exerciseId: string, title?: string): Promise<ExerciseCard> {
    validateCopyTitle(title);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const source = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      const copy = copiedCard(source, actor, new Date().toISOString(), title);
      await insertCard(db, this.schema, actor.organizationId, copy);
      return copy;
    });
  }

  async archive(actor: ExerciseActor, exerciseId: string, expectedRevision: number): Promise<ExerciseCard> {
    validateRevisionInput({ expectedRevision });
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      if (current.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
      const now = new Date().toISOString();
      await db.query(`update ${this.schema}.exercises set state='ARCHIVED', archived_at=$3, updated_at=$3 where organization_id=$1 and id=$2`, [actor.organizationId, exerciseId, now]);
      return requiredCard(db, this.schema, actor.organizationId, exerciseId);
    });
  }

  async createRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput): Promise<ExerciseCard> {
    validateRevisionInput(input);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      if (current.state === 'ARCHIVED') fail('ARCHIVED', 'Архивное учение нельзя изменить');
      if (current.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
      const startsAt = input.startsAt === undefined ? current.startsAt : input.startsAt;
      const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail('VALIDATION', 'Окончание должно следовать за началом');
      const previous = current.revisions.find(revision => revision.revision === current.revision)!;
      const now = new Date().toISOString();
      const payload = clone(input.payload ?? previous.payload);
      const revision: ExerciseRevision = {
        id: randomUUID(), exerciseId, revision: current.revision + 1, payload, sha256: digest(payload),
        state: input.state ?? 'DRAFT', createdBy: actor.userId, createdAt: now, supersedesId: previous.id,
      };
      await db.query(
        `insert into ${this.schema}.exercise_revisions (organization_id, id, exercise_id, revision, payload, sha256, state, created_by, created_at, supersedes_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [actor.organizationId, revision.id, exerciseId, revision.revision, payload, revision.sha256, revision.state, revision.createdBy, now, previous.id],
      );
      await db.query(
        `update ${this.schema}.exercises set title=$3, purpose=$4, scale=$5, starts_at=$6, ends_at=$7, state=$8,
         readiness=$9, validation=$10, revision=$11, updated_at=$12 where organization_id=$1 and id=$2`,
        [actor.organizationId, exerciseId, input.title?.trim() ?? current.title, input.purpose ?? current.purpose, input.scale ?? current.scale,
          startsAt, endsAt, revision.state, input.readiness ?? current.readiness, input.validation ?? current.validation, revision.revision, now],
      );
      return requiredCard(db, this.schema, actor.organizationId, exerciseId);
    });
  }

  async createSession(actor: ExerciseActor, exerciseId: string, input: CreateSessionInput): Promise<ExerciseSession> {
    validateSessionInput(input);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      if (current.state === 'ARCHIVED') fail('ARCHIVED', 'Для архивного учения нельзя создать сеанс');
      const revision = current.revisions.find(item => item.revision === input.revision);
      if (!revision) fail('REVISION_NOT_FOUND', 'Редакция сценария не найдена');
      const session: ExerciseSession = {
        id: randomUUID(), exerciseId, scenarioRevisionId: revision.id, revision: revision.revision,
        state: 'ACTIVE', mode: 'NETWORK', authority: 'SERVER', confirmedRevision: 0,
        createdBy: actor.userId, createdAt: new Date().toISOString(),
      };
      await db.query(
        `insert into ${this.schema}.exercise_sessions (organization_id, id, exercise_id, scenario_revision_id, revision, state, mode, authority, confirmed_revision, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [actor.organizationId, session.id, exerciseId, revision.id, revision.revision, session.state, session.mode, session.authority, 0, actor.userId, session.createdAt],
      );
      await db.query(`update ${this.schema}.exercises set updated_at=$3 where organization_id=$1 and id=$2`, [actor.organizationId, exerciseId, session.createdAt]);
      return session;
    });
  }

  async getSession(organizationId: string, exerciseId: string, sessionId: string): Promise<ExerciseSession | null> {
    const result = await this.pool.query(`select * from ${this.schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 and id=$3`, [organizationId, exerciseId, sessionId]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listSessions(organizationId: string, exerciseId: string): Promise<readonly ExerciseSession[]> {
    const result = await this.pool.query(`select * from ${this.schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 order by created_at, id`, [organizationId, exerciseId]);
    return result.rows.map(mapSession);
  }
}
