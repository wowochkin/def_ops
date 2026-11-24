import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ContentRef, EnvironmentSnapshot, SnapshotArtifact } from '../../../../packages/kshvi/src/environment/provider';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';

export type SnapshotDraft = Omit<EnvironmentSnapshot, 'id' | 'manifestSha256'>;
export type PreparedContent = Readonly<{ ref: ContentRef; data: Buffer }>;

const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const validHash = (value: string) => /^[0-9a-f]{64}$/.test(value);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function prepareContent(data: Buffer | string, extension: '.json' | '.mbtiles' | '.bin'): { artifact: SnapshotArtifact; content: PreparedContent } {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const sha256 = digest(bytes);
  const ref = { path: `content/${sha256}${extension}`, sha256, bytes: bytes.length } as const;
  return { artifact: { contentRef: ref, sha256 }, content: { ref, data: bytes } };
}

export const emptyArtifact = (): SnapshotArtifact => ({ contentRef: null, sha256: null });

export function assertSnapshotComplete(snapshot: unknown): asserts snapshot is EnvironmentSnapshot {
  const value = snapshot as Partial<EnvironmentSnapshot> & { atlas?: { style?: SnapshotArtifact; export?: SnapshotArtifact; elevations?: SnapshotArtifact } };
  const atlases = value.atlases ?? (value.atlas ? [value.atlas] : []);
  const missing: string[] = [];
  if (!atlases.length) missing.push('наборы карты');
  for (const [index, atlas] of atlases.entries()) {
    if (!atlas?.style?.contentRef) missing.push(`атлас ${index + 1}: стиль`);
    if (!atlas?.export?.contentRef) missing.push(`атлас ${index + 1}: экспорт`);
    if (!atlas?.elevations?.contentRef) missing.push(`атлас ${index + 1}: высоты`);
  }
  if (!value.weather?.contentRef) missing.push('погодный срез');
  if (value.autonomy === 'INCOMPLETE') missing.push(...(value.limitations ?? ['ограничения лицензии']));
  if (missing.length) throw new Error(`Снимок не является автономным: ${missing.join(', ')}`);
}

export class EnvironmentSnapshotStore {
  constructor(readonly root: string) {}

  async create(draft: SnapshotDraft, contents: readonly PreparedContent[]): Promise<EnvironmentSnapshot> {
    const id = digest(canonicalJson(draft));
    const snapshot = freeze({ ...draft, schemaVersion: 1, id, manifestSha256: id } as EnvironmentSnapshot);
    const directory = path.join(this.root, id);
    if (await fs.stat(directory).then(() => true).catch(() => false)) return this.load(id);

    const temporary = path.join(this.root, `.tmp-${id}-${randomUUID()}`);
    await fs.mkdir(path.join(temporary, 'content'), { recursive: true });
    try {
      const written = new Set<string>();
      for (const content of contents) {
        if (content.data.length !== content.ref.bytes || digest(content.data) !== content.ref.sha256) throw new Error('Содержимое снимка не совпадает с SHA-256');
        if (written.has(content.ref.path)) continue;
        written.add(content.ref.path);
        const target = path.join(temporary, content.ref.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content.data, { flag: 'wx' });
      }
      await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(snapshot, null, 2), { flag: 'wx' });
      await fs.mkdir(this.root, { recursive: true });
      await fs.rename(temporary, directory);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.load(id);
      throw error;
    }
    return this.load(id);
  }

  async load(id: string): Promise<EnvironmentSnapshot> {
    if (!validHash(id)) throw new Error('Некорректный идентификатор снимка среды');
    const snapshot = JSON.parse(await fs.readFile(path.join(this.root, id, 'manifest.json'), 'utf8')) as EnvironmentSnapshot;
    const { id: storedId, manifestSha256, ...draft } = snapshot;
    const actual = digest(canonicalJson(draft));
    if (storedId !== id || manifestSha256 !== id || actual !== id) throw new Error('Контрольная сумма манифеста снимка не совпадает');
    if (snapshot.autonomy === 'COMPLETE') assertSnapshotComplete(snapshot);
    const artifacts: SnapshotArtifact[] = [
      ...snapshot.atlases.flatMap(atlas => [atlas.style, atlas.export, atlas.elevations]),
      ...(snapshot.resources ?? []).map(resource => resource.artifact),
      { contentRef: snapshot.weather.contentRef, sha256: snapshot.weather.contentRef?.sha256 ?? null },
    ];
    for (const artifact of artifacts) {
      if (!artifact.contentRef) continue;
      if (artifact.sha256 !== artifact.contentRef.sha256) throw new Error('SHA-256 артефакта не совпадает с контентной ссылкой');
      await this.read(artifact.contentRef, id);
    }
    return freeze(snapshot);
  }

  async read(ref: ContentRef, snapshotId?: string): Promise<Buffer> {
    if (!ref || !validHash(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new Error('Некорректная контентная ссылка снимка');
    const expectedName = `${ref.sha256}${path.extname(ref.path)}`;
    if (path.basename(ref.path) !== expectedName || ref.path !== `content/${expectedName}`) throw new Error('Небезопасный путь содержимого снимка');
    const candidates: string[] = [];
    if (snapshotId) {
      if (!validHash(snapshotId)) throw new Error('Некорректный идентификатор снимка среды');
      candidates.push(path.join(this.root, snapshotId, ref.path));
    } else {
      for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
        if (entry.isDirectory() && validHash(entry.name)) candidates.push(path.join(this.root, entry.name, ref.path));
      }
    }
    for (const candidate of candidates) {
      const data = await fs.readFile(candidate).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!data) continue;
      if (data.length !== ref.bytes || digest(data) !== ref.sha256) throw new Error('Содержимое снимка не совпадает с SHA-256');
      return data;
    }
    throw new Error('Содержимое снимка среды не найдено');
  }

  async readJson<T>(ref: ContentRef, snapshotId?: string): Promise<T> {
    return JSON.parse((await this.read(ref, snapshotId)).toString('utf8')) as T;
  }
}
