import 'fake-indexeddb/auto';
import {expect, it} from 'vitest';
import {createSession, restartSession, submitDecision} from '../src/modern/replay/session';
import {listSessions, readSession, saveSession} from '../src/modern/replay/archive';
import {example} from '../src/modern/replay/example';

it('возобновляет сохранённый период, предотвращает перезапись из другого окна и отделяет повтор от исходного сеанса', async () => {
  const initial=await saveSession(createSession(example));
  const {summary,session}=await readSession(initial.summary.id);
  const changed=submitDecision(session,'a',session.now,{choice:'compare',note:'Личная запись А',materialIds:['register']});
  const writes=await Promise.allSettled([saveSession(changed,summary),saveSession(changed,summary)]);
  expect(writes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(String((writes.find(result=>result.status==='rejected') as PromiseRejectedResult).reason)).toContain('другом окне');
  const restored=await readSession(summary.id);
  expect(restored.session.pending.a?.note).toBe('Личная запись А');
  const copy=await saveSession(restartSession(restored.session),undefined,summary.original);
  expect(copy.summary.id).not.toBe(summary.id);
  expect(copy.summary.original).toBe(summary.id);
  expect(copy.session.pending).toEqual({});
  const visible=await listSessions();
  expect(visible.map(s=>s.id)).toContain(copy.summary.id);
  expect(JSON.stringify(visible)).not.toContain('Личная запись А');
  expect(JSON.stringify(visible)).not.toContain(example.sides.a.objective);
});
