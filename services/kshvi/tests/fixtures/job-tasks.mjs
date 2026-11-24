import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function returnPayload({ payload }) {
  return payload;
}
export function progress({ payload, reportProgress }) {
  reportProgress(50);
  return payload;
}
export async function wait({ payload }) {
  await pause(payload.ms ?? 20);
  return payload.result ?? 'done';
}
export function never() {
  return new Promise(() => {});
}
export function failOnce({ payload }) {
  mkdirSync(dirname(payload.marker), { recursive: true });
  let attempts = 0;
  try { attempts = Number(readFileSync(payload.marker, 'utf8')); } catch { attempts = 0; }
  attempts += 1;
  writeFileSync(payload.marker, String(attempts));
  if (attempts === 1) throw new Error('Временный сбой');
  return 'recovered';
}
export async function timeline({ payload, attempt }) {
  const entries = JSON.parse(readFileSync(payload.file, 'utf8'));
  entries.push({ attempt, kind: 'start', at: Date.now() });
  writeFileSync(payload.file, JSON.stringify(entries));
  await pause(attempt > 1 ? (payload.retryMs ?? payload.ms) : payload.ms);
  const completed = JSON.parse(readFileSync(payload.file, 'utf8'));
  completed.push({ attempt, kind: 'end', at: Date.now() });
  writeFileSync(payload.file, JSON.stringify(completed));
  return { attempt };
}
