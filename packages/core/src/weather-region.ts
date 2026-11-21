import {simulateWeather,type WeatherScenario,type WeatherState} from './weather';
import {weatherGrid,type WeatherRegion} from './weather-grid';
export {weatherGrid,type WeatherRegion} from './weather-grid';
export function simulateWeatherRegion(s:WeatherScenario,region:WeatherRegion,time:string):{region:WeatherRegion;time:string;cells:{lon:number;lat:number;state:WeatherState}[]}{return {region,time,cells:weatherGrid(region).map(([lon,lat])=>({lon,lat,state:simulateWeather(s,lat,lon,time)}))};}
