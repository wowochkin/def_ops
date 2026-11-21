import {it,expect} from 'vitest';
import {pickPoint,pickBounds,selectionGeometry} from '../src/modern/coordinate-pick';
it('нормализует долготу карты и округляет координаты',()=>{expect(pickPoint(190,52.12345678)).toEqual([-170,52.123457]);expect(()=>pickPoint(0,NaN)).toThrow();});
it('область не зависит от порядка углов и выбирает короткую дугу через антимеридиан',()=>{expect(pickBounds([14,53],[13,52])).toEqual([13,52,14,53]);expect(pickBounds([170,50],[-170,40])).toEqual([170,40,-170,50]);expect(pickBounds([1,1],[1,2])).toBeNull();});
it('область через антимеридиан отображается двумя полигонами, а не всей Землёй',()=>{const g=selectionGeometry('bounds',[170,40,-170,50]);expect(g.features[0].geometry.type).toBe('MultiPolygon');expect(selectionGeometry('point',[13,52]).features[0].geometry.type).toBe('Point');expect(selectionGeometry('point',[13,95]).features).toEqual([]);});
