import {canJointReview, type Session} from './session';

export interface SessionSummary {
  id: string;
  title: string;
  area: string;
  updated: string;
  status: Session['status'];
  periodCount: number;
  disclosed: boolean;
  revision: number;
  original: string;
}

export interface SavedSession {summary: SessionSummary; session: Session}
const name = 'def_ops_modern_replay';

async function openArchive(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('summaries', {keyPath: 'id'});
      request.result.createObjectStore('sessions');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  const db = await openArchive();
  try {
    const rows: SessionSummary[] = await requestResult(db.transaction('summaries').objectStore('summaries').getAll());
    return rows.sort((a,b) => b.updated.localeCompare(a.updated));
  } finally { db.close(); }
}

export async function readSession(id: string): Promise<SavedSession> {
  const db = await openArchive();
  try {
    const tx = db.transaction(['sessions', 'summaries']);
    const [summary, session] = await Promise.all([
      requestResult<SessionSummary | undefined>(tx.objectStore('summaries').get(id)),
      requestResult<Session | undefined>(tx.objectStore('sessions').get(id)),
    ]);
    if (!summary || !session) throw Error('Сеанс не найден. Откройте список сеансов ещё раз.');
    return {summary, session};
  } finally { db.close(); }
}

/** Журнал и его общедоступная карточка записываются в одной транзакции. */
export async function saveSession(session: Session, previous?: SessionSummary, original?: string): Promise<SavedSession> {
  const id = previous?.id ?? crypto.randomUUID();
  const summary: SessionSummary = {
    id, original: previous?.original ?? original ?? id, revision: (previous?.revision ?? 0) + 1,
    title: session.scenario.title, area: session.scenario.area, updated: new Date().toISOString(),
    status: session.status, periodCount: session.periods.length, disclosed: canJointReview(session),
  };
  const db = await openArchive();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['summaries','sessions'], 'readwrite');
      const summaries = tx.objectStore('summaries');
      const get = summaries.get(id);
      let conflict = false;
      get.onsuccess = () => {
        if (get.result?.revision !== previous?.revision) {
          conflict = true;
          tx.abort();
          return;
        }
        summaries.put(summary);
        tx.objectStore('sessions').put(session, id);
      };
      tx.onabort = () => reject(conflict
        ? Error('Сеанс изменён в другом окне. Откройте его заново из списка.')
        : tx.error ?? Error('Не удалось сохранить сеанс на этом компьютере.'));
      tx.oncomplete = () => resolve();
    });
    return {summary, session};
  } finally { db.close(); }
}
