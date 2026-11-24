import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function assertPathInside(root: string, candidate: string, label: string): void {
  const path = relative(resolve(root), resolve(candidate));
  if (!path || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) {
    if (path === '') return;
    throw new Error(`${label}: выход за допустимый корень запрещён`);
  }
}

export async function assertRegularFile(path: string, label: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`${label}: символическая ссылка запрещена`);
  if (!stat.isFile()) throw new Error(`${label}: требуется обычный файл`);
}

export async function assertDirectoryIfExists(path: string, label: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`${label}: символическая ссылка запрещена`);
    if (!stat.isDirectory()) throw new Error(`${label}: требуется каталог`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
