import { ARCHIVE_COMPONENTS, type ArchiveBundle } from '../../../../packages/kshvi/src/archive/archive-manifest';
import { serializeArchive } from './archive-exporter';
import { verifyArchive } from './integrity-check';

const VIEWER_SCRIPT = String.raw`
function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
function sha256(bytes) {
  const primes = [];
  for (let candidate = 2; primes.length < 64; candidate += 1) {
    if (primes.every(prime => candidate % prime !== 0)) primes.push(candidate);
  }
  const initial = primes.slice(0, 8).map(prime => Math.floor((Math.sqrt(prime) % 1) * 4294967296) >>> 0);
  const constants = primes.map(prime => Math.floor((Math.cbrt(prime) % 1) * 4294967296) >>> 0);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = initial.slice();
  const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h=g; g=f; f=e; e=(d + temp1) >>> 0; d=c; c=b; b=a; a=(temp1 + temp2) >>> 0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, index) => { hash[index] = (hash[index] + value) >>> 0; });
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}
function decodeBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function decodeText(base64) {
  return new TextDecoder().decode(decodeBytes(base64));
}
const requiredComponents = __ARCHIVE_REQUIRED__;
function verifyPackage(packageData) {
  const { manifest, files } = packageData;
  const errors = [];
  const missing = [];
  const corrupted = [];
  const brokenReferences = [];
  const manifestContent = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestSha256'));
  const manifestSha256 = sha256(new TextEncoder().encode(canonicalJson(manifestContent)));
  if (manifestSha256 !== manifest.manifestSha256) errors.push('Контрольная сумма манифеста не совпадает');
  if (manifest.schemaVersion !== 1) errors.push('Неподдерживаемая схема');
  const omissions = new Map(manifest.omissions.map(item => [item.componentId, item]));
  for (const definition of requiredComponents) {
    if (!definition.required && !(manifest.kind === 'EXPOSITION' && definition.id.startsWith('exposition.'))) continue;
    if (!manifest.components.some(component => component.id === definition.id) && !omissions.get(definition.id)?.licenseLimitation) missing.push(definition.id);
  }
  const paths = new Set(manifest.components.map(component => component.path));
  for (const component of manifest.components) {
    let bytes;
    try { bytes = decodeBytes(files[component.path]); }
    catch { corrupted.push(component.path); continue; }
    if (!bytes || bytes.length !== component.bytes || sha256(bytes) !== component.sha256) corrupted.push(component.path);
    if (component.mediaType === 'application/json') {
      try { if (JSON.parse(decodeText(files[component.path])) === null) missing.push(component.id + ': null'); }
      catch { corrupted.push(component.path); }
    }
    for (const reference of component.references) if (!paths.has(reference) || typeof files[reference] !== 'string') brokenReferences.push(reference);
  }
  for (const path of Object.keys(files)) if (!paths.has(path)) errors.push('Файл отсутствует в манифесте: ' + path);
  const limitations = manifest.omissions.filter(item => !item.informational).map(item => item.reason);
  const rejected = errors.length || corrupted.length || brokenReferences.length;
  const autonomous = !rejected && !missing.length && !limitations.length;
  return {
    mode: rejected ? 'REJECTED' : autonomous ? 'AUTONOMOUS' : 'LIMITED_RESEARCH',
    autonomous, missing, corrupted, brokenReferences, errors, limitations,
    replayPath: manifest.components.find(component => component.id === 'replay.archive')?.path || null,
  };
}
function recordedReplayAt(archive, cursor) {
  const snapshots = archive.snapshots.filter(item => item.branchId === archive.branchId && item.sequence <= cursor).sort((a,b) => b.sequence - a.sequence);
  const snapshot = snapshots[0];
  if (!snapshot) throw new Error('Нет снимка');
  if (snapshot.reducerVersion !== 1) return { state: snapshot.state, hash: null, sequence: snapshot.sequence, compatibility: 'INCOMPATIBLE_READ' };
  const state = JSON.parse(JSON.stringify(snapshot.state));
  const events = archive.events.filter(event => event.branchId === archive.branchId && event.sequence <= cursor).sort((a,b) => a.sequence - b.sequence);
  for (const event of events) {
    if (event.sequence <= snapshot.sequence) continue;
    if ((event.reducerVersion || snapshot.reducerVersion) !== 1) return { state, hash: null, sequence: event.sequence - 1, compatibility: 'INCOMPATIBLE_READ' };
    for (const change of event.changes || []) state.domains[change.domain] = JSON.parse(JSON.stringify(change.value));
    if (!state.appliedEventIds.includes(event.eventId)) state.appliedEventIds.push(event.eventId);
    state.eventCauses[event.eventId] = [...(event.causeIds || [])];
  }
  return { state, hash: sha256(new TextEncoder().encode(canonicalJson(state))), sequence: cursor, compatibility: 'REPRODUCIBLE' };
}
const packageData = JSON.parse(document.getElementById('archive-package').textContent);
const verification = verifyPackage(packageData);
if (verification.mode === 'REJECTED') {
  document.getElementById('archive-error').textContent = 'Архив повреждён: ' + [...verification.errors, ...verification.corrupted, ...verification.brokenReferences].join('; ');
  document.getElementById('offline-frame').hidden = true;
  throw new Error('Проверка автономного архива не пройдена');
}
if (!verification.autonomous) {
  document.getElementById('archive-status').textContent = 'Ограниченное исследование: ' + [...verification.missing, ...verification.limitations].join('; ');
}
if (!verification.replayPath || !packageData.files[verification.replayPath]) throw new Error('Журнал реплея отсутствует');
const replay = JSON.parse(decodeText(packageData.files[verification.replayPath]));
const slider = document.getElementById('replay-position');
const frameElement = document.getElementById('offline-frame');
const hashElement = document.getElementById('offline-hash');
const domainsElement = document.getElementById('offline-domains');
const clockElement = document.getElementById('offline-clock');
slider.max = String(Math.max(...replay.events.map(event => event.sequence), 0));
function showFrame() {
  const cursor = Number(slider.value);
  const frame = recordedReplayAt(replay, cursor);
  frameElement.dataset.sequence = String(frame.sequence);
  hashElement.textContent = frame.hash || 'Несовместимое чтение — идентичность не заявляется';
  const point = replay.events.filter(event => event.branchId === replay.branchId && event.sequence <= cursor).sort((a,b) => b.sequence - a.sequence)[0]
    || replay.snapshots.filter(item => item.branchId === replay.branchId && item.sequence <= cursor).sort((a,b) => b.sequence - a.sequence)[0];
  clockElement.textContent = 'Оперативное время: ' + point.operationalAt + ' | Астрономическое время: ' + point.wallClockAt;
  domainsElement.replaceChildren();
  for (const [domain, value] of Object.entries(frame.state.domains)) {
    const article = document.createElement('article');
    const heading = document.createElement('h3'); heading.textContent = domain;
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(value);
    article.append(heading, pre); domainsElement.append(article);
  }
}
slider.addEventListener('input', showFrame);
showFrame();
`;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function buildOfflineViewer(bundle: ArchiveBundle): string {
  const verification = verifyArchive(bundle);
  if (verification.mode === 'REJECTED') throw new Error('Нельзя собрать viewer повреждённого архива');
  const serialized = serializeArchive(bundle).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  const requiredJson = JSON.stringify(ARCHIVE_COMPONENTS.map(component => ({ id: component.id, required: component.required })));
  const executable = VIEWER_SCRIPT.replace('__ARCHIVE_REQUIRED__', requiredJson);
  const modeLabel = verification.autonomous
    ? 'Автономное воспроизведение: проверено'
    : `Ограниченное исследование: ${[...verification.missing, ...verification.limitations].join('; ')}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; font-src 'none'"><title>Автономный реплей КШВИ</title>
<style>html{font-family:system-ui,sans-serif;background:#111a20;color:#edf2f4}body{margin:0;padding:20px}main{max-width:1400px;margin:auto}article{border:1px solid #75838b;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}#offline-domains{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}label{display:block;margin:16px 0}input{width:100%}</style></head>
<body><main><h1>Автономный реплей КШВИ</h1><p id="archive-status" role="status">${escapeHtml(modeLabel)}</p><p>Истинное состояние — постоянная метка</p><p>${escapeHtml(bundle.manifest.archiveId)}; манифест ${escapeHtml(bundle.manifest.manifestSha256)}</p><p id="archive-error" role="alert"></p>
<label>Позиция автономного реплея<input id="replay-position" aria-label="Позиция автономного реплея" type="range" min="0" value="0" step="1"></label>
<div id="offline-frame" data-testid="offline-frame" data-sequence="0"><p id="offline-clock"></p><p>SHA-256: <code id="offline-hash" data-testid="offline-hash">Нет данных</code></p><div id="offline-domains"></div></div></main>
<script id="archive-package" type="application/json">${serialized}</script><script>${executable}</script></body></html>`;
}
