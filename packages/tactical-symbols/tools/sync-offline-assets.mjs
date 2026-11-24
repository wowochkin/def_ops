import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const target = path.resolve(packageRoot, '../kshvi/assets/vendor/tactical-symbols');
await mkdir(target, { recursive: true });
for (const directory of ['data', 'src']) {
  await cp(path.join(packageRoot, directory), path.join(target, directory), { recursive: true, force: true });
}
console.log('Автономный комплект знаков синхронизирован: данные, векторные страницы и исходный код.');
