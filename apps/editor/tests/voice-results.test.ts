// «Итоги» голосом: results.show открывает вкладку и часть; в переигровке разбора хода нет.
import { afterEach, describe, expect, it } from 'vitest';
import { act, register } from '../src/voice/registry';
import { setSectionSource } from '../src/voice/actions/command';
import { releaseResults, resultsActions, type ResultsDeps } from '../src/voice/actions/results';
import type { ResultsPart } from '../src/results-view';

function mount(section: 'replay' | 'command') {
  const log: ResultsPart[] = [];
  const deps: ResultsDeps = { section: () => section, summary: () => null, side: () => 'su', setPart: (p) => { log.push(p); } };
  const get = () => deps;
  const offs = resultsActions(get).map(register);
  return { log, off: () => { offs.forEach((o) => o()); releaseResults(get); } };
}

describe('results.show', () => {
  let offs: (() => void)[] = [];
  afterEach(() => { offs.forEach((o) => o()); offs = []; });
  setSectionSource(() => 'replay');

  it('в игре открывает вкладку «Итоги» и часть compare', async () => {
    const m = mount('command'); offs.push(m.off);
    const r = await act('results.show', { part: 'compare' });
    expect(m.log).toEqual(['compare']);
    expect(String(r)).toMatch(/Итоги/);
  });

  it('в переигровке разбор хода недоступен', async () => {
    const m = mount('replay'); offs.push(m.off);
    const r = await act('results.show', { part: 'turn' });
    expect(String(r)).toMatch(/разбор хода — в игре/i);
    expect(m.log).toEqual([]);
    await act('results.show', { part: 'losses' });
    expect(m.log).toEqual(['losses']);
  });

  it('игра закрыта — действие остаётся у переигровки', async () => {
    const replay = mount('replay'); offs.push(replay.off);
    const game = mount('command');
    game.off();
    await act('results.show', {});
    expect(replay.log).toEqual(['losses']);
  });
});
