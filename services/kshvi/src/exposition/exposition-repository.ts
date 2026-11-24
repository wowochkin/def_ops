import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createExpositionProgram, type ExpositionProgram } from '../../../../packages/kshvi/src/exposition/exposition-program';
import type { ExpositionSession, OfficialExpositionArchive } from '../../../../packages/kshvi/src/exposition/exposition-session';

export type ExpositionSessionRecord = Readonly<{
  session: ExpositionSession;
  organizationId: string;
  ownerId: string;
}>;
export type ExpositionHandoff = Readonly<{
  sessionId: string;
  branchId: string;
  generation: number;
}>;

export interface ExpositionRepository {
  officialArchive(): Promise<OfficialExpositionArchive>;
  expositionProgram(): Promise<ExpositionProgram>;
  getSession(sessionId: string): Promise<ExpositionSessionRecord | null>;
  createSession(record: ExpositionSessionRecord): Promise<void>;
  updateSession(record: ExpositionSessionRecord): Promise<void>;
  activeHandoff(organizationId: string): Promise<ExpositionHandoff | null>;
  publishHandoff(organizationId: string, session: ExpositionSession): Promise<ExpositionHandoff>;
}

export class ExpositionSessionConflictError extends Error {}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
}
function archiveContent(archive: OfficialExpositionArchive): unknown {
  const { manifestHash: _manifestHash, ...content } = archive;
  return content;
}

export function sealOfficialExpositionArchive(source: OfficialExpositionArchive): OfficialExpositionArchive {
  const archive = structuredClone(source);
  return { ...archive, manifestHash: digest(archiveContent(archive)) };
}

export function assertOfficialExpositionManifest(archive: OfficialExpositionArchive): void {
  if (archive.manifestHash !== digest(archiveContent(archive))) {
    throw new Error('Официальный архив имеет несоответствующий manifest hash содержимого');
  }
}

type FileState = {
  sessions: ExpositionSessionRecord[];
  handoffs: Record<string, ExpositionHandoff>;
};
const emptyState = (): FileState => ({ sessions: [], handoffs: {} });

export class InMemoryExpositionRepository implements ExpositionRepository {
  private readonly sessions = new Map<string, ExpositionSessionRecord>();
  private readonly handoffs = new Map<string, ExpositionHandoff>();
  private readonly archive: OfficialExpositionArchive;
  private readonly program: ExpositionProgram;

  constructor(input: Readonly<{ archive: OfficialExpositionArchive; program: ExpositionProgram }>) {
    this.archive = structuredClone(input.archive);
    this.program = createExpositionProgram(input.program);
  }
  async officialArchive(): Promise<OfficialExpositionArchive> {
    assertOfficialExpositionManifest(this.archive);
    return structuredClone(this.archive);
  }
  async expositionProgram(): Promise<ExpositionProgram> { return structuredClone(this.program); }
  async getSession(sessionId: string): Promise<ExpositionSessionRecord | null> {
    return structuredClone(this.sessions.get(sessionId) ?? null);
  }
  async createSession(record: ExpositionSessionRecord): Promise<void> {
    if (this.sessions.has(record.session.sessionId)) throw new ExpositionSessionConflictError('Такой sessionId уже существует');
    this.sessions.set(record.session.sessionId, structuredClone(record));
  }
  async updateSession(record: ExpositionSessionRecord): Promise<void> {
    if (!this.sessions.has(record.session.sessionId)) throw new ExpositionSessionConflictError('Обновляемый сеанс не существует');
    this.sessions.set(record.session.sessionId, structuredClone(record));
  }
  async activeHandoff(organizationId: string): Promise<ExpositionHandoff | null> {
    return structuredClone(this.handoffs.get(organizationId) ?? null);
  }
  async publishHandoff(organizationId: string, session: ExpositionSession): Promise<ExpositionHandoff> {
    const generation = (this.handoffs.get(organizationId)?.generation ?? 0) + 1;
    const handoff = { sessionId: session.sessionId, branchId: session.branchId, generation };
    this.handoffs.set(organizationId, handoff);
    return structuredClone(handoff);
  }
}

/** Файловый production-адаптер; источник архива и программа передаются развёртыванием, не зашиты в коде. */
export class FileExpositionRepository implements ExpositionRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: Readonly<{ archivePath: string; programPath: string; statePath: string }>) {}

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  }
  private async state(): Promise<FileState> {
    try {
      const state = await this.readJson<FileState>(this.options.statePath);
      return { sessions: state.sessions ?? [], handoffs: state.handoffs ?? {} };
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return emptyState();
      throw error;
    }
  }
  private async writeState(state: FileState): Promise<void> {
    const path = resolve(this.options.statePath);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${globalThis.crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { flag: 'wx' });
    await rename(temporary, path);
  }

  async officialArchive(): Promise<OfficialExpositionArchive> {
    const archive = await this.readJson<OfficialExpositionArchive>(this.options.archivePath);
    assertOfficialExpositionManifest(archive);
    return archive;
  }
  async expositionProgram(): Promise<ExpositionProgram> {
    return createExpositionProgram(await this.readJson<ExpositionProgram>(this.options.programPath));
  }
  async getSession(sessionId: string): Promise<ExpositionSessionRecord | null> {
    return this.serialize(async () => (await this.state()).sessions.find(record => record.session.sessionId === sessionId) ?? null);
  }
  async createSession(record: ExpositionSessionRecord): Promise<void> {
    return this.serialize(async () => {
      const state = await this.state();
      if (state.sessions.some(item => item.session.sessionId === record.session.sessionId)) {
        throw new ExpositionSessionConflictError('Такой sessionId уже существует');
      }
      state.sessions.push(structuredClone(record));
      await this.writeState(state);
    });
  }
  async updateSession(record: ExpositionSessionRecord): Promise<void> {
    return this.serialize(async () => {
      const state = await this.state();
      const index = state.sessions.findIndex(item => item.session.sessionId === record.session.sessionId);
      if (index < 0) throw new ExpositionSessionConflictError('Обновляемый сеанс не существует');
      state.sessions[index] = structuredClone(record);
      await this.writeState(state);
    });
  }
  async activeHandoff(organizationId: string): Promise<ExpositionHandoff | null> {
    return this.serialize(async () => (await this.state()).handoffs[organizationId] ?? null);
  }
  async publishHandoff(organizationId: string, session: ExpositionSession): Promise<ExpositionHandoff> {
    return this.serialize(async () => {
      const state = await this.state();
      const handoff = {
        sessionId: session.sessionId,
        branchId: session.branchId,
        generation: (state.handoffs[organizationId]?.generation ?? 0) + 1,
      };
      state.handoffs[organizationId] = handoff;
      await this.writeState(state);
      return handoff;
    });
  }
}
