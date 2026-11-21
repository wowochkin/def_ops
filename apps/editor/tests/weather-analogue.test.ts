import {expect,it} from 'vitest';
import type {WeatherDataset} from '../../../packages/core/src/weather';
import {historicalWindow,selectAnalogue} from '../src/modern/weather-analogue';

function archive(year:number,rain:number[]):WeatherDataset{
  return {version:1,id:String(year),name:'Станция',source:{kind:'observation',title:'Станция',license:'тест',spatialResolution:'точка',temporalResolution:'час'},
    rows:rain.map((p,i)=>({lon:13,lat:52,time:new Date(Date.UTC(year,10,1,i)).toISOString(),precipitation:p,soilTemperature:i/4,snowDepth:0,visibility:null}))};
}
it('выбирает непрерывный типичный отрезок по средним выборки и сохраняет порядок архивных часов',()=>{
  const normal=archive(2020,[0,1,1,1]);
  const sets=[archive(2019,[0,0,0,0]),normal,archive(2021,[0,2,2,2])];
  expect(selectAnalogue(sets,10,3,'typical').dataset).toBe(normal);
  expect(selectAnalogue(sets,10,3,'wet')).toMatchObject({longestWet:3,peak:2,wetHours:3});
  expect(selectAnalogue(sets,10,3,'wet').mean).toEqual([null,2,0,.5,null,null]);
  expect(()=>selectAnalogue(sets,6,3,'wet')).toThrow(/нет непрерывного/);
});
it('отличает затяжные осадки от краткого пика и пропуски от сухих часов',()=>{
  const full=archive(2020,[0,1,1,1,1]);
  const burst=archive(2021,[0,0,20,0,0]);
  expect(selectAnalogue([burst,full],10,4,'wet').dataset).toBe(full);
  expect(selectAnalogue([full],10,2.5,'wet').wetHours).toBe(2.5);
  full.rows[2].precipitation=null;
  expect(()=>selectAnalogue([full],10,4,'wet')).toThrow();
  full.rows.splice(2,1);
  expect(()=>selectAnalogue([full],10,3,'wet')).toThrow();
  expect(()=>selectAnalogue([archive(2020,[0,0,0])],10,2,'wet')).toThrow(/порога/);
  expect(historicalWindow(2020,1,48)).toEqual({start:'2020-02-01',end:'2020-03-02'});
});

it('не разрывает эпизод в полночь и позволяет искать сильные осадки отдельно',()=>{
 const a=archive(2020,Array.from({length:60},(_,i)=>i>=19&&i<=30?6:0));
 expect(selectAnalogue([a],10,16,'wet',5)).toMatchObject({longestWet:12,peak:6});
 expect(()=>selectAnalogue([a],10,16,'wet',8)).toThrow(/порога/);
});
