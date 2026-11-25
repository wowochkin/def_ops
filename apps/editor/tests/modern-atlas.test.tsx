// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {AtlasView} from '../src/modern/AtlasView';
const mocks=vi.hoisted(()=>({setStyle:vi.fn(),init:vi.fn()}));
vi.mock('maplibre-gl',()=>({addProtocol:vi.fn(),Map:class {constructor(options:unknown){mocks.init(options);}setStyle=mocks.setStyle;addControl(){}on(){}remove(){}fitBounds(){}},NavigationControl:class{}}));
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();mocks.setStyle.mockClear();});
it('опрос фонового задания не перезагружает стиль открытой карты',async()=>{
 const card={id:'test',name:'Тестовая карта',format:'pbf',kind:'vector',minzoom:0,maxzoom:14,bounds:[12,51,14,53],attribution:'test',layers:[{id:'roads'}],bytes:100,sha256:'abc'};
 vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>{
  const p=String(input);const data=p.endsWith('/environment/weather')?[]:p.endsWith('/atlas')?[card]:p.endsWith('/sources')?[]:p.endsWith('/runtime')?{ok:true}:p.endsWith('/jobs')?[{id:'job',state:'running',stage:'Работа',done:1,total:100,input:{options:{name:'Подготовка другого набора'}}}]:p.endsWith('/style')?{version:8,sources:{atlas:{type:'vector',tiles:['/local/{z}/{x}/{y}']}},layers:[{id:'layer-0-line',type:'line',source:'atlas','source-layer':'roads'}]}:null;
  return new Response(JSON.stringify(data),{status:200});
 }));
 render(<AtlasView/>);fireEvent.click(await screen.findByRole('checkbox',{name:'Тестовая карта'}));
 await waitFor(()=>expect(mocks.setStyle.mock.calls.some(([style])=>Object.keys(style.sources).includes('test-atlas'))).toBe(true));
 const count=mocks.setStyle.mock.calls.length;
 await new Promise(r=>setTimeout(r,3250));
 expect(mocks.setStyle).toHaveBeenCalledTimes(count);
},8000);

it('единая область применяется к погоде и к подбору тайлов; дороги и подписи выше покрова', async()=>{
 const bounds=[29,48,32,51];
 const maps=[
  {id:'osm',name:'Вектор OSM',kind:'vector',layers:[{id:'roads'}]},
  {id:'cover',name:'WorldCover',kind:'raster',thematic:true,layers:[]}
 ].map(p=>({...p,bounds,bytes:300,minzoom:4,maxzoom:12}));
 let request:unknown;
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const path=String(input);
  if(path.endsWith('/resolve'))request=JSON.parse(String(init?.body)).bounds;
  const data=path.endsWith('/atlas')?maps:path.endsWith('/osm/style')?{version:8,sources:{atlas:{type:'vector'}},layers:[{id:'layer-0-line',type:'line',source:'atlas'},{id:'layer-0-label',type:'symbol',source:'atlas'}]}:path.endsWith('/cover/style?coverage=xyz')?{version:8,sources:{atlas:{type:'raster'}},layers:[{id:'raster',type:'raster',source:'atlas'}]}:path.endsWith('/resolve')?{files:[],bytes:0,missing:[],note:''}:path.endsWith('/runtime')?{ok:true}:[];
  return new Response(JSON.stringify(data));
 }));
 render(<AtlasView/>);
 const input=screen.getByLabelText(/Рамка: запад/);
 fireEvent.change(input,{target:{value:bounds.join(',')}});fireEvent.blur(input);
 fireEvent.click(screen.getByRole('button',{name:'Погода'}));
 expect((screen.getByLabelText('Широта') as HTMLInputElement).value).toBe('49.5');
 expect((screen.getByLabelText('Долгота') as HTMLInputElement).value).toBe('30.5');
 fireEvent.click(screen.getByRole('button',{name:'Загрузка'}));
 fireEvent.change(screen.getByLabelText('Формат источника'),{target:{value:'landcover'}});
 fireEvent.click(screen.getByRole('button',{name:'Подобрать исходные файлы'}));
 await waitFor(()=>expect(request).toEqual(bounds));
 fireEvent.click(screen.getByRole('button',{name:'Слои'}));
 fireEvent.click(await screen.findByRole('checkbox',{name:'Вектор OSM'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'WorldCover'}));
 await waitFor(()=>{const layers=mocks.setStyle.mock.calls.at(-1)?.[0]?.layers.map((l:{id:string})=>l.id);expect(layers).toEqual(['background','cover-raster','osm-layer-0-line','osm-layer-0-label']);});
 const style=mocks.setStyle.mock.calls.at(-1)![0];
 expect(style.layers.find((layer:{id:string})=>layer.id==='cover-raster').paint['raster-fade-duration']).toBe(0);
 expect(mocks.init.mock.lastCall?.[0]).toHaveProperty('zoomLevelsToOverscale',undefined);
});

