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
  userId: string;
  activeRole: string | null;
  organizationId: string;
  authorities: readonly string[];
}>;

export interface KshviClient {
  me(): Promise<Participant>;
  list(filters?: ExerciseFilters): Promise<readonly ExerciseSummary[]>;
  getCard(exerciseId: string): Promise<ExerciseCard>;
  create(input: CreateExerciseInput): Promise<ExerciseCard>;
  copy(exerciseId: string, title?: string): Promise<ExerciseCard>;
  archive(exerciseId: string, expectedRevision: number): Promise<ExerciseCard>;
  createRevision(exerciseId: string, input: CreateRevisionInput): Promise<ExerciseCard>;
  listSessions(exerciseId: string): Promise<readonly ExerciseSession[]>;
  getSession(exerciseId: string, sessionId: string): Promise<ExerciseSession>;
  createSession(exerciseId: string, input: { revision: number }): Promise<ExerciseSession>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ExerciseClientOptions = {
  baseUrl?: string;
  fetch?: Fetcher;
  csrfToken?: () => string;
  headers?: () => Readonly<Record<string, string>>;
};

/** Клиент ждёт подтверждения каждой команды; локальный мир здесь не объявляется официальным. */
export class ExerciseClient implements KshviClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly csrfToken: () => string;
  private readonly extraHeaders: () => Readonly<Record<string, string>>;

  constructor(options: ExerciseClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/kshvi').replace(/\/$/, '');
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.csrfToken = options.csrfToken ?? (() => '');
    this.extraHeaders = options.headers ?? (() => ({}));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      ...this.extraHeaders(),
      'X-Source-System': 'kshvi-editor',
      'X-CSRF-Token': this.csrfToken(),
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
      throw new Error(data?.error?.message ?? `Сервис КШВИ недоступен (${response.status}). Повторите действие после восстановления связи.`);
    }
    return data as T;
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
}
