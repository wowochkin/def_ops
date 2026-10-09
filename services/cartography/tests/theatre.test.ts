import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TheatreBuilder } from '../src/theatre';

// подставной сборщик: пишет журнал и театр в --out (настоящий требует rasterio и сети)
const dir = mkdtempSync(join(tmpdir(), 'th-test-'));
const stub = join(dir, 'stub.py');
writeFileSync(stub, `import json, sys
rp = sys.argv[1]; out = sys.argv[sys.argv.index('--out') + 1]
r = json.load(open(rp))
print('местность: земной покров и рельеф', file=sys.stderr, flush=True)
if r['id'] == 'bad':
    raise SystemExit('нет места «X» в справочнике')
json.dump({'id': r['id'], 'name': r['name'], 'bbox': r['bbox'], 'cellKm': r['cellKm'], 'areas': []}, open(out, 'w'))
print('готово', file=sys.stderr)
`);
const wait = async (b: TheatreBuilder, id: string) => { for (let i = 0; i < 100; i++) { const x = b.get(id)!; if (x.status !== 'running') return x; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };

describe('сборка театра на сервере', () => {
  it('рецепт → процесс сборщика → журнал → театр; ошибка сборщика — в статусе', async () => {
    const b = new TheatreBuilder({ python: 'python3', script: stub, cache: dir });
    const ok = await b.start({ id: 'test-area', name: 'Тест', bbox: [13, 52, 13.5, 52.5], cellKm: 1 });
    const done = await wait(b, ok.id);
    expect(done.status).toBe('done');
    expect(done.log.join('\n')).toMatch(/местность/);
    expect(JSON.parse((await b.result(ok.id))!).id).toBe('test-area');
    const bad = await b.start({ id: 'bad', name: 'Плохой', bbox: [13, 52, 13.5, 52.5], cellKm: 1 });
    const failed = await wait(b, bad.id);
    expect(failed.status).toBe('error');
    expect(failed.error).toMatch(/нет места/);
    expect(await b.result(bad.id)).toBeNull();
  }, 20000);
});
