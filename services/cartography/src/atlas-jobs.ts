/** Фоновые операции каталога: тяжёлая работа в Worker, Python получает отмену. */
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { writeAtomic } from './tiles';
import type { AtlasMeta, ConvertOptions } from './atlas';
export type AtlasInput = { kind:'mbtiles'|'geojson'|'osm'|'dem'|'landcover'|'openfreemap'; missingSheets?:number; file?:string; url?:string; urls?:string[]; expectedSha256?:string; options:ConvertOptions };
export interface AtlasJob {id:string;state:'running'|'done'|'error'|'cancelled';stage:string;done:number;total:number;error?:string;result?:AtlasMeta;input:AtlasInput}
export class AtlasJobs {
 private active=new Map<string,{worker:Worker;job:AtlasJob;tenant:string}>();
 constructor(readonly root:string,readonly atlasRoot:string) {}
 private dir(t:string) {return path.join(this.root,createHash('sha256').update(t).digest('hex'));}
 private save(t:string,j:AtlasJob) {return writeAtomic(path.join(this.dir(t),`${j.id}.json`),Buffer.from(JSON.stringify(j)));}
 async list(t:string):Promise<AtlasJob[]> {
  const files=await fs.readdir(this.dir(t)).catch(()=>[]),out:AtlasJob[]=[];
  for(const f of files.filter(f=>/^[a-f0-9-]+\.json$/.test(f))) {const job=JSON.parse(await fs.readFile(path.join(this.dir(t),f),'utf8')) as AtlasJob;if(job.state==='running'&&!this.active.has(job.id)){job.state='error';job.error='Операция прервана остановкой сервиса. Можно продолжить загрузку.';await this.save(t,job);}out.push(job);}
  return out;
 }
 async start(t:string,input:AtlasInput,resumeId?:string) {
  if([...this.active.values()].some(a=>a.tenant===t))throw Error('Дождитесь текущей операции или отмените её');
  const id=resumeId??randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Неверный номер задания');
  const job:AtlasJob={id,state:'running',stage:'Подготовка',done:0,total:0,input};await this.save(t,job);
  const data={root:this.atlasRoot,work:path.join(this.dir(t),id),tenant:t,input};
  let worker:Worker;
  if(!import.meta.url.endsWith('.ts'))worker=new Worker(new URL('./atlas-worker.mjs',import.meta.url),{workerData:data});
  else {
   const tsx=path.join(path.dirname(createRequire(import.meta.url).resolve('tsx/package.json')),'dist/esm/api/index.mjs');
   const boot=`import { register } from ${JSON.stringify(pathToFileURL(tsx).href)};register();await import(${JSON.stringify(new URL('./atlas-worker.ts',import.meta.url).href)});`;
   worker=new Worker(new URL(`data:text/javascript,${encodeURIComponent(boot)}`),{workerData:data});
  }
  this.active.set(id,{worker,job,tenant:t});
  let saving=Promise.resolve();const save=()=>{saving=saving.then(()=>this.save(t,job)).catch(()=>{});};
  worker.on('message',(m:Partial<AtlasJob>)=>{if(job.state!=='running')return;Object.assign(job,m);save();});
  worker.on('error',e=>{if(job.state==='running'){job.state='error';job.error=e.message;save();}});
  worker.on('exit',code=>{if(job.state==='running'){job.state='error';job.error=`Обработчик завершился до результата (код ${code})`;save();}void saving.finally(()=>this.active.delete(id));});
  return job;
 }
 async hasRunningForMap(tenant:string,mapId:string){
  return (await this.list(tenant)).some(job=>job.state==='running'&&job.result?.id===mapId);
 }
 async removeTileCache(tenant:string,mapId:string){
  for(const job of await this.list(tenant)){
   if(job.state==='done' && job.input.kind==='openfreemap' && job.result?.id===mapId && /^[a-f0-9-]{36}$/.test(job.id)){
    await fs.rm(path.join(this.dir(tenant),job.id,'source-tiles.mbtiles'),{force:true});
   }
  }
 }
 async pruneForMap(tenant:string,mapId:string,bounds:readonly number[]) {
  const sameBounds=(left:readonly number[])=>left.length===bounds.length&&left.every((value,index)=>value===bounds[index]);
  const jobs=(await this.list(tenant)).filter(job=>job.result?.id===mapId||sameBounds(job.input.options.bounds));
  if(jobs.some(job=>job.state==='running'))return {deletedJobs:[],running:true};
  const deletedJobs:string[]=[];
  for(const job of jobs){
   if(!/^[a-f0-9-]{36}$/.test(job.id))continue;
   deletedJobs.push(job.id);
   await fs.rm(path.join(this.dir(tenant),`${job.id}.json`),{force:true});
   await fs.rm(path.join(this.dir(tenant),job.id),{recursive:true,force:true});
  }
  return {deletedJobs,running:false};
 }
 async pruneFinished(tenant:string) {
  const deletedJobs:string[]=[];
  for(const job of await this.list(tenant)){
   if(job.state==='running'||!/^[a-f0-9-]{36}$/.test(job.id))continue;
   deletedJobs.push(job.id);
   await fs.rm(path.join(this.dir(tenant),`${job.id}.json`),{force:true});
   await fs.rm(path.join(this.dir(tenant),job.id),{recursive:true,force:true});
  }
  return {deletedJobs};
 }
 async cancel(t:string,id:string) {const a=this.active.get(id);if(!a||a.tenant!==t)throw Error('Активное задание не найдено');a.job.state='cancelled';a.job.stage='Отменено';a.worker.postMessage('cancel');const timer=setTimeout(()=>void a.worker.terminate(),1500);timer.unref();await this.save(t,a.job);return a.job;}
 stop() {for(const a of this.active.values()) {a.worker.postMessage('cancel');setTimeout(()=>void a.worker.terminate(),1500).unref();}}
}
