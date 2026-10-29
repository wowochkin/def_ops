import { describe, expect, it } from 'vitest';
import { zoomForScale } from '@def-ops/core';
import { flyToHq } from '../src/engine/free-center';
import { ECHELON_LEVEL, levelDefaultScale } from '../src/map-level-scale';

describe('переезд карты к штабу', () => {
  const at: [number, number] = [14.3, 52.6];
  it('плавно, масштаб по ступени штаба', () => {
    const calls: unknown[] = [];
    flyToHq({ getView: () => ({ center: [13, 52], zoom: 7, bearing: 0 }), setView: () => calls.push('jump'), flyTo: (v) => calls.push(v) }, at, ECHELON_LEVEL.army);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ center: at, zoom: zoomForScale(at[1], levelDefaultScale('army')) });
  });
  it('движок без плавного перехода — прыжком; ступени — фронт, армия, корпус, дивизия', () => {
    const calls: unknown[] = [];
    flyToHq({ getView: () => ({ center: [13, 52], zoom: 7, bearing: 0 }), setView: (v) => calls.push(v) }, at, 'corps');
    expect(calls[0]).toMatchObject({ center: at, zoom: zoomForScale(at[1], levelDefaultScale('corps')) });
    expect(ECHELON_LEVEL).toMatchObject({ front: 'front', army: 'army', corps: 'corps', division: 'division', high_command: 'stavka' });
  });
});
