/** Предвыставочная проверка: только чтение файлов и loopback-служб, без запуска/сброса игры и загрузок из сети. */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SCENARIO from '../packages/sim/data/scenarios/agents/berlin-1945.json';
import { voiceTexts, stageDomains, parseManifest } from '../apps/editor/src/expo/prerecord';
import { voicePython } from '../apps/desktop/server/voice-platform.mjs';

type Check = { name: string; status: 'ok' | 'fail' | 'manual'; detail: string };
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const nonempty = (p: string) => { try { return statSync(p).isFile() && statSync(p).size > 0; } catch { return false; } };
const required = () => voiceTexts(stageDomains(SCENARIO.start, SCENARIO.hours));

/** TileStore: tiles/<организация>/<карта>/<z>/<x>/<y>.<расширение>. Кэши и загрузки не считаются картой. */
function hasRasterTiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const numericDirs = (path: string) => readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name));
  for (const z of numericDirs(dir)) {
    for (const x of numericDirs(join(dir, z.name))) {
      const row = join(dir, z.name, x.name);
      if (readdirSync(row, { withFileTypes: true }).some(e => e.isFile() && /^\d+\.(png|jpg|webp)$/.test(e.name) && nonempty(join(row, e.name)))) return true;
    }
  }
  return false;
}

export function auditExpoAssets(data: string, texts = required()): Check[] {
  const out: Check[] = [];
  const check = (name: string, f: () => string) => {
    try { out.push({ name, status: 'ok', detail: f() }); }
    catch (e) { out.push({ name, status: 'fail', detail: String((e as Error).message) }); }
  };
  check('Предзапись, включая интро', () => {
    const manifest = parseManifest(read(join(data, 'expo/voice/manifest.json')));
    if (!manifest) throw Error('Нет корректного manifest.json: нужны хешированные имена .ogg и положительная длительность каждого клипа');
    const missing = texts.filter(t => !manifest.clips[t]);
    if (missing.length) throw Error(`Нет ${missing.length} обязательных фраз: ${missing.slice(0, 2).join(' / ')}`);
    const clips = Object.values(manifest.clips);
    const broken = clips.filter(c => !nonempty(join(data, 'expo/voice/clips', c.file)));
    if (broken.length) throw Error(`Нет или пусты ${broken.length} аудиофайлов`);
    return `${clips.length} файлов; ${texts.length} обязательных фраз покрыты`;
  });
  check('Образцы трёх голосов', () => {
    for (const id of ['chief-10s', 'zhukov-14s', 'konev-12s']) {
      const base = join(data, 'voice/voices', id);
      if (!nonempty(join(base, 'ref.wav')) || !read(join(base, 'ref.json')).text?.trim()) throw Error(`Нет образца и текста ${id}`);
    }
    return 'Начальник штаба, Жуков, Конев';
  });
  check('Локальные карты', () => {
    const catalog = read(join(data, 'cartography.json'));
    const maps = Object.entries(catalog.maps ?? {}).flatMap(([tenant, rows]) =>
      Object.entries(rows as Record<string, { id: string; kind: string }>).map(([id, map]) => ({ tenant, id, map })));
    if (!maps.length) throw Error('Перенесите cartography.json и всю папку tiles');
    for (const { tenant, id, map } of maps) {
      if (![tenant, id].every(s => /^[a-zA-Z0-9_-]{1,64}$/.test(s)) || map.id !== id) throw Error('Некорректные идентификаторы карты в cartography.json');
      const dir = join(data, 'tiles', tenant, id);
      const found = map.kind === 'vector' ? nonempty(join(dir, 'ohm.mbtiles')) : hasRasterTiles(dir);
      if (!found) throw Error(`Нет локальных данных карты ${tenant}/${id}: перенесите её тайлы вместе с каталогом`);
    }
    return `${maps.length} карт с локальными данными. Полноту покрытия и читаемость тайлов проверьте на карте без сети`;
  });
  return out;
}

