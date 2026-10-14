/** Пересборка из базы: изменились коридоры правил или нормативы-итоги операции — запись в журнал операции. */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Entry } from '@def-ops/knowledge';
import * as store from '../src/kb/store';
import { recompile } from '../src/sim/kb-recompile';
import { changesSince, getEdits } from '../src/sim/userdata';

const OP = 'berlin-1945-tasks';
const norm = (facts: Entry['facts']): Entry => ({ id: 'u:norms', category: 'organization', title: 'Нормативы (вымышленный документ)', summary: '', status: 'checked', origin: 'user', updatedAt: '2026-01-01', facts });

describe('основа правил при пересборке', () => {
  it('первая сборка — без записи об основе правил; новый норматив — коридор в журнале; итог — тоже', async () => {
    await recompile(OP);
    const e0 = await getEdits(OP);
    expect(e0.kb?.rules?.corridors.advance).toBeDefined();
    expect(e0.log.some((l) => l.text.startsWith('основа правил'))).toBe(false);
    const was = e0.kb!.rules!.corridors.prepared;

    await store.put('entries', norm([{ key: 'numbers', value: 'подготовленная оборона ×1,5', claim: { kind: 'param', param: 'defense.prepared', value: 1.5 }, source: 'doc:x', reliability: 'A', check: { by: 'human', at: '', results: [] } }]));
    expect((await recompile(OP)).changed.some((x) => x.startsWith('коридор prepared'))).toBe(true);
    const e1 = await getEdits(OP);
    expect(e1.kb!.rules!.corridors.prepared).toEqual([1.35, 1.65]);
    expect(e1.kb!.rules!.corridors.prepared).not.toEqual(was);
    const last = e1.log[e1.log.length - 1];
    expect(last.text).toMatch(/^основа правил из базы: коридор prepared/);
    expect(changesSince(e1)).toContainEqual(last);

    // без изменений базы — без новой записи
    expect((await recompile(OP)).changed).toEqual([]);

    await store.put('entries', norm([
      { key: 'numbers', value: 'подготовленная оборона ×1,5', claim: { kind: 'param', param: 'defense.prepared', value: 1.5 }, source: 'doc:x', reliability: 'A', check: { by: 'human', at: '', results: [] } },
      { key: 'numbers', value: 'темп 2–6 км/сут', claim: { kind: 'outcome', measure: 'pace', scenario: OP, subject: 'su_8gva', from: '1945-04-16T05:00', to: '1945-04-18T05:00', range: [2, 6], unit: 'км/сут' }, source: 'doc:x', reliability: 'B', check: { by: 'human', at: '', results: [] } },
    ]));
    await recompile(OP);
    const e2 = await getEdits(OP);
    expect(e2.log[e2.log.length - 1].text).toMatch(/итог \+ pace su_8gva 1945-04-16–1945-04-18: 2–6 км\/сут/);
  }, 30000);
});
