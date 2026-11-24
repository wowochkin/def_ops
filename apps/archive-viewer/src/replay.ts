import type { ReplayArchive, ReplayState } from '../../../packages/kshvi/src/replay/types';

export type OfflineReplayFrame = {
  state: ReplayState;
  hash: string | null;
  sequence: number;
  compatibility: 'REPRODUCIBLE' | 'INCOMPATIBLE_READ';
};

export function canonicalOfflineJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalOfflineJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalOfflineJson(record[key])}`).join(',')}}`;
}

export function sha256Offline(bytes: Uint8Array): string {
  const primes: number[] = [];
  for (let candidate = 2; primes.length < 64; candidate += 1) {
    if (primes.every(prime => candidate % prime !== 0)) primes.push(candidate);
  }
  const hash = primes.slice(0, 8).map(prime => Math.floor((Math.sqrt(prime) % 1) * 4294967296) >>> 0);
  const constants = primes.map(prime => Math.floor((Math.cbrt(prime) % 1) * 4294967296) >>> 0);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const rotate = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const temp1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index] + words[index]) >>> 0;
      const temp2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index] + value) >>> 0; });
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

export function recordedReplayAt(archive: ReplayArchive, cursor: number, branchId = archive.branchId): OfflineReplayFrame {
  const snapshot = archive.snapshots
    .filter(item => item.branchId === branchId && item.sequence <= cursor)
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (!snapshot) throw new Error('Для автономного реплея нет снимка');
  const state = structuredClone(snapshot.state);
  if (snapshot.reducerVersion !== 1) return { state, hash: null, sequence: snapshot.sequence, compatibility: 'INCOMPATIBLE_READ' };
  const events = archive.events
    .filter(event => event.branchId === branchId && event.sequence <= cursor)
    .sort((left, right) => left.sequence - right.sequence);
  for (const event of events) {
    if (event.sequence <= snapshot.sequence) continue;
    if ((event.reducerVersion ?? snapshot.reducerVersion) !== 1) {
      return { state, hash: null, sequence: event.sequence - 1, compatibility: 'INCOMPATIBLE_READ' };
    }
    for (const change of event.changes ?? []) state.domains[change.domain] = structuredClone(change.value);
    if (state.appliedEventIds.includes(event.eventId)) throw new Error('Повторное событие автономного реплея');
    state.appliedEventIds = [...state.appliedEventIds, event.eventId];
    state.eventCauses = { ...state.eventCauses, [event.eventId]: [...(event.causeIds ?? [])] };
  }
  return {
    state,
    hash: sha256Offline(new TextEncoder().encode(canonicalOfflineJson(state))),
    sequence: cursor,
    compatibility: 'REPRODUCIBLE',
  };
}
