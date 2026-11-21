import {it,expect} from 'vitest';
import {areaCameraBounds} from '../src/modern/area-camera';
it('заполняет широкое окно без растяжения покрытия и сохраняет полный обзор по запросу',()=>{
 const frame=areaCameraBounds([13.3,52.45,13.5,52.6],1500,860,true)!;
 expect(frame[0][0]).toBeCloseTo(13.3,10);
 expect(frame[1][0]).toBeCloseTo(13.5,10);
 expect(frame[0][1]).toBeGreaterThan(52.45);
 expect(frame[1][1]).toBeLessThan(52.6);
 expect(areaCameraBounds([13.3,52.45,13.5,52.6],1500,860,false)).toEqual([[13.3,52.45],[13.5,52.6]]);
});
it('при пересечении антимеридиана центр остаётся в области',()=>{
 const frame=areaCameraBounds([179,10,-179,11],400,900,true)!;
 expect((frame[0][0]+frame[1][0])/2).toBeCloseTo(180,9);
 expect(frame[0][1]).toBeCloseTo(10,9);
 expect(frame[1][1]).toBeCloseTo(11,9);
});
