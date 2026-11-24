import assert from 'node:assert/strict';
import { appendToChain, canonicalJson, deriveRandom } from '../../src/events/index.ts';

const key = { seed: 7n, exerciseId: 'e', branchId: 'b', purpose: 'movement', ordinal: 4, algorithmVersion: 1 };
const first = deriveRandom(key);
const second = deriveRandom({ ...key });
assert.deepEqual(first, second);
assert.equal(canonicalJson({ b: 1, a: 2n }), '{"a":"2n","b":1}');
const event = appendToChain([], { eventId: '00000000-0000-4000-8000-000000000001', sequence: 1, type: 'instance.paused.v1', payload: { reason: 'проверка' } });
console.log(JSON.stringify({ random: first, eventHash: event.hash }));
