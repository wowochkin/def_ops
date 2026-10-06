/**
 * Хранилища документов ведут себя одинаково: память, файлы, PostgreSQL.
 * Набор для PostgreSQL выполняется, если задан DATABASE_URL (каждый прогон — в своей схеме).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { emptyDocument, type MapDocument } from '@def-ops/core';
import { createPool, dropSchema, type Pool } from '@def-ops/db';
import { ConflictError, FileStore, MemoryStore, type DocumentStore } from '../src/store';
import { PgStore } from '../src/pg-store';

const doc = (name: string): MapDocument => ({ ...emptyDocument([13.4, 52.5], 8), name });

function suite(title: string, make: () => Promise<DocumentStore>, cleanup?: () => Promise<void>) {
  describe(title, () => {
    let s: DocumentStore;
    beforeAll(async () => { s = await make(); });
    afterAll(async () => { await cleanup?.(); });

    it('создание, чтение, ревизии, список', async () => {
      const a = await s.save('t1', doc('Берлин'));
      expect(a.id).toBeTruthy();
      expect(a.revision).toBe(1);
      const b = await s.save('t1', { ...a, name: 'Берлин-2' }, 1);
      expect(b.revision).toBe(2);
      expect((await s.get('t1', a.id!))!.name).toBe('Берлин-2');
      expect((await s.revisions('t1', a.id!)).map((r) => r.revision)).toEqual([1, 2]);
      expect((await s.getRevision('t1', a.id!, 1))!.name).toBe('Берлин');
      const list = await s.list('t1');
      expect(list.find((m) => m.id === a.id)).toMatchObject({ name: 'Берлин-2', revision: 2, layers: 5, features: 0 });
    });

    it('оптимистичная блокировка и изоляция организаций', async () => {
      const a = await s.save('t1', doc('Конфликт'));
      await s.save('t1', a, 1);
      await expect(s.save('t1', a, 1)).rejects.toBeInstanceOf(ConflictError);
      expect(await s.get('t2', a.id!)).toBeNull();
      expect((await s.list('t2')).length).toBe(0);
    });

    it('одновременное сохранение с одной ревизией — проходит одно', async () => {
      const a = await s.save('t1', doc('Гонка'));
      const r = await Promise.allSettled([s.save('t1', a, 1), s.save('t1', a, 1), s.save('t1', a, 1)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    });

    it('удаление', async () => {
      const a = await s.save('t1', doc('Удалить'));
      expect(await s.delete('t1', a.id!)).toBe(true);
      expect(await s.get('t1', a.id!)).toBeNull();
      expect(await s.delete('t1', a.id!)).toBe(false);
    });
  });
}

suite('MemoryStore', async () => new MemoryStore());

let dir = '';
suite('FileStore', async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'defops-')); return new FileStore(dir); },
  async () => { await fs.rm(dir, { recursive: true, force: true }); });

const url = process.env.DATABASE_URL;
let pool: Pool;
const schema = `documents_test_${Math.random().toString(36).slice(2, 8)}`;
(url ? suite : describe.skip)('PgStore (PostgreSQL)', async () => {
  pool = createPool(url);
  const s = new PgStore(pool, schema);
  await s.init();
  await s.init(); // повторный запуск миграций безопасен
  return s;
}, async () => { await dropSchema(pool, schema); await pool.end(); });
