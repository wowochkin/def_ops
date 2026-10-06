/**
 * Тайлы на диске: TILES_DIR/{организация}/{карта}/{z}/{x}/{y}.{png|jpg|webp}.
 * Тайл хранится как получен (формат определяется по содержимому). Запись
 * атомарная: временный файл + rename, — читатель никогда не увидит половину тайла.
 *
 * Рядом с пирамидой карты — производные тайлы, обрезанные по границе карты:
 * {карта}/_masked/{ключ границы}/{z}/{x}/{y}.png (кэш, удаляется при смене границы).
 * Загруженные сканы до нарезки — TILES_DIR/.uploads (точка не допускается в имени
 * организации, поэтому пересечься с данными организаций нельзя).
 */
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';

export type TileExt = 'png' | 'jpg' | 'webp';
export const EXTS: TileExt[] = ['png', 'jpg', 'webp'];
export const MIME: Record<TileExt, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Формат изображения по сигнатуре (первые байты). */
export function detectFormat(b: Buffer): TileExt | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Формат по Content-Type ответа источника (если сигнатура не распознана). */
export function formatFromMime(ct: string | null): TileExt | null {
  const t = (ct ?? '').toLowerCase();
  return t.includes('png') ? 'png' : t.includes('jpeg') || t.includes('jpg') ? 'jpg' : t.includes('webp') ? 'webp' : null;
}

export interface TileFile { z: number; x: number; y: number; ext: TileExt; file: string; size: number; mtimeMs: number }

const SEG = /^[a-zA-Z0-9_-]{1,64}$/;
const seg = (s: string) => {
  if (!SEG.test(s)) throw new Error(`Недопустимое имя каталога: ${s}`);
  return s;
};
const num = (n: number) => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Недопустимый номер тайла: ${n}`);
  return String(n);
};

let seq = 0;
const tmpName = (file: string) => `${file}.${process.pid}.${Date.now()}.${++seq}.tmp`;

/** Атомарная запись файла (каталоги создаются). */
export async function writeAtomic(file: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpName(file);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export class TileStore {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  mapDir(tenant: string, mapId: string) { return path.join(this.root, seg(tenant), seg(mapId)); }
  tilePath(tenant: string, mapId: string, z: number, x: number, y: number, ext: TileExt) {
    return path.join(this.mapDir(tenant, mapId), num(z), num(x), `${num(y)}.${ext}`);
  }
  maskedPath(tenant: string, mapId: string, key: string, z: number, x: number, y: number) {
    return path.join(this.mapDir(tenant, mapId), '_masked', seg(key), num(z), num(x), `${num(y)}.png`);
  }
  uploadsDir() { return path.join(this.root, '.uploads'); }

  /** Найти тайл (prefer — какой формат проверить первым). */
  async find(tenant: string, mapId: string, z: number, x: number, y: number, prefer?: TileExt): Promise<TileFile | null> {
    const order = prefer ? [prefer, ...EXTS.filter((e) => e !== prefer)] : EXTS;
    for (const ext of order) {
      const file = this.tilePath(tenant, mapId, z, x, y, ext);
      try {
        const st = await fs.stat(file);
        return { z, x, y, ext, file, size: st.size, mtimeMs: st.mtimeMs };
      } catch { /* нет в этом формате */ }
    }
    return null;
  }

  async has(tenant: string, mapId: string, z: number, x: number, y: number, prefer?: TileExt) {
    return !!(await this.find(tenant, mapId, z, x, y, prefer));
  }

  /** Записать тайл (тайл того же адреса в другом формате удаляется). */
  async write(tenant: string, mapId: string, z: number, x: number, y: number, ext: TileExt, data: Buffer): Promise<void> {
    await writeAtomic(this.tilePath(tenant, mapId, z, x, y, ext), data);
    for (const other of EXTS) if (other !== ext) await fs.rm(this.tilePath(tenant, mapId, z, x, y, other), { force: true });
  }

  /** Все тайлы карты по порядку z, x, y (без загрузки в память). */
  async *walk(tenant: string, mapId: string): AsyncGenerator<TileFile> {
    const dir = this.mapDir(tenant, mapId);
    const nums = async (d: string) => {
      try {
        return (await fs.readdir(d)).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
      } catch { return []; }
    };
    for (const z of await nums(dir))
      for (const x of await nums(path.join(dir, String(z)))) {
        const xd = path.join(dir, String(z), String(x));
        let names: string[] = [];
        try { names = await fs.readdir(xd); } catch { continue; }
        const tiles = names.map((n) => /^(\d+)\.(png|jpg|webp)$/.exec(n)).filter((m): m is RegExpExecArray => !!m)
          .map((m) => ({ y: Number(m[1]), ext: m[2] as TileExt, name: m[0] })).sort((a, b) => a.y - b.y);
        for (const t of tiles) {
          const file = path.join(xd, t.name);
          try {
            const st = await fs.stat(file);
            yield { z, x, y: t.y, ext: t.ext, file, size: st.size, mtimeMs: st.mtimeMs };
          } catch { /* удалён между чтением каталога и stat */ }
        }
      }
  }

  /** Число тайлов и объём пирамиды карты. */
  async stats(tenant: string, mapId: string): Promise<{ tiles: number; bytes: number }> {
    let tiles = 0, bytes = 0;
    for await (const t of this.walk(tenant, mapId)) { tiles++; bytes += t.size; }
    return { tiles, bytes };
  }

  /** Удалить карту с диска целиком (тайлы и производные). */
  async removeMap(tenant: string, mapId: string) { await fs.rm(this.mapDir(tenant, mapId), { recursive: true, force: true }); }

  /** Удалить кэш тайлов, обрезанных по границе. */
  async clearMasked(tenant: string, mapId: string) { await fs.rm(path.join(this.mapDir(tenant, mapId), '_masked'), { recursive: true, force: true }); }

  /** Временный файл для загрузки скана. */
  async uploadTarget(): Promise<{ file: string; stream: ReturnType<typeof createWriteStream> }> {
    await fs.mkdir(this.uploadsDir(), { recursive: true });
    const file = path.join(this.uploadsDir(), `${crypto.randomUUID()}.upload`);
    return { file, stream: createWriteStream(file) };
  }
}