it('слои с одинаковым названием включаются независимо в разных областях',async()=>{
 const maps=['Запад','Восток'].map((name,i)=>({id:'area'+i,name,kind:'vector',format:'pbf',bounds:[10+i,40,11+i,41],minzoom:5,maxzoom:12,bytes:120,layers:[{id:'water'}]}));
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
  const p=String(input);
  const data=p.endsWith('/atlas')?maps:p.endsWith('/style')?{version:8,sources:{atlas:{type:'vector'}},layers:[{id:'layer-0-fill',source:'atlas',type:'fill'}]}:p.endsWith('/runtime')?{ok:true}:[];
  return new Response(JSON.stringify(data));
 }));
 render(<AtlasView/>);
 const west=await screen.findByRole('checkbox',{name:'Запад'});
 fireEvent.click(west);fireEvent.click(screen.getByRole('checkbox',{name:'Восток'}));
 const water=screen.getAllByRole('checkbox',{name:'Водоёмы'});
 fireEvent.click(water[0]);
 expect((water[1] as HTMLInputElement).checked).toBe(true);
 await waitFor(()=>{
  const style=mocks.setStyle.mock.calls.at(-1)?.[0];
  expect(style?.layers.find((l:{id:string})=>l.id==='area0-layer-0-fill')?.layout.visibility).toBe('none');
  expect(style?.layers.find((l:{id:string})=>l.id==='area1-layer-0-fill')?.layout.visibility).toBe('visible');
 });
 fireEvent.change(screen.getByRole('searchbox',{name:'Найти область'}),{target:{value:'Восток'}});
 expect(screen.queryByRole('checkbox',{name:'Запад'})).toBeNull();
 expect((screen.getByRole('checkbox',{name:'Восток'}) as HTMLInputElement).checked).toBe(true);
});

it('при смене местности подставляет новое имя и восстанавливает ручное имя после перезапуска',async()=>{
 const first=[13.3,52.45,13.5,52.6],second=[151.1,-33.95,151.3,-33.8];
 const card={id:'old',name:'Мой район',kind:'vector',layers:[],bounds:first,bytes:100,minzoom:8,maxzoom:12};
 let sent: {options:{name:string}}|undefined;
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith('/atlas/download'))sent=JSON.parse(String(init?.body));
   return new Response(JSON.stringify(url.endsWith('/atlas')?[card]:url.endsWith('/runtime')?{ok:true}:[]));
 }));
 const app=render(<AtlasView/>);
 await screen.findByRole('checkbox',{name:'Берлин'});
 fireEvent.click(screen.getByRole('button',{name:'Загрузка'}));
 const upload=app.container.querySelector('.atlas-panel:not([hidden])')!;
 function field(){return upload.querySelector('input[maxlength="100"]') as HTMLInputElement;}
 expect(field().value).toBe('Берлин');
 fireEvent.change(field(),{target:{value:'Площадь у музея'}});fireEvent.blur(field());
 const bounds=screen.getByLabelText(/Рамка: запад/);
 fireEvent.change(bounds,{target:{value:second.join(',')}});fireEvent.blur(bounds);
 expect(field().value).toBe('Сидней');
 fireEvent.change(bounds,{target:{value:first.join(',')}});fireEvent.blur(bounds);
 expect(field().value).toBe('Площадь у музея');
 expect(screen.getByRole('button',{name:'Данные области'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Загрузка'}));
 fireEvent.change(screen.getByLabelText('Формат источника'),{target:{value:'openfreemap'}});
 fireEvent.click(screen.getByRole('button',{name:'Скачать район'}));
 await waitFor(()=>expect(sent?.options.name).toBe('Площадь у музея'));
 app.unmount();render(<AtlasView/>);
 expect(await screen.findByRole('checkbox',{name:'Площадь у музея'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Вернуть автоназвание'}));
 expect(await screen.findByRole('checkbox',{name:'Берлин'})).toBeTruthy();
});
