// База окна (IndexedDB): открытие не виснет, когда другая вкладка держит старую версию базы или просит новую.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

/** Обещание или отказ «висит» за срок ms. */
const within = <T>(p: Promise<T>, ms = 1000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('висит')), ms))]);
const open = (v: number, upgrade = false) => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('def_ops_sim', v);
  if (upgrade) r.onupgradeneeded = () => { r.result.createObjectStore('game_branches', { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

describe('userdata: открытие базы', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
  it('db() rejects when blocked by an old connection', async () => {
    const old = await open(5, true); // другая вкладка: старая версия, на просьбу закрыться не отвечает
    const u = await import('../src/sim/userdata');
    await expect(within(u.putGameBranch({ id: 'g:b', turns: [] }))).rejects.toThrow(/другой вкладк/);
    // вкладка закрылась — следующая запись открывает базу заново
    old.close();
    await expect(within(u.putGameBranch({ id: 'g:b', turns: [1] }))).resolves.toBeUndefined();
    expect((await within(u.getGameBranch('g:b')))?.turns).toEqual([1]);
  });
  it('versionchange closes our connection: the newer tab opens, our next call does not hang', async () => {
    const u = await import('../src/sim/userdata');
    await within(u.putGameBranch({ id: 'g:b', turns: [] }));
    const newer = await within(open(7));
    newer.close();
    await expect(within(u.putGameBranch({ id: 'g:c', turns: [] }))).rejects.toBeTruthy();
  });
});
