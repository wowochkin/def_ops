export const WORKSPACE_EXERCISE_KEY = 'def_ops.kshvi.workspace.exercise';
export const WORKSPACE_SESSION_KEY = 'def_ops.kshvi.workspace.session';

export function readWorkspaceReference<T>(key: string): T | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { id?: unknown } | null;
    return value && typeof value.id === 'string' && value.id ? value as T : null;
  } catch {
    return null;
  }
}

export function writeWorkspaceReference(key: string, value: { id: string } | null): void {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* ссылка остаётся только в памяти текущего React-экрана */ }
}
