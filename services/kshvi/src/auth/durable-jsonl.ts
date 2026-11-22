import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AuditSink = { append(input: Record<string, unknown>): unknown };

export function readDurableJsonLines<Value>(stateFile?: string): Value[] {
  if (!stateFile || !existsSync(stateFile)) return [];
  const content = readFileSync(stateFile, 'utf8');
  if (!content.trim()) return [];
  try {
    return content.trimEnd().split('\n').map(line => JSON.parse(line) as Value);
  } catch (error) {
    throw new Error(`Повреждён durable-журнал ${stateFile}`, { cause: error });
  }
}

export function appendDurableJsonLine(stateFile: string | undefined, value: unknown): void {
  if (!stateFile) return;
  mkdirSync(dirname(stateFile), { recursive: true });
  const descriptor = openSync(stateFile, 'a');
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
