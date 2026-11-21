/** Обновление номенклатурной сверки из сохранённых видимых таблиц; без сетевых запросов. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseInventory, classifyEquipment, normalizeModelName } from './modern-inventory-parser.mjs';
const cache = process.argv[2];
if(!cache) throw new Error('Укажите каталог сохранённых DOM-таблиц');
const root='packages/knowledge/data/modern';
const corpus=JSON.parse(fs.readFileSync(root+'/corpus.json','utf8'));
const schema=JSON.parse(fs.readFileSync(root+'/passport-schema.json','utf8'));
const extraClasses={
 'small-arms':'Стрелковое оружие', 'mortar':'Миномёт', 'armoured-car':'Бронеавтомобиль и разведывательная машина',
 'air-defence-system':'Комплекс ПВО', 'anti-tank-weapon':'Противотанковое средство', 'grenade-launcher':'Гранатомёт',
 'personal-equipment':'Индивидуальное снаряжение', 'unclassified-equipment':'Категория требует уточнения',
};
for(const [id,title] of Object.entries(extraClasses)){
 if(!corpus.objectClasses.some(c=>c.id===id))corpus.objectClasses.push({id,title});
 if(!schema.profiles.some(c=>c.id===id))schema.profiles.push({id,title,required:['role_description','configuration_scope','environment_limits','equipment_description']});
}
// Повторный импорт заменяет только записи этого импортёра, не первичное исследование.
corpus.representatives=corpus.representatives.filter(r=>!r.id.includes('-inventory-'));
corpus.sources=corpus.sources.filter(s=>!s.id.includes('-inventory-'));
const baseline={purpose:'nomenclature-crosscheck',complete:false,note:'Перечни — вторичные источники обозначений. Это не подтверждение текущего наличия и не полные технические паспорта. Составные обозначения сохраняются одной строкой до предметной проверки. Исторические и неоднозначные строки учитываются в исключениях; количества и дислокация не импортируются.',pages:[]};
for(const filename of fs.readdirSync(cache).filter(f=>f.endsWith('-dom.json')).sort()){
 const key=filename.replace('-dom.json','');const country=key.split('-')[0],domain=key.split('-')[1]??'ground';
 const p=JSON.parse(fs.readFileSync(path.join(cache,filename),'utf8'));
 const parsed=parseInventory(p,domain);const sourceId=country.toLowerCase()+'-inventory-'+key.toLowerCase();
 corpus.sources.push({id:sourceId,title:p.title.replace(' - Wikipedia',''),publisher:'Wikipedia — авторы указанной статьи',url:p.permanentLink?new URL(p.permanentLink,p.url).href:p.url,kind:'encyclopedia',scopeDate:null,accessedOn:'2026-11-17',readLevel:'page',note:'Прочитаны видимые номенклатурные таблицы. Вторичный энциклопедический перечень: используется для обозначений и предварительной категории, не для подтверждения текущих запасов, статуса или характеристик. Строки поставок и будущих программ требуют отдельной проверки.'});
 const rows=[];
 for(const item of parsed.records){
  const title=item.title;const normal=normalizeModelName(title);
  const matches=corpus.representatives.filter(r=>r.countryContext===country && normalizeModelName(r.title)===normal);
  let record;
  if(matches.length===1){record=matches[0];if(!record.sources.includes(sourceId))record.sources.push(sourceId);}
  else {
   const objectClass=classifyEquipment(item);
   record={id:country.toLowerCase()+'-inventory-'+crypto.createHash('sha256').update(normal).digest('hex').slice(0,16),kind:'equipment_model',countryContext:country,title,objectClass,
    summary:'Обозначение из справочного перечня; технический паспорт требует исследования.',sources:[sourceId],relatedOrganizations:[],originCountries:[],operatorCountries:[],status:'draft',
    note:'Номенклатурная запись из энциклопедии. Не подтверждает оператора, текущее наличие или готовность. Составные строки не разделяются на мнимые независимые модели. Предварительная категория требует предметной проверки.',
    granularity:item.aliases.length>1 || domain==='navy'?'family':'model',parentModel:null,
    passport:{profile:objectClass,simulationValidated:false,characteristics:[]},catalogueOnly:true};
   corpus.representatives.push(record);
  }
  // Детали происхождения не смешиваются с проверенными техническими характеристиками.
  record.inventoryReferences??=[];
  const reference={source:sourceId,section:item.section,designation:title,modelUrl:item.modelUrl?new URL(item.modelUrl,p.url).href:null,catalogueStatus:item.catalogueStatus};
  if(!record.inventoryReferences.some(r=>r.source===sourceId && r.designation===title))record.inventoryReferences.push(reference);
  rows.push({designation:title,record:record.id,section:item.section,modelUrl:reference.modelUrl,catalogueStatus:item.catalogueStatus});
 }
 const skipped=Object.entries(parsed.skipped.reduce((m,x)=>(m[x.reason]=(m[x.reason]??0)+1,m),{})).map(([reason,rows])=>({reason,rows}));
 baseline.pages.push({country,domain,source:sourceId,url:p.url,records:rows,unresolved:parsed.unresolved,excluded:skipped});
}
fs.writeFileSync(root+'/corpus.json',JSON.stringify(corpus,null,2)+'\n');
fs.writeFileSync(root+'/passport-schema.json',JSON.stringify(schema,null,2)+'\n');
fs.mkdirSync(root+'/inventory',{recursive:true});
fs.writeFileSync(root+'/inventory/baseline.json',JSON.stringify(baseline,null,2)+'\n');
const coverage=JSON.parse(fs.readFileSync(root+'/research/coverage.json'));
for(const c of coverage.countries){const rs=corpus.representatives.filter(r=>r.countryContext===c.country);c.models=rs.length;c.characteristics=rs.reduce((n,r)=>n+r.passport.characteristics.length,0);c.numericCharacteristics=rs.reduce((n,r)=>n+r.passport.characteristics.filter(c=>typeof c.value==='number').length,0);c.catalogueOnly=rs.filter(r=>r.catalogueOnly).length;}
fs.writeFileSync(root+'/research/coverage.json',JSON.stringify(coverage,null,2)+'\n');
console.log(JSON.stringify({pages:baseline.pages.length,catalogueRows:baseline.pages.reduce((n,p)=>n+p.records.length,0),cards:corpus.representatives.length,catalogueOnly:corpus.representatives.filter(r=>r.catalogueOnly).length,unresolved:baseline.pages.reduce((n,p)=>n+p.unresolved.length,0)}));
