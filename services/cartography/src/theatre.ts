/**
 * Сборка театра для переигровки на сервере: рецепт (охват, шаг сетки, правила) → сборщик на Python
 * (packages/sim/tools/theatre/build_theatre.py: ESA WorldCover, Copernicus DEM, OpenStreetMap) в отдельном
 * процессе; ход сборки — строками журнала; итог — театр (TheatreData, JSON). Исходные данные кэшируются на
 * диске (THEATRE_CACHE), повторная сборка того же района идёт быстро.
 *
 * Python: THEATRE_PYTHON, по умолчанию .venv/bin/python в корне репозитория, иначе python3. Подготовка:
 *   python3 -m venv .venv && .venv/bin/pip install -r packages/sim/tools/theatre/requirements.txt
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SCRIPT = join(ROOT, 'packages/sim/tools/theatre/build_theatre.py');

export interface TheatreBuild {
  id: string;
  recipeId: string;
  name: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  /** Последние строки журнала сборщика. */
  log: string[];
  error?: string;
  sizeBytes?: number;
}

export class TheatreBuilder {
  private builds = new Map<string, TheatreBuild & { proc?: ChildProcess; out: string; dir: string }>();
  readonly python: string;
  readonly cache: string;
  readonly script: string;
  constructor(o: { python?: string; cache?: string; script?: string } = {}) {
    const venv = join(ROOT, '.venv/bin/python');
    this.script = o.script || SCRIPT;
    this.python = o.python || (existsSync(venv) ? venv : 'python3');
    this.cache = o.cache || join(homedir(), '.cache/def-ops-theatre');
  }

  /** Готов ли сборщик: есть Python с numpy и rasterio. */
  check(): Promise<{ ok: boolean; python: string; script: boolean; error?: string; setup: string }> {
    const setup = 'python3 -m venv .venv && .venv/bin/pip install -r packages/sim/tools/theatre/requirements.txt';
    return new Promise((res) => {
      const p = spawn(this.python, ['-c', 'import numpy, rasterio; print(rasterio.__version__)'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => res({ ok: false, python: this.python, script: existsSync(this.script), error: e.message, setup }));
      p.on('close', (code) => res({ ok: code === 0 && existsSync(this.script), python: this.python, script: existsSync(this.script), ...(code ? { error: err.trim().split('\n').pop() } : {}), setup }));
    });
  }

  async start(recipe: Record<string, unknown>): Promise<TheatreBuild> {
    const id = randomUUID();
    const dir = await fs.mkdtemp(join(tmpdir(), 'def-ops-theatre-'));
    const rp = join(dir, `${recipe.id}.recipe.json`), out = join(dir, `${recipe.id}.json`);
    await fs.writeFile(rp, JSON.stringify(recipe, null, 1));
    const b = { id, recipeId: String(recipe.id), name: String(recipe.name ?? recipe.id), status: 'running' as const, startedAt: new Date().toISOString(), log: [] as string[], out, dir };
    const proc = spawn(this.python, ['-u', this.script, rp, '--out', out, '--cache', this.cache], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (d: Buffer) => { for (const l of d.toString().split('\n').map((x) => x.trimEnd()).filter(Boolean)) { b.log.push(l); if (b.log.length > 200) b.log.shift(); } };
    proc.stdout.on('data', add);
    proc.stderr.on('data', add);
    const item = Object.assign(b, { proc }) as TheatreBuild & { proc?: ChildProcess; out: string; dir: string };
    proc.on('error', (e) => { item.status = 'error'; item.error = e.message; item.finishedAt = new Date().toISOString(); });
    proc.on('close', async (code) => {
      item.proc = undefined;
      item.finishedAt = new Date().toISOString();
      if (item.status === 'cancelled') return;
      if (code === 0 && existsSync(out)) { item.status = 'done'; item.sizeBytes = (await fs.stat(out)).size; }
      else { item.status = 'error'; item.error = item.log[item.log.length - 1] ?? `сборщик завершился с кодом ${code}`; } // последняя строка — причина (исключение или SystemExit)
    });
    this.builds.set(id, item);
    return this.view(item);
  }

  private view(b: TheatreBuild): TheatreBuild {
    const { id, recipeId, name, status, startedAt, finishedAt, log, error, sizeBytes } = b;
    return { id, recipeId, name, status, startedAt, finishedAt, log: log.slice(-60), error, sizeBytes };
  }
  get(id: string) { const b = this.builds.get(id); return b ? this.view(b) : null; }
  list() { return [...this.builds.values()].map((b) => this.view(b)).reverse(); }
  async result(id: string): Promise<string | null> {
    const b = this.builds.get(id);
    return b?.status === 'done' ? fs.readFile(b.out, 'utf8') : null;
  }
  cancel(id: string) {
    const b = this.builds.get(id);
    if (!b || b.status !== 'running') return null;
    b.status = 'cancelled'; b.proc?.kill('SIGTERM');
    return this.view(b);
  }
  stop() { for (const b of this.builds.values()) b.proc?.kill('SIGTERM'); }
}
