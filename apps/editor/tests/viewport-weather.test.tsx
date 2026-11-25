// @vitest-environment happy-dom
import {render, waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {monthlyClimate} from '../src/modern/RegionalClimate';
import {coversView} from '../src/modern/environment-region';
import {WeatherField} from '../src/modern/WeatherField';
import type {WeatherScenario} from '../../../packages/core/src/weather';
import type {WeatherRegion} from '../../../packages/core/src/weather-grid';
import type {WeatherOverlay} from '../src/modern/weather-layer';

const scenario:WeatherScenario={version:1,seed:3,start:'2020-11-01T00:00:00Z',temperature:4,humidity:65,pressure:1013,windSpeed:1,windDirection:0,cloud:50,precipitation:0,variability:0,transitionHours:3};
it.each(['pressure','temperature'] as const)('при включённой ЦМР %s остаётся внутри модельной области, включая участки без высоты',async field=>{
 const region:WeatherRegion={bounds:[10,49,11,50],cols:3,rows:3};
 const onOverlay=vi.fn<(layer:WeatherOverlay)=>void>();
 const {rerender}=render(<WeatherField region={region} viewBounds={[9,48,12,51]} scenario={scenario} time={scenario.start} onOverlay={onOverlay} terrain={{referenceM:0,lapseKPerKm:6.5}} onPoint={()=>{}} setField={()=>{}} field={field}/>);
 await waitFor(()=>expect(onOverlay).toHaveBeenCalled());
 const original=onOverlay.mock.lastCall![0];
 const raster=original.rasters[0];
 expect(raster.coordinates).toEqual([[10,50],[11,50],[11,49],[10,49]]);
 expect(raster.pixels[3]).toBe(255);
 rerender(<WeatherField region={region} viewBounds={[-180,-85,180,85]} scenario={scenario} time={scenario.start} onOverlay={onOverlay} terrain={{referenceM:0,lapseKPerKm:6.5}} onPoint={()=>{}} setField={()=>{}} field={field}/>);
 await waitFor(()=>expect(onOverlay.mock.lastCall![0].rasters[0].coordinates).toEqual([[10,50],[11,50],[11,49],[10,49]]));
 expect(onOverlay.mock.lastCall![0].rasters[0].pixels).toEqual(raster.pixels);
 expect(onOverlay.mock.lastCall![0].data).toEqual(original.data);
 rerender(<WeatherField region={region} viewBounds={[0,0,1,1]} scenario={scenario} time={scenario.start} onOverlay={onOverlay} onPoint={()=>{}} setField={()=>{}} field={field}/>);
 await waitFor(()=>expect(onOverlay.mock.lastCall![0].rasters).toEqual([]));
});

it('годовой ход для выбранной области учитывает полушарие и переход через 180°',()=>{
 const north=monthlyClimate([10,48,14,52]), south=monthlyClimate([142,-39,146,-36]);
 expect(north[6]).toBeGreaterThan(north[0]);
 expect(south[0]).toBeGreaterThan(south[6]);
 expect(monthlyClimate([179,-20,-179,-19]).every(Number.isFinite)).toBe(true);
});

it('обзорная подложка учитывает границы локальной карты и линию перемены дат',()=>{
 expect(coversView([179,-10,-170,10],[179.5,-9,-172,8])).toBe(true);
 expect(coversView([179,-10,-170,10],[178,-9,-172,8])).toBe(false);
 expect(coversView([-180,-85,180,85],[179,-2,-174,8])).toBe(true);
 expect(coversView([10,49,11,50],[9,48,12,51])).toBe(false);
});


it('не дублирует узлы погоды при покрытии всей карты мира', async()=>{
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 const onOverlay=vi.fn<(layer:WeatherOverlay)=>void>();
 render(<WeatherField region={{bounds:[-180,-85.05112878,180,85.05112878],cols:5,rows:5}} scenario={scenario} time={scenario.start} onOverlay={onOverlay} onPoint={()=>{}} setField={()=>{}} field="temperature"/>);
 await waitFor(()=>expect(onOverlay).toHaveBeenCalled());
 const rasters=onOverlay.mock.lastCall![0].rasters;
 expect(rasters.length).toBeGreaterThan(0);
 expect(rasters[0]!.coordinates[0][0]).toBe(-180);
 expect(rasters.at(-1)!.coordinates[1][0]).toBe(180);
 expect(errors.mock.calls.flat().join('\n')).not.toContain('same key');
 errors.mockRestore();
});
