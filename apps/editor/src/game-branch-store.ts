/** Хранилище ходов ветвей игры — IndexedDB окна (тот же банк, что у переигровок). */
import { deleteGameBranch, gameBranchKeys, getGameBranch, putGameBranch } from './sim/userdata';
import type { BranchStore } from './game-branches';

export const idbBranchStore: BranchStore = {
  put: (key, p) => putGameBranch({ id: key, turns: p.turns, ...(p.doctrines ? { doctrines: p.doctrines } : {}) }),
  get: async (key) => { const d = await getGameBranch(key); return d ? { turns: d.turns as never, ...(d.doctrines ? { doctrines: d.doctrines } : {}) } : undefined; },
  del: (key) => deleteGameBranch(key),
  keys: () => gameBranchKeys(),
};
