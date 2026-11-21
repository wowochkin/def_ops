import type {BBox} from '../../../../packages/core/src/cartography';
import {centerOf} from './environment-region';
import {saveEnvironmentFile} from './environment-api';
import {CopySource} from './CopySource';

export function geoJsonExample(bounds:BBox):GeoJSON.FeatureCollection{
 const {lat,lon}=centerOf(bounds),offset=(bounds[3]-bounds[1])*.18;
 return {type:'FeatureCollection',features:[
   {type:'Feature',properties:{name:'Условная точка',layer:'Метки'},geometry:{type:'Point',coordinates:[lon,lat]}},
   {type:'Feature',properties:{name:'Условная линия',layer:'Линии'},geometry:{type:'LineString',coordinates:[[lon,lat-offset],[lon,lat+offset]]}}
 ]};
}
const catalogs=[
 {name:'Natural Earth — природные объекты',url:'https://github.com/nvkelso/natural-earth-vector/tree/master/geojson'},
 {name:'geoBoundaries — административные границы',url:'https://www.geoboundaries.org/countryDownloads.html'}
];
export function GeoJsonHelp({bounds}: {bounds:BBox}){
 return <section className="env-auto-source">
   <h3>Объекты из файла</h3>
   <p>Выберите файл .geojson с точками, линиями или полигонами в пределах области. Когда обработка завершится, откройте «Задания загрузки» и нажмите «Показать карту».</p>
   <button onClick={()=>saveEnvironmentFile('primer-obektov.geojson',geoJsonExample(bounds))}>Скачать пример для этой области</button>
   <details><summary>Где взять GeoJSON</summary>{catalogs.map(c=><p key={c.url}><a href={c.url} target="_blank" rel="noreferrer" className="env-source-link">{c.name} ↗</a> <CopySource url={c.url} name={c.name}/></p>)}<p>Скачайте GeoJSON из каталога и откройте его кнопкой «Выбрать исходный файл». В поле «Источник и лицензия» укажите сведения из карточки набора.</p></details>
   <details><summary>Формат своего файла</summary><p>Коллекция FeatureCollection, координаты WGS84 в порядке «долгота, широта». Свойство properties.layer задаёт имя слоя. Без него объекты попадут в слой objects.</p></details>
 </section>;
}
