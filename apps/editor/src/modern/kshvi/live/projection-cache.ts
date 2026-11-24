export type PrivilegedState = {
  storage: Map<string, unknown>;
  caches: Map<string, unknown>;
  deleteDatabase: (name: string) => Promise<void>;
  removeProjector: () => void;
};

export async function clearPrivilegedState(state: PrivilegedState): Promise<void> {
  for (const key of [...state.storage.keys()]) if (key.startsWith('kshvi.') || key.startsWith('def_ops.kshvi.')) state.storage.delete(key);
  state.caches.clear();
  await Promise.all([state.deleteDatabase('kshvi-projections'), state.deleteDatabase('kshvi-drafts')]);
  state.removeProjector();
}