async function main() {
  const args = process.argv.slice(2), opt = (name: string, d = '') => args.includes(name) ? args[args.indexOf(name) + 1] : d;
  const data = resolve(opt('--data', process.env.DEFOPS_DATA_DIR ?? (process.platform === 'win32'
    ? join(process.env.APPDATA ?? homedir(), 'ru.defops.desktop')
    : join(homedir(), 'Library/Application Support/ru.defops.desktop'))));
  const repoVoice = resolve(dirname(fileURLToPath(import.meta.url)), '../services/voice');
  const voiceDir = opt('--voice-dir', process.env.DEFOPS_VOICE_DIR ?? (existsSync(join(repoVoice, 'server.py')) ? repoVoice : join(data, 'voice-service')));
  const models = opt('--models-dir', process.env.DEFOPS_VOICE_MODELS ?? join(data, 'models/voice'));
  const checks = auditExpoAssets(data);
  const check = async (name: string, f: () => string | Promise<string>) => {
    try { checks.push({ name, status: 'ok', detail: await f() }); }
    catch (e) { checks.push({ name, status: 'fail', detail: String((e as Error).message) }); }
  };
  const cmd = (file: string, args: string[], timeout = 15000) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const localJson = async (url: string) => { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw Error(`HTTP ${r.status}`); return r.json(); };
  await check('Python и FFmpeg', () => `${cmd(voicePython(voiceDir), ['--version'])}; ${cmd('ffmpeg', ['-version']).split('\n')[0]}`);
  if (process.platform === 'win32') {
    await check('NVIDIA', () => cmd('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader']));
    await check('Три независимых дисплея Windows', () => {
      const output = cmd('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName }) | ConvertTo-Json -Compress']);
      const names = JSON.parse(output), list = Array.isArray(names) ? names : [names];
      if (list.length < 3) throw Error(`Windows видит ${list.length}: включите «Расширить»; обычный HDMI-сплиттер дублирует сигнал`);
      return list.join(', ');
    });
    await check('Локальные модели голоса и контрольные суммы', () => cmd(voicePython(voiceDir), [join(voiceDir, 'prepare_models.py'), '--check', '--models-dir', models], 300000));
  } else checks.push({ name: 'Проверка Windows / RTX', status: 'manual', detail: 'Этот запуск выполнен на другой ОС. Повторите на целевой Windows-машине' });
  if (!args.includes('--assets-only')) {
    await check('Голос без загрузок', async () => {
      const h = await localJson('http://127.0.0.1:47645/health');
      if (h.state !== 'ready') throw Error(h.error ?? h.state);
      if (process.platform === 'win32' && (h.backend !== 'torch' || h.engine !== 'qwen3-ru-stress' || !h.offline)) throw Error('Нужны torch, qwen3-ru-stress и автономный режим');
      return `${h.state}; ${h.backend ?? 'MLX'}; ${h.engine ?? 'проверьте модель в студии'}`;
    });
    await check('Доступность локального API языковой модели', async () => {
      for (const port of [1235, 1234]) {
        try { const j = await localJson(`http://127.0.0.1:${port}/v1/models`); const ids = j.data?.map((m: { id: string }) => m.id).filter((id: string) => !id.toLowerCase().includes('embed')); if (ids?.length) return `Порт ${port}: ${ids.join(', ')}. Список API не подтверждает загрузку выбранной модели и генерацию: проверьте их вручную без сети`; } catch { /* следующий локальный порт */ }
      }
      throw Error('Нет доступного локального API с языковыми моделями на 1234/1235; запустите заранее подготовленный сервер');
    });
  }
  checks.push({ name: 'Приёмка на стойке', status: 'manual', detail: 'Отключить интернет, холодный запуск; 12 сцен интро и оба фронта до итога; прослушать голос; отключить/вернуть ТВ; проверить роли и полный экран при разных DPI' });
  const report = { platform: process.platform, arch: process.arch, ramGiB: Math.round(totalmem() / 2 ** 30), data, checks, passed: !checks.some(c => c.status === 'fail'), hardwareAcceptanceRequired: true };
  if (opt('--out')) writeFileSync(resolve(opt('--out')), JSON.stringify(report, null, 2) + '\n');
  for (const c of checks) console.log(`${c.status === 'ok' ? 'OK' : c.status === 'fail' ? 'ОШИБКА' : 'ВРУЧНУЮ'} · ${c.name}: ${c.detail}`);
  console.log(`Итог: ${checks.filter(c => c.status === 'ok').length} проверок пройдено, ${checks.filter(c => c.status === 'fail').length} ошибок. Проверка не заменяет прогон на трёх телевизорах.`);
  process.exitCode = report.passed ? 0 : 1;
}
if (process.argv[1] && /expo-preflight\.(?:ts|mjs)$/.test(process.argv[1])) void main().catch(e => { console.error(String(e)); process.exitCode = 1; });
