// Официальный Node, независимый от Homebrew. Версия/хеш закреплены для воспроизводимости.
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const version = '22.23.4';
const variants = {
  'darwin-arm64': { file: `node-v${version}-darwin-arm64.tar.gz`, sha256: 'c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428' },
  'win32-x64': { file: `node-v${version}-win-x64.zip`, sha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20' },
};
export async function prepareNode(destination, platform = process.platform, arch = process.arch) {
  const spec = variants[`${platform}-${arch}`]; if (!spec) throw Error('Поддерживаются macOS arm64 и Windows x64');
  const cache = resolve(dirname(fileURLToPath(import.meta.url)), '../release/downloads'); await fs.mkdir(cache,{recursive:true});
  const archive = join(cache,spec.file);
  let bytes;
  try { bytes=await fs.readFile(archive); } catch {
    const r=await fetch(`https://nodejs.org/dist/v${version}/${spec.file}`, {signal:AbortSignal.timeout(120000)}); if(!r.ok) throw Error(`Node HTTP ${r.status}`);
    bytes=Buffer.from(await r.arrayBuffer());
  }
  if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256) throw Error('SHA256 Node не совпадает');
  await fs.writeFile(archive,bytes);
  await fs.mkdir(destination,{recursive:true});
  if(platform==='win32') execFileSync('tar',['-xf',archive,'-C',destination,'--strip-components=1'],{stdio:'inherit'});
  else execFileSync('tar',['-xzf',archive,'-C',destination,'--strip-components=1'],{stdio:'inherit'});
  return join(destination,platform==='win32'?'node.exe':'bin/node');
}
