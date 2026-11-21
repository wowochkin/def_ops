import type {WeatherState} from './weather';
export interface ElevationWeather {referenceM:number;lapseKPerKm:number}
/** Учебная вертикальная поправка: постоянный заданный градиент и гидростатическое давление.
 * Это допущение, не расчёт горных ветров/осадков. Архивы уже могут иметь высотную коррекцию поставщика.
 */
export function weatherWithElevation(state:WeatherState,elevationM:number|null,model:ElevationWeather):WeatherState&{terrainApplied:boolean;elevationM:number|null}{
 if(!Number.isFinite(model.referenceM)||model.referenceM < -500||model.referenceM > 11000||!Number.isFinite(model.lapseKPerKm)||Math.abs(model.lapseKPerKm)>15)throw Error('Опорная высота от −500 до 11 000 м, градиент от −15 до 15 К/км');
 if(state.provenance!=='synthetic'||elevationM===null||!Number.isFinite(elevationM)||elevationM < -500||elevationM > 11000||state.temperature==null)return {...state,terrainApplied:false,elevationM};
 const dz=elevationM-model.referenceM,temperature=state.temperature-model.lapseKPerKm*(elevationM-(state.temperatureReferenceM??model.referenceM))/1000;
 const meanK=(state.temperature+temperature)/2+273.15;if(meanK<=0)throw Error('Вертикальная поправка вне физического диапазона');
 return {...state,temperature,pressure:state.pressure==null?null:state.pressure*Math.exp(-9.80665*0.0289644*dz/(8.314462618*meanK)),terrainApplied:true,elevationM};
}
