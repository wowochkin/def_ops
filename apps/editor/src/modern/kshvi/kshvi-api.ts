import type { ExpositionSession } from '../../../../../packages/kshvi/src/exposition/exposition-session';
import type { AtlasMeta, EnvironmentSelection, EnvironmentSnapshot } from '../../../../../packages/kshvi/src/environment/provider';
import type { InitialSituationMap } from '../../../../../packages/kshvi/src/scenario/initial-map';
import type { SymbolSet } from '../../../../../packages/tactical-symbols/src/model';
import type { AudienceProjectionView } from './exposition/AudienceProjector';
import type { AdminOverviewService } from '../../../../../services/kshvi/src/admin/admin-overview-service';

export type ExercisePurpose = 'planned' | 'special' | 'inspection' | 'research' | 'exposition' | 'custom';
export type ExerciseScale = 'tactical' | 'operational' | 'strategic' | 'custom';
export type ExerciseState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SEALED' | 'CANCELLED' | 'ARCHIVED';
export type ExerciseValidation = 'NOT_RUN' | 'OK' | 'WARNING' | 'ERROR';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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

export type ExerciseFilters = Readonly<{
  query?: string;
  state?: ExerciseState;
  scale?: ExerciseScale;
  purpose?: ExercisePurpose;
  includeArchived?: boolean;
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
  payload?: JsonValue;
}>;

export type Participant = Readonly<{
  localMode?:boolean;
  userId: string;
  activeRole: string | null;
  organizationId: string;
  authorities: readonly string[];
}>;
export type RoleOption = Readonly<{ id: string; role: string; sideId: string | null }>;
export type LoginResult = Readonly<{ csrfToken: string; participant: Participant; roles: readonly RoleOption[] }>;

