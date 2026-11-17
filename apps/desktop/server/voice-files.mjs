// Установленное приложение кладёт исходники Python в доступную для записи папку пользователя.
// Само окружение и модели готовятся заранее на целевой ОС; существующий .venv не перезаписывается.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function updateSource(source, destination) {
  const bytes = readFileSync(source);
  if (existsSync(destination)) {
    if (!lstatSync(destination).isFile()) throw Error(`Необычный файл голоса: ${destination}`);
    if (readFileSync(destination).equals(bytes)) return;
    chmodSync(destination, 0o600);
  }
  const temp = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temp, destination);
  } finally { rmSync(temp, { force: true }); }
}


export function prepareVoiceDirectory({ explicit, repo, data, bundled }) {
  if (explicit) return explicit;
  const source = join(repo, 'services', 'voice');
  if (existsSync(join(source, 'server.py'))) return source;
  const target = join(data, 'voice-service');
  if (existsSync(join(bundled, 'server.py'))) {
    mkdirSync(target, { recursive: true });
    for (const item of readdirSync(bundled, { withFileTypes: true })) {
      if (item.isFile() && /\.(py|json|txt|ps1|sh)$/.test(item.name)) updateSource(join(bundled, item.name), join(target, item.name));
    }
  }
  return target;
}
