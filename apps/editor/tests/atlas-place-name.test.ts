import {describe,expect,it} from 'vitest';
import {areaKey,automaticAreaName,datasetName} from '../src/modern/atlas-place-name';
import type {WeatherRegion} from '../../../packages/core/src/weather-grid';
const berlin:WeatherRegion['bounds']=[13.3,52.45,13.5,52.6];
describe('Название местности по рамке',()=>{
  it('выбирает населённый пункт и сохраняет имена отдельных наборов',()=>{
    expect(automaticAreaName(berlin)).toBe('Берлин');
    expect(datasetName('Мой район',berlin)).toBe('Берлин');
    expect(datasetName('Мой район',berlin,'Музей')).toBe('Музей');
    expect(datasetName('Снимок с высотами',berlin)).toBe('Снимок с высотами');
  });
  it('различает область, город Южного полушария, океан на 180-м меридиане и всю Землю',()=>{
    expect(automaticAreaName([11.28,47.35,11.29,47.36])).toMatch(/Тироль/i);
    expect(automaticAreaName([151.1,-33.95,151.3,-33.8])).toMatch(/Сидней/);
    expect(automaticAreaName([179,-1,-179,1])).toMatch(/Тихий океан/i);
    expect(automaticAreaName([-180,-85,180,85])).toBe('Весь мир');
    expect(areaKey(berlin)).toBe('13.300000,52.450000,13.500000,52.600000');
  });
});
