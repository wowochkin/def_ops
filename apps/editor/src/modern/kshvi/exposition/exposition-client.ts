import type {
  ExpositionPresenterSession,
  ExpositionProgram,
  PresenterCommand,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import type { AudienceProjectionView } from './AudienceProjector';
import { readSessionCsrf } from '../session-csrf';

export interface ExpositionApi {
  start(input: Readonly<{ source: 'ARCHIVE' | 'AUTONOMOUS'; seed?: number; sessionId?: string; branchId?: string }>): Promise<ExpositionPresenterSession>;
  presenter(sessionId: string): Promise<ExpositionPresenterSession>;
  command(sessionId: string, command: PresenterCommand): Promise<ExpositionPresenterSession>;
  continueFromCheckpoint(sessionId: string, checkpointId: string, input: Readonly<{ sessionId?: string; branchId?: string; seed?: number }>): Promise<ExpositionPresenterSession>;
  restart(sessionId: string, input: Readonly<{ mode: 'REPLAY_SAVED_LINE' | 'NEW_BRANCH'; sessionId?: string; branchId?: string; seed?: number }>): Promise<ExpositionPresenterSession>;
  updateProgram(sessionId: string, program: ExpositionProgram): Promise<ExpositionPresenterSession>;
  projector(sessionId: string, projectorId: string): Promise<AudienceProjectionView>;
  presenterProjection(sessionId: string): Promise<AudienceProjectionView>;
  activeProjector(projectorId: string): Promise<AudienceProjectionView>;
  exportArchive(sessionId: string, archiveId?: string): Promise<Readonly<{ schemaVersion: string; archiveId: string }>>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ExpositionClient implements ExpositionApi {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly csrfToken: () => string;
  private readonly extraHeaders: () => Readonly<Record<string, string>>;

  constructor(options: Readonly<{
    baseUrl?: string;
    fetch?: Fetcher;
    csrfToken?: () => string;
    headers?: () => Readonly<Record<string, string>>;
  }> = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/kshvi').replace(/\/$/, '');
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.csrfToken = options.csrfToken ?? (() => readSessionCsrf(this.baseUrl, true));
    this.extraHeaders = options.headers ?? (() => ({}));
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...this.extraHeaders(),
        'X-Source-System': 'kshvi-exposition',
        'X-CSRF-Token': this.csrfToken(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message ?? `Сервер экспозиции недоступен (${response.status})`);
    return data as T;
  }

  start(input: Parameters<ExpositionApi['start']>[0]): Promise<ExpositionPresenterSession> {
    return this.request('POST', '/expositions', input);
  }
  presenter(sessionId: string): Promise<ExpositionPresenterSession> {
    return this.request('GET', `/expositions/${encodeURIComponent(sessionId)}/presenter`);
  }
  command(sessionId: string, command: PresenterCommand): Promise<ExpositionPresenterSession> {
    return this.request('POST', `/expositions/${encodeURIComponent(sessionId)}/commands`, command);
  }
  continueFromCheckpoint(sessionId: string, checkpointId: string, input: Parameters<ExpositionApi['continueFromCheckpoint']>[2]): Promise<ExpositionPresenterSession> {
    return this.request('POST', `/expositions/${encodeURIComponent(sessionId)}/checkpoints/${encodeURIComponent(checkpointId)}/continuations`, input);
  }
  restart(sessionId: string, input: Parameters<ExpositionApi['restart']>[1]): Promise<ExpositionPresenterSession> {
    return this.request('POST', `/expositions/${encodeURIComponent(sessionId)}/restarts`, input);
  }
  updateProgram(sessionId: string, program: ExpositionProgram): Promise<ExpositionPresenterSession> {
    return this.request('PUT', `/expositions/${encodeURIComponent(sessionId)}/program`, program);
  }
  projector(sessionId: string, projectorId: string): Promise<AudienceProjectionView> {
    return this.request('GET', `/expositions/${encodeURIComponent(sessionId)}/projector`, undefined, { 'X-Projector-Id': projectorId });
  }
  presenterProjection(sessionId: string): Promise<AudienceProjectionView> {
    return this.request('GET', `/expositions/${encodeURIComponent(sessionId)}/presenter-projection`);
  }
  activeProjector(projectorId: string): Promise<AudienceProjectionView> {
    return this.request('GET', '/expositions/active/projector', undefined, { 'X-Projector-Id': projectorId });
  }
  exportArchive(sessionId: string, archiveId?: string): Promise<Readonly<{ schemaVersion: string; archiveId: string }>> {
    return this.request('POST', `/expositions/${encodeURIComponent(sessionId)}/exports`, { archiveId });
  }
}
