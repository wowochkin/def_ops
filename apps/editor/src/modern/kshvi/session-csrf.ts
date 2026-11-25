export const DEFAULT_KSHVI_API = '/api/kshvi';
export function csrfStorageKey(baseUrl = DEFAULT_KSHVI_API): string {
  return `def_ops.kshvi.csrf:${baseUrl.replace(/\/$/, '')}`;
}
export function readSessionCsrf(baseUrl = DEFAULT_KSHVI_API, allowLegacy = false): string {
  try {
    const scoped = globalThis.sessionStorage?.getItem(csrfStorageKey(baseUrl));
    if (scoped !== null && scoped !== undefined) return scoped;
    return allowLegacy && baseUrl === DEFAULT_KSHVI_API ? globalThis.sessionStorage?.getItem('def_ops.kshvi.csrf') ?? '' : '';
  } catch { return ''; }
}
export function saveSessionCsrf(baseUrl: string, value: string): void {
  try { globalThis.sessionStorage?.setItem(csrfStorageKey(baseUrl), value); } catch { /* память вкладки недоступна */ }
}
export function clearSessionCsrf(baseUrl: string): void {
  try {
    globalThis.sessionStorage?.removeItem(csrfStorageKey(baseUrl));
    if (baseUrl === DEFAULT_KSHVI_API) globalThis.sessionStorage?.removeItem('def_ops.kshvi.csrf');
  } catch { /* память вкладки недоступна */ }
}
