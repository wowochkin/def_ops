/**
 * Хранение «в памяти» с записью на диск — для работы без СУБД (приложение на одной машине).
 * Репозиторий в памяти держит данные в полях вида Map<организация, Map<id, запись>>. `persistent` загружает их из
 * JSON-файла при старте и после каждого изменяющего вызова (всё, кроме чтения: list…, get…, ready, close, …Rows)
 * записывает снова — с задержкой и атомарно (во временный файл, затем переименование).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

type Store = Map<string, Map<string, unknown>>;
const READ = /^(list|get|ready|close|type[A-Z]|then)/;

export async function persistent<T extends object>(repo: T, file: string, delayMs = 300): Promise<T> {
  const fields = Object.keys(repo).filter((k) => (repo as Record<string, unknown>)[k] instanceof Map);
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
    for (const f of fields) {
      const m = (repo as Record<string, Store>)[f];
      for (const [tenant, rows] of Object.entries(saved[f] ?? {})) m.set(tenant, new Map(Object.entries(rows)));
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  let timer: NodeJS.Timeout | null = null;
  let writing = Promise.resolve();
  const save = () => {
    const data: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const f of fields) {
      data[f] = {};
      for (const [tenant, rows] of (repo as Record<string, Store>)[f]) data[f][tenant] = Object.fromEntries(rows);
    }
    const tmp = `${file}.${process.pid}.tmp`;
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, file);
    });
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; save(); }, delayMs); };
  return new Proxy(repo, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      if (prop === 'close') return async () => { if (timer) { clearTimeout(timer); timer = null; save(); } await writing; return v.call(target); };
      if (READ.test(prop)) return v.bind(target);
      return async (...args: unknown[]) => { const r = await v.apply(target, args); schedule(); return r; };
    },
  });
}
