import {weatherGrid, type WeatherRegion} from '../../../../packages/core/src/weather-grid';

export function loadRegion(): WeatherRegion {
  try {
    const saved = JSON.parse(localStorage.getItem('def_ops.modern.weather.region') ?? 'null');
    weatherGrid(saved);
    return saved;
  } catch {
    return {bounds:[13.3,52.45,13.5,52.6], cols:5, rows:5};
  }
}

export function centerOf([west,south,east,north]: WeatherRegion['bounds']) {
  const middle = (west + (east < west ? east + 360 : east)) / 2;
  return {lon: middle > 180 ? middle - 360 : middle, lat:(south + north) / 2};
}

export function coversView(coverage: WeatherRegion['bounds'], view: WeatherRegion['bounds']) {
  const span=(west:number,east:number)=>east>=west?east-west:360+east-west;
  const width=span(coverage[0],coverage[2]);
  const offset=((view[0]-coverage[0])%360+360)%360;
  return coverage[1]<=view[1] && coverage[3]>=view[3]
    && (width===360 || offset+span(view[0],view[2])<=width+1e-8);
}
