import {useMemo} from 'react';
import {climateAt} from '../../../../packages/core/src/weather-climate';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';

const months=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

// Равновеликие полосы широты: каждая из 81 выборки представляет равную площадь рамки.
export function monthlyClimate([west,south,east,north]:WeatherRegion['bounds']) {
  const width=east<west?east-west+360:east-west;
  const rad=Math.PI/180, low=Math.sin(south*rad), high=Math.sin(north*rad);
  return months.map((_,month)=>{
    const time=Date.UTC(2000,month,15);
    let total=0;
    for(let y=0;y<9;y++){
      const lat=Math.asin(low+(high-low)*(y+0.5)/9)/rad;
      for(let x=0;x<9;x++)total+=climateAt(lat,west+width*(x+0.5)/9,time).temperature;
    }
    return total/81;
  });
}

export function RegionalClimate({bounds}:{bounds:WeatherRegion['bounds']}) {
  const values=useMemo(()=>monthlyClimate(bounds),[bounds]);
  return <section className="area-climate" aria-label="Климат выбранной области">
    <h3>Годовой ход температуры</h3>
    <p className="env-note">Средняя температура воздуха по выбранной области, °C</p>
    <dl>{values.map((v,i)=><div key={months[i]}><dt>{months[i]}</dt><dd>{v.toLocaleString('ru-RU',{maximumFractionDigits:1,minimumFractionDigits:1})}</dd></div>)}</dl>
    <small>Климатическая норма NOAA PSL · 1991–2020</small>
  </section>;
}
