/** Локальная библиотека и словарь установленного приложения. Вызывается только за localGuard. */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateUserLibraryEnvelope } from '../../../apps/desktop/server/portable-library.mjs';
import BASE from '../../../apps/editor/src/expo/bank-data/stress.json';
import { updateDictionary, type StudioDictionary } from '../../../scripts/expo-voice-dictionary';

const send = (res: ServerResponse, code: number, value: unknown) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  let size = 0; const parts: Buffer[] = [];
  for await (const part of req) { size += part.length; if (size > max) throw Error('Превышен размер файла'); parts.push(part); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function writeAtomic(file: string, data: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, JSON.stringify(data)); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }); }
}
export async function mergedStress(data: string): Promise<StudioDictionary> {
  let user: { words?: Record<string, string>; pending?: string[] } = {};
  try { user = JSON.parse(await fs.readFile(join(data, 'stress-user.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let merged: StudioDictionary = { ...BASE, words: { ...BASE.words } } as StudioDictionary;
  for (const word of user.pending ?? []) merged = updateDictionary(merged, word, '');
  for (const [word, say] of Object.entries(user.words ?? {})) merged = updateDictionary(merged, word, say);
  return merged;
}
// Сериализация read/modify/write, чтобы два окна не теряли правки друг друга.
let edits = Promise.resolve();
export async function portableApi(data: string, assets: string | undefined, req: IncomingMessage, res: ServerResponse, pathname: string) {
  try {
    if (pathname === '/api/portable/status' && req.method === 'GET') {
      let library = null;
      try { library = JSON.parse(await fs.readFile(join(data, 'portable-library.json'), 'utf8')); } catch { /* обычная разработка */ }
      return send(res, 200, { available: true, library });
    }
    if (pathname === '/api/portable/library' && req.method === 'GET') {
      if (!assets) return send(res, 404, { error: 'Библиотека не вложена' });
      try { const bytes = await fs.readFile(join(assets, 'library/files/portable/user-library.json')); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(bytes); return; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return send(res, 404, { error: 'Библиотека не вложена' }); throw e; }
    }
    if (pathname === '/api/portable/library/export' && req.method === 'POST') {
      const body = await readBody(req, 512 * 1024 * 1024) as Record<string, unknown>;
      validateUserLibraryEnvelope(body);
      const dir = join(data, 'exports'); await fs.mkdir(dir, { recursive: true });
      const path = join(dir, `user-library-${randomUUID()}.json`);
      await writeAtomic(path, body);
      return send(res, 200, { path });
    }
    if (pathname === '/api/portable/stress' && req.method === 'GET') return send(res, 200, await mergedStress(data));
    if (pathname === '/api/portable/stress' && req.method === 'PATCH') {
      const { word, say } = await readBody(req, 4096) as { word: unknown; say: unknown };
      let result: StudioDictionary | undefined;
      const edit = edits.then(async () => {
        const file = join(data, 'stress-user.json');
        let old: StudioDictionary = { mark: {}, words: {} };
        try { old = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        const next = updateDictionary(old, word, say);
        await fs.mkdir(data, { recursive: true }); await writeAtomic(file, next);
        result = await mergedStress(data);
      });
      edits = edit.catch(() => {}); await edit;
      return send(res, 200, result);
    }
    if (pathname === '/api/portable/lexicon' && req.method === 'GET') {
      if (!assets) return send(res, 404, { error: 'Каталог слов не вложен' });
      const catalog = JSON.parse(await fs.readFile(join(assets, 'lexicon.json'), 'utf8'));
      const stress = await mergedStress(data);
      const words = new Map(Object.entries(stress.words).map(([k,v]) => [k.toLowerCase(), v]));
      const pending = new Set((stress.pending ?? []).map(x => x.toLowerCase()));
      const seen = new Set<string>();
      for (const row of catalog.entries) {
        const key = row.word.toLowerCase(); seen.add(key);
        if (words.has(key)) { row.say = words.get(key); row.status = 'explicit'; }
        else if (pending.has(key)) { row.say = null; row.status = 'missing'; }
      }
      for (const key of [...Object.keys(stress.words), ...stress.pending ?? []]) if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase()); catalog.entries.push({ word: key, say: words.get(key.toLowerCase()) ?? null, suggestion: null, status: words.has(key.toLowerCase()) ? 'explicit' : 'missing', kind: 'word', sources: ['Пользовательский словарь'], examples: [] });
      }
      catalog.coverage = { total: catalog.entries.length, explicit: 0, derived: 0, missing: 0, inherent: 0 };
      for (const row of catalog.entries) catalog.coverage[row.status]++;
      return send(res, 200, catalog);
    }
    return send(res, 404, { error: 'Неизвестный адрес комплекта' });
  } catch (e) { return send(res, 400, { error: (e as Error).message }); }
}