export type SessionCommand = 'PAUSE' | 'RESUME' | 'PRIVATE_STOP' | 'GENERAL_STOP' | 'JUMP' | 'COMPLETE' | 'ABORT';
export type ReplayFrame = Readonly<{
  sequence: number;
  maxSequence: number;
  operationalAt: string;
  wallClockAt: string;
  perspective: 'PARTICIPANT' | 'TRUTH';
  source: 'TRUTH' | 'RECORDED_PARTICIPANT_PROJECTION';
  stateHash: string | null;
  domains: Record<string, unknown>;
  events: readonly { eventId: string; type: string; sequence: number }[];
}>;
export type DebriefRecord = Readonly<{ scope: 'GENERAL' | 'PRIVATE'; revision: number; audience: readonly string[]; referenceIntent: string }>;
export type AssessmentRecord = Readonly<{ status: 'DRAFT' | 'APPROVED'; finalAssessment: string | null; finalComment: string | null; confirmation: { id: string; role: string; confirmedAt: string } | null }>;
export type ArchiveRecord = Readonly<{ archiveId: string; manifestSha256: string; mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH'; missing: readonly string[] }>;
export type ExpositionRecord = Readonly<{ purpose: 'EXPOSITION'; session: ExpositionSession; projection: AudienceProjectionView }>;
export type AdminOverview = Awaited<ReturnType<AdminOverviewService['overview']>>;

export interface KshviClient {
  hasCsrfToken?():boolean;
  loginLocal?():Promise<LoginResult>;
  login(username: string, password: string): Promise<LoginResult>;
  selectRole(roleId: string): Promise<Participant>;
  logout(): Promise<void>;
  me(): Promise<Participant>;
  list(filters?: ExerciseFilters): Promise<readonly ExerciseSummary[]>;
  getCard(exerciseId: string): Promise<ExerciseCard>;
  create(input: CreateExerciseInput): Promise<ExerciseCard>;
  copy(exerciseId: string, title?: string): Promise<ExerciseCard>;
  archive(exerciseId: string, expectedRevision: number): Promise<ExerciseCard>;
  createRevision(exerciseId: string, input: CreateRevisionInput): Promise<ExerciseCard>;
  listEnvironmentAtlases(): Promise<readonly AtlasMeta[]>;
  createEnvironmentSnapshot(input: EnvironmentSelection): Promise<EnvironmentSnapshot>;
  symbolCatalog(): Promise<{ set: SymbolSet }>;
  approveInitialMap(exerciseId: string, input: { expectedRevision: number; map: InitialSituationMap }): Promise<{ sha256: string }>;
  listSessions(exerciseId: string): Promise<readonly ExerciseSession[]>;
  getSession(exerciseId: string, sessionId: string): Promise<ExerciseSession>;
  createSession(exerciseId: string, input: { revision: number }): Promise<ExerciseSession>;
  command(exerciseId: string, sessionId: string, input: { command: SessionCommand; expectedRevision: number; idempotencyKey: string }): Promise<ExerciseSession>;
  replay(exerciseId: string, sessionId: string, input?: { cursor?: number; perspective?: 'PARTICIPANT' | 'TRUTH' }): Promise<ReplayFrame>;
  debrief(exerciseId: string, sessionId: string, scope: 'GENERAL' | 'PRIVATE'): Promise<DebriefRecord>;
  approveAssessment(exerciseId: string, sessionId: string, input: { finalAssessment: string; comment: string; idempotencyKey: string }): Promise<AssessmentRecord>;
  createArchive(exerciseId: string, sessionId: string): Promise<ArchiveRecord>;
  exportArchive(archiveId: string): Promise<unknown>;
  exposition(archiveId: string): Promise<ExpositionRecord>;
  adminOverview(): Promise<AdminOverview>;
  blockAccount(accountId: string): Promise<unknown>;
  archiveAccount(accountId: string): Promise<unknown>;
  revokeAssignment(assignmentId: string): Promise<unknown>;
  exportAudit(): Promise<readonly unknown[]>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ExerciseClientOptions = {
  baseUrl?: string;
  fetch?: Fetcher;
  csrfToken?: () => string;
  headers?: () => Readonly<Record<string, string>>;
};

export class KshviHttpError extends Error{
 constructor(readonly status:number,message:string){super(message);this.name='KshviHttpError';}
}

/** Клиент ждёт подтверждения каждой команды; локальный мир здесь не объявляется официальным. */
export class ExerciseClient implements KshviClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly csrfToken: () => string;
  private readonly extraHeaders: () => Readonly<Record<string, string>>;
  private sessionCsrfToken = '';

  constructor(options: ExerciseClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/kshvi').replace(/\/$/, '');
    try { this.sessionCsrfToken = globalThis.sessionStorage?.getItem(`def_ops.kshvi.csrf:${this.baseUrl}`) ?? ''; } catch { this.sessionCsrfToken = ''; }
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.csrfToken = options.csrfToken ?? (() => '');
    this.extraHeaders = options.headers ?? (() => ({}));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      ...this.extraHeaders(),
      'X-Source-System': 'kshvi-editor',
      'X-CSRF-Token': this.sessionCsrfToken || this.csrfToken(),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw new KshviHttpError(response.status,data?.error?.message ?? `Сервис КШВИ недоступен (${response.status}). Повторите действие после восстановления связи.`);
    }
    return data as T;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const result = await this.request<LoginResult>('POST', '/auth/login', { username, password });
    this.sessionCsrfToken = result.csrfToken;
    try { globalThis.sessionStorage?.setItem(`def_ops.kshvi.csrf:${this.baseUrl}`, result.csrfToken); } catch { /* память текущей вкладки недоступна */ }
    return result;
  }
  hasCsrfToken():boolean{return Boolean(this.sessionCsrfToken||this.csrfToken());}
  async loginLocal():Promise<LoginResult>{
    const result=await this.request<LoginResult>('POST','/auth/local',{});
    this.sessionCsrfToken=result.csrfToken;
    try{globalThis.sessionStorage?.setItem(`def_ops.kshvi.csrf:${this.baseUrl}`,result.csrfToken);}catch{/* память вкладки недоступна */}
    return result;
  }
  selectRole(roleId: string): Promise<Participant> { return this.request('POST', '/auth/role', { roleId }); }
  async logout(): Promise<void> {
    try { await this.request('POST', '/auth/logout'); }
    finally {
      this.sessionCsrfToken = '';
      try { globalThis.sessionStorage?.removeItem(`def_ops.kshvi.csrf:${this.baseUrl}`); } catch { /* память текущей вкладки недоступна */ }
    }
  }
  me(): Promise<Participant> { return this.request('GET', '/auth/me'); }
  async list(filters: ExerciseFilters = {}): Promise<readonly ExerciseSummary[]> {
    const query = new URLSearchParams();
    if (filters.query?.trim()) query.set('query', filters.query.trim());
    if (filters.state) query.set('state', filters.state);
    if (filters.scale) query.set('scale', filters.scale);
    if (filters.purpose) query.set('purpose', filters.purpose);
    if (filters.includeArchived) query.set('includeArchived', 'true');
    const suffix = query.size ? `?${query}` : '';
    const result = await this.request<{ items: ExerciseSummary[] }>('GET', `/exercises${suffix}`);
    return result.items;
  }
  getCard(exerciseId: string): Promise<ExerciseCard> { return this.request('GET', `/exercises/${encodeURIComponent(exerciseId)}`); }
  create(input: CreateExerciseInput): Promise<ExerciseCard> { return this.request('POST', '/exercises', input); }
  copy(exerciseId: string, title?: string): Promise<ExerciseCard> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/copies`, { title });
  }
  archive(exerciseId: string, expectedRevision: number): Promise<ExerciseCard> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/archive`, { expectedRevision });
  }
  createRevision(exerciseId: string, input: CreateRevisionInput): Promise<ExerciseCard> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/revisions`, input);
  }
  listEnvironmentAtlases(): Promise<readonly AtlasMeta[]> { return this.request('GET', '/environment/atlases'); }
  createEnvironmentSnapshot(input: EnvironmentSelection): Promise<EnvironmentSnapshot> {
    return this.request('POST', '/environment/snapshots', input);
  }
  symbolCatalog(): Promise<{ set: SymbolSet }> { return this.request('GET', '/symbols/catalog'); }
  approveInitialMap(exerciseId: string, input: { expectedRevision: number; map: InitialSituationMap }): Promise<{ sha256: string }> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/map-approval`, input);
  }
  async listSessions(exerciseId: string): Promise<readonly ExerciseSession[]> {
    const result = await this.request<{ items: ExerciseSession[] }>('GET', `/exercises/${encodeURIComponent(exerciseId)}/sessions`);
    return result.items;
  }
  getSession(exerciseId: string, sessionId: string): Promise<ExerciseSession> {
    return this.request('GET', `/exercises/${encodeURIComponent(exerciseId)}/sessions/${encodeURIComponent(sessionId)}`);
  }
  createSession(exerciseId: string, input: { revision: number }): Promise<ExerciseSession> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/sessions`, { revision: input.revision });
  }
  command(exerciseId: string, sessionId: string, input: { command: SessionCommand; expectedRevision: number; idempotencyKey: string }): Promise<ExerciseSession> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/sessions/${encodeURIComponent(sessionId)}/commands`, input);
  }
  replay(exerciseId: string, sessionId: string, input: { cursor?: number; perspective?: 'PARTICIPANT' | 'TRUTH' } = {}): Promise<ReplayFrame> {
    const query = new URLSearchParams({ cursor: String(input.cursor ?? 0), perspective: input.perspective ?? 'PARTICIPANT' });
    return this.request('GET', `/exercises/${encodeURIComponent(exerciseId)}/sessions/${encodeURIComponent(sessionId)}/replay?${query}`);
  }
  debrief(exerciseId: string, sessionId: string, scope: 'GENERAL' | 'PRIVATE'): Promise<DebriefRecord> {
    return this.request('GET', `/exercises/${encodeURIComponent(exerciseId)}/sessions/${encodeURIComponent(sessionId)}/debrief?scope=${scope}`);
  }
  approveAssessment(exerciseId: string, sessionId: string, input: { finalAssessment: string; comment: string; idempotencyKey: string }): Promise<AssessmentRecord> {
    return this.request('POST', `/exercises/${encodeURIComponent(exerciseId)}/sessions/${encodeURIComponent(sessionId)}/debrief/assessment`, input);
  }
  createArchive(exerciseId: string, sessionId: string): Promise<ArchiveRecord> {
    return this.request('POST', '/archives', { exerciseId, sessionId });
  }
  exportArchive(archiveId: string): Promise<unknown> { return this.request('GET', `/archives/${encodeURIComponent(archiveId)}/export`); }
  exposition(archiveId: string): Promise<ExpositionRecord> { return this.request('GET', `/expositions/${encodeURIComponent(archiveId)}`); }
  adminOverview(): Promise<AdminOverview> { return this.request('GET', '/admin/overview'); }
  blockAccount(accountId: string): Promise<unknown> { return this.request('POST', `/admin/accounts/${encodeURIComponent(accountId)}/block`, {}); }
  archiveAccount(accountId: string): Promise<unknown> { return this.request('POST', `/admin/accounts/${encodeURIComponent(accountId)}/archive`, {}); }
  revokeAssignment(assignmentId: string): Promise<unknown> { return this.request('POST', `/admin/assignments/${encodeURIComponent(assignmentId)}/revoke`, {}); }
  async exportAudit(): Promise<readonly unknown[]> {
    const result = await this.request<{ items: unknown[] }>('POST', '/admin/audit/export', {});
    return result.items;
  }
}
