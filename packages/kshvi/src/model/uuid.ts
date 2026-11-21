export function newUUID(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Среда не поддерживает криптографический UUID');
  return globalThis.crypto.randomUUID();
}
