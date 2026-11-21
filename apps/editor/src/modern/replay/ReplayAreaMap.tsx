import {useEffect, useMemo, useRef, useState} from 'react';
import {AtlasMap} from '../AtlasMap';
import {useAtlasCatalog} from '../AtlasCatalog';
import type {AtlasMeta} from '../../../../../services/cartography/src/atlas';
import {atlasOverview} from '../atlas-place-name';
import {centerOf,coversView} from '../environment-region';

type Bounds = readonly [number,number,number,number];

/** Локальная обзорная карта. Рамка показывает фактическую область сценария. */
function OverviewCanvas({bounds, name}: {bounds: Bounds; name: string}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [west,south,east,north] = bounds;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function draw() {
      if (!element) return;
      const ctx = element.getContext('2d');
      const width = element.clientWidth, height = element.clientHeight;
      if (!ctx || !width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width*ratio);
      element.height = Math.round(height*ratio);
      ctx.setTransform(ratio,0,0,ratio,0,0);
      const center = centerOf([west,south,east,north]);
      const longitudeSpan = east >= west ? east-west : east+360-west;
      const aspect = Math.max(.06, Math.cos(center.lat*Math.PI/180));
      const scale = Math.min(width*.64 / Math.max(.55,longitudeSpan*aspect), height*.68 / Math.max(.38,north-south));
      const x = (lon:number) => width/2 + (lon-center.lon)*scale*aspect;
      const y = (lat:number) => height/2 - (lat-center.lat)*scale;
      const visible = [center.lon-width/(2*scale*aspect),center.lat-height/(2*scale),
        center.lon+width/(2*scale*aspect),center.lat+height/(2*scale)];
      ctx.fillStyle = '#102e3a'; ctx.fillRect(0,0,width,height);
      const cities: {name:string;x:number;y:number}[] = [];
      for (const offset of [-360,0,360]) {
        const atlas = atlasOverview(visible,offset);
        for (const [, , , rings] of atlas.regions) {
          ctx.beginPath();
          for (const ring of rings) {
            let first = true;
            atlas.visitRing(ring,(lon,lat)=>{
              if (first) ctx.moveTo(x(lon+offset),y(lat));
              else ctx.lineTo(x(lon+offset),y(lat));
              first=false;
            });
            ctx.closePath();
          }
          ctx.fillStyle='#294a4b'; ctx.fill('evenodd');
          ctx.strokeStyle='#527171'; ctx.lineWidth=.85; ctx.stroke();
        }
        for(const [label,,lon,lat] of atlas.places) cities.push({name:label,x:x(lon+offset),y:y(lat)});
      }
      const step = [0.1,.25,.5,1,2,5,10,20,45,90].find(s=>s*scale>55) ?? 90;
      ctx.beginPath();
      for(let a=Math.ceil(visible[0]/step)*step;a<=visible[2];a+=step){ctx.moveTo(x(a),0);ctx.lineTo(x(a),height);}
      for(let a=Math.ceil(visible[1]/step)*step;a<=visible[3];a+=step){ctx.moveTo(0,y(a));ctx.lineTo(width,y(a));}
      ctx.lineWidth=.8;ctx.strokeStyle='rgba(163,198,185,.15)';ctx.stroke();
      const left = x(center.lon-longitudeSpan/2), top=y(north), w=longitudeSpan*scale*aspect, h=(north-south)*scale;
      ctx.fillStyle='rgba(168,214,194,.10)';ctx.fillRect(left,top,w,h);
      ctx.strokeStyle='#97c5b5';ctx.setLineDash([4,4]);ctx.strokeRect(left,top,w,h);ctx.setLineDash([]);
      ctx.font='13px "Roboto Condensed", sans-serif';
      const labels:{x:number;y:number;width:number}[]=[];
      for(const p of cities.sort((a,b)=>Math.hypot(a.x-width/2,a.y-height/2)-Math.hypot(b.x-width/2,b.y-height/2))){
        const tw=ctx.measureText(p.name).width+16;
        if(p.x<6||p.y<15||p.x+tw>width||p.y>height-12||labels.some(l=>Math.abs(p.y-l.y)<24&&p.x<l.x+l.width&&p.x+tw>l.x))continue;
        labels.push({...p,width:tw});
        ctx.fillStyle='#b7d2c9';ctx.beginPath();ctx.arc(p.x,p.y,2.4,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#1d3639';ctx.lineWidth=3;ctx.strokeText(p.name,p.x+7,p.y+4);
        ctx.fillStyle='#deebe4';ctx.fillText(p.name,p.x+7,p.y+4);
      }
    }
    draw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    observer?.observe(element);
    return () => observer?.disconnect();
  },[west,south,east,north]);
  return <canvas ref={canvas} role="img" aria-label={'Обзорная карта области «'+name+'»'} />;
}

type Catalog = ReturnType<typeof useAtlasCatalog>;
type MapProps = {bounds: Bounds; name: string};
type LocalBounds = AtlasMeta['bounds'];

function extent([west, south, east, north]: LocalBounds) {
  return (east >= west ? east - west : east + 360 - west) * (north - south);
}
function AreaFigure({bounds, name, catalog}: MapProps & {catalog: Catalog}) {
  const [west,south,east,north] = bounds;
  const box = useMemo<LocalBounds>(() => [west,south,east,north], [west,south,east,north]);
  const group = useMemo(() => catalog?.groups.filter(item => coversView(item.bounds, box))
    .sort((a,b) => extent(a.bounds) - extent(b.bounds))[0], [catalog,box]);
  const [failed, setFailed] = useState(false);
  const local = group && !failed;
  const caption = local ? 'Локальный атлас'
    : !catalog ? 'Открываем атлас…'
    : catalog.failed || failed ? 'Атлас недоступен · Natural Earth'
    : 'Нет скачанной карты области · Natural Earth';
  return <figure className="replay-area-map">
    {local ? <AtlasMap bounds={box} packages={group.maps}
      minZoom={Math.min(...group.maps.map(item => item.minzoom))}
      onUnavailable={() => setFailed(true)} />
      : <OverviewCanvas bounds={box} name={name} />}
    <figcaption><span>{name}</span><span>{caption}</span></figcaption>
  </figure>;
}
function AreaFromAtlas(props: MapProps) {
  const catalog = useAtlasCatalog();
  return <AreaFigure key={props.bounds.join(',')} {...props} catalog={catalog}/>;
}
export function ReplayAreaMap({catalog, ...props}: MapProps & {catalog?: Catalog}) {
  return catalog === undefined ? <AreaFromAtlas {...props}/>
    : <AreaFigure key={props.bounds.join(',')} {...props} catalog={catalog}/>;
}
