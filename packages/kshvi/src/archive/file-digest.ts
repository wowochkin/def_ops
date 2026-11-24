import { createHash } from 'node:crypto';
import { canonicalJson } from '../events/canonical';

export function sha256File(data: Uint8Array | string): string {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex');
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
