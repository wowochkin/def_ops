import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { createGateway } from '../src/gateway';
import { LIBRARY_DATABASES } from '../../../apps/editor/src/portable/library';
let server: Server, root: string, base: string;
const archive = () => ({ format: 'def-ops-portable-library', version: 1, id: 'test', createdAt: new Date().toISOString(), databases: Object.fromEntries(Object.entries(LIBRARY_DATABASES).map(([name, spec]) => [name, Object.fromEntries(spec.stores.map(s => [s, []]))])) });
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'шлюз комплекта '));
  server = createGateway({ port: 0, services: {}, routes: [], auth: 'open', apiKeys: new Map(), corsOrigin: '*', localOnly: true, portableData: join(root, 'данные'), portableAssets: join(root, 'ресурсы') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await fs.rm(root, { recursive: true, force: true }); });
function api(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return fetch(base + '/api/portable/' + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe('API переносимого комплекта', () => {
  it('отклоняет чужой Origin, подменённый Host и запись без Origin', async () => {
    expect((await api('stress', 'GET', undefined, { Origin: 'https://other.example' })).status).toBe(403);
    const rebound = await new Promise<number | undefined>((resolve, reject) => { const req = request(base + '/api/portable/status', { headers: { Host: 'other.example', Origin: base } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    expect(rebound).toBe(403);
    expect((await fetch(base + '/api/portable/stress', { method: 'PATCH', body: '{}' })).status).toBe(403);
    expect((await api('status')).status).toBe(200);
  });
  it('сохраняет одновременные словарные правки двух окон', async () => {
    const changes = [{ word: 'перенос', say: 'перен+ос' }, { word: 'дорога', say: 'дор+ога' }, { word: 'библиотека', say: 'библиот+ека' }];
    const responses = await Promise.all(changes.map(change => api('stress', 'PATCH', change)));
    expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
    const merged = await (await api('stress')).json();
    for (const change of changes) expect(merged.words[change.word]).toBe(change.say);
    const user = JSON.parse(await fs.readFile(join(root, 'данные/stress-user.json'), 'utf8'));
    expect(Object.keys(user.words)).toHaveLength(3);
    expect((await fs.readdir(join(root, 'данные'))).some(name => name.endsWith('.tmp'))).toBe(false);
  });
  it('не записывает неверную правку и продолжает очередь после отказа', async () => {
    expect((await api('stress', 'PATCH', { word: 'слово', say: 'друг+ое' })).status).toBe(400);
    expect((await api('stress', 'PATCH', { word: 'слово', say: 'сл+ово' })).status).toBe(200);
    expect((await (await api('stress')).json()).words.слово).toBe('сл+ово');
  });
  it('пустое ударение сохраняет слово на доработку и отражается в каталоге', async () => {
    await fs.mkdir(join(root, 'ресурсы')); await fs.writeFile(join(root, 'ресурсы/lexicon.json'), JSON.stringify({ entries: [] }));
    expect((await api('stress', 'PATCH', { word: 'перенос', say: '' })).status).toBe(200);
    const lexicon = await (await api('lexicon')).json();
    expect(lexicon.entries.find((e: { word: string }) => e.word === 'перенос')).toMatchObject({ status: 'missing', say: null });
    expect(lexicon.coverage.missing).toBeGreaterThan(0);
  });
  it('экспорт создаёт отдельные файлы без перезаписи предыдущего', async () => {
    const source = archive(); const responses = await Promise.all([api('library/export', 'POST', source), api('library/export', 'POST', source)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const first = await responses[0].json(), second = await responses[1].json();
    expect(first.path).not.toBe(second.path); expect(first.path.startsWith(join(root, 'данные/exports/'))).toBe(true);
    expect(JSON.parse(await fs.readFile(first.path, 'utf8'))).toEqual(source);
    expect(JSON.parse(await fs.readFile(second.path, 'utf8'))).toEqual(source);
  });
  it('экспорт отклоняет неполный архив до создания файла', async () => {
    expect((await api('library/export', 'POST', { ...archive(), databases: {} })).status).toBe(400);
    await expect(fs.access(join(root, 'данные/exports'))).rejects.toThrow();
  });
  it('отдаёт именно вложенный архив и различает отсутствие комплекта', async () => {
    expect((await api('library')).status).toBe(404);
    const file = join(root, 'ресурсы/library/files/portable/user-library.json'); await fs.mkdir(join(file, '..'), { recursive: true }); await fs.writeFile(file, JSON.stringify(archive()));
    const response = await api('library'); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ format: 'def-ops-portable-library', id: 'test' });
  });
});
