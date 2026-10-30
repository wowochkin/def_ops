// @vitest-environment happy-dom
// «Показать штаб на карте» без keep: штаб становится пунктом своей ступени (post.choose), уровень карты — его ступень.
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePost } from '../src/CommandPost';
import { hqMapLevel } from '../src/map-level-scale';
import type { LevelId } from '../src/map-level-scale';

const hq = (id: string, name: string, echelon: string, parent: string | null) => [id, { control: 'agent', led: false, name, echelon, parent }] as const;
const view = {
  start: '1945-04-16T05:00', time: '1945-04-17T05:00', places: [], intel: [],
  own: [{ id: 'su_d1', name: '35 гв. сд', echelon: 'division', parent: 'su_4gsk', status: 'active', at: [14.5, 52.6] }],
  command: { mode: 'agents', led: [], requests: [], historical: [], documents: [], petitions: [], hqs: Object.fromEntries([
    hq('su_stavka', 'Ставка ВГК', 'high_command', null), hq('su_1bf', '1-й Белорусский фронт', 'front', 'su_stavka'),
    hq('su_8gva', '8-я гв. армия', 'army', 'su_1bf'), hq('su_5ua', '5-я ударная армия', 'army', 'su_1bf'), hq('su_4gsk', '4-й гв. ск', 'corps', 'su_8gva'),
  ]) },
} as never;

afterEach(cleanup);

describe('post.choose — штаб пунктом его ступени', () => {
  const use = () => {
    const [level, setLevel] = useState<LevelId>('front');
    const post = usePost(view, level, setLevel, [], () => undefined, false, true);
    return { level, post };
  };
  it('армия — пункт уровня «Армия», уровень карты переключается; выбран именно этот штаб, а не первый', () => {
    const r = renderHook(use);
    let lv: LevelId | null = null;
    act(() => { lv = r.result.current.post.choose('su_5ua'); });
    expect(lv).toBe('army');
    expect(r.result.current.level).toBe('army');
    expect(r.result.current.post.issuer).toBe('su_5ua');
  });
  it('корпус — уровень «Корпус» (не «Дивизия»); дивизия приказов не отдаёт — null, уровень прежний', () => {
    const r = renderHook(use);
    act(() => { r.result.current.post.choose('su_4gsk'); });
    expect(r.result.current.level).toBe('corps');
    let lv: LevelId | null = 'front';
    act(() => { lv = r.result.current.post.choose('su_d1'); });
    expect(lv).toBeNull();
    expect(r.result.current.level).toBe('corps');
  });
  it('map.hq без keep: уровень — выбранная ступень, иначе ступень по эшелону, иначе прежний', () => {
    expect(hqMapLevel('army', 'army', 'front')).toBe('army');
    expect(hqMapLevel(null, 'division', 'front')).toBe('division');
    expect(hqMapLevel(null, 'unknown', 'front')).toBe('front');
  });
});
