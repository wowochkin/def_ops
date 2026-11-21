/** Читает только номенклатуру видимых таблиц. Количества, дислокация и примечания не экспортируются. */
export const clean = s => String(s ?? '').replace(/\[[^\]]*\]/g, '').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
export function normalizeModelName(s) {
 const homoglyphs = {А:'A',В:'B',С:'C',Е:'E',Н:'H',К:'K',М:'M',О:'O',Р:'P',Т:'T',Х:'X',а:'a',с:'c',е:'e',о:'o',р:'p',х:'x'};
 return clean(s).replace(/[АВСЕНКМОРТХасеорх]/g,c=>homoglyphs[c]).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
}
const empty = s => !s || /^[–—−?\-\s]+$/.test(s) || /^(unknown|n\/a|none|неизвестно)$/i.test(s);
const usefulLinks = cell => (cell?.links ?? []).filter(a=>/^\/wiki\//.test(a.href) && !/^\/wiki\/(File|Help|Category|Wikipedia|Template|Файл|Категория):/i.test(a.href) && !/^\[|edit|править/.test(a.text));
export function parseInventory(page, domain = 'ground') {
 const records = [], unresolved = [], skipped = []; const seen = new Set();
 for (const table of page.tables) {
  if(table.headings.some(h=>/^(Structure|Organisation|Organization|Ranks|History|Структура)$/i.test(clean(h)))) { skipped.push({table:table.index,reason:"Таблица вне номенклатуры техники"});continue; }
  let headers=[], active=[], section=''; let foundHeader=false;
  for (let ri=0; ri<table.rows.length;ri++) {
   const raw=table.rows[ri]; if(!raw.length)continue;
   const labels=raw.map(c=>clean(c.text).toLowerCase().replace(/\s+/g,' '));
   const hasModelHeader=labels.some(s=>/^(name|model|model\/programme|aircraft|weapon|class|type|тип|модель)$/.test(s));
   if(raw.filter(c=>c.header).length>=raw.length/2 && raw.length>1 && hasModelHeader){headers=labels;active=[];foundHeader=true;continue;}
   // Секции внутри таблицы не занимают ячейки продолжающихся rowspan.
   if(raw.length===1 && (raw[0].colspan>1 || !foundHeader)){section=clean(raw[0].text).replace(/\s*\([\d ,+≥–-]+\)\s*$/,'');continue;}
   if(!foundHeader){skipped.push({table:table.index,row:ri,reason:'Нет однозначной колонки модели/класса'});continue;}
   const expanded=[]; let col=0;
   for(const c of raw){while(active[col]?.left>0){expanded[col]=active[col].cell;col++;}for(let k=0;k<c.colspan;k++){expanded[col]=c;if(c.rowspan>1)active[col]={cell:c,left:c.rowspan};col++;}}
   for(let i=0;i<headers.length;i++)if(!expanded[i] && active[i]?.left>0)expanded[i]=active[i].cell;
   for(const a of active)if(a?.left>0)a.left--;
   let ni;
   if(domain==='navy')ni=headers.findIndex(s=>s==='class');
   else ni=headers.findIndex(s=>/^(model|model\/programme|aircraft|name|weapon|модель)$/.test(s));
   if(ni<0 && domain!=='navy')ni=headers.findIndex(s=>s==='тип'||s==='type');
   // Некоторые подробные морские таблицы не имеют Class. Их имена корпусов не импортируем.
   if(ni<0){skipped.push({table:table.index,row:ri,reason:'Нет колонки класса корабля'});continue;}
   const modelCell=expanded[ni], model=clean(modelCell?.text);
   if(empty(model)){unresolved.push({table:table.index,row:ri,reason:'Модель/класс не указан'});continue;}
   if(model.length>170 || /^(total|всего|active|retired|on order|planned)\b/i.test(model)){unresolved.push({table:table.index,row:ri,reason:'Вместо модели сводная или неоднозначная строка'});continue;}
   const context=[...table.headings,section].map(clean).filter(Boolean);
   if(context.some(s=>/retired|former|historical|heritage|post.wwii|cold war|world war|inter.war|историчес|снят.*вооруж|ceremonial|proposed|potential|cancelled/i.test(s))){skipped.push({table:table.index,row:ri,reason:'Историческая, церемониальная или только предлагаемая номенклатура'});continue;}
   const roleIndex=headers.findIndex((s,i)=>i!==ni && /^(type|role|назначение|тип)$/.test(s));
   const role=clean(expanded[roleIndex]?.text).replace(/\n/g,' / ');
   // Перенос строки внутри скобок/расшифровки не образует новую модель.
   const lines=model.split('\n').map(clean).filter(Boolean);
   const names=[lines.join(' / ')];
   for(const title of names){
    if(empty(title)||/^\d+(?:[.,]\d+)?$/.test(title)){unresolved.push({table:table.index,row:ri,reason:'Неоднозначное обозначение'});continue;}
    const key=normalizeModelName(title);if(seen.has(key))continue;seen.add(key);
    const links=usefulLinks(modelCell).filter(a=>normalizeModelName(a.text)===key);
    records.push({title,aliases:lines.length>1?lines:[],domain,section:context.join(' → '),role,modelUrl:links[0]?.href??null,table:table.index,row:ri,
      catalogueStatus:context.some(s=>/future|planned|on order|будущ|перспектив/i.test(s))?'prospective':'listed'});
   }
  }
 }
 return {records,unresolved,skipped};
}
export function classifyEquipment(r) {
 const t=r.title.toLowerCase(), role=r.role.toLowerCase(), ctx=r.section.toLowerCase();
 const s=role || ctx; const all=`${role} ${ctx}`;
 if(r.domain==='navy')return /submarine|подвод/.test(all+' '+t)?'submarine':'surface-vessel';
 if(/unmanned|uav|ucav|беспилот|дрон|камикадзе/.test(all))return /ground|назем|ugv/.test(s)?'unmanned-ground':/surface|надвод/.test(s)?'unmanned-surface':'unmanned-air';
 if(/helicopter|rotorcraft|вертол/.test(all))return 'helicopter';
 if(r.domain==='air' && /fixed.wing|combat aircraft|trainer|transport|fighter|bomber|самол/.test(all))return 'aircraft';
 const rules=[
  ['electronic-warfare',/electronic warfare|jamm|рэб|радиоэлектрон/],
  ['radar-sensor',/radar|sensor|рлс|радар|радиолокац|оптико/],
  ['communications',/communication|radio station|связи|радиостанц/],
  ['air-defence-system',/air.defen[cs]e|surface.to.air|зенит|пво/],
  ['rocket-artillery',/multiple.*rocket|rocket artillery|рсзо|реактивн.*систем.*залп/],
  ['mortar',/mortar|миномёт|миномет/],
  ['self-propelled-artillery',/self.propelled.*(artillery|howitzer|gun)|самоходн.*(артиллер|гаубиц|установ)/],
  ['towed-artillery',/towed|howitzer|буксируем|гаубиц/],
  ['tank',/main battle tank|combat tank|основной.*танк/],
  ['ifv',/infantry fighting|\bifv\b|боевая машина (пехоты|десанта)|боевые машины (пехоты|десанта)/],
  ['apc',/personnel carrier|\bapc\b|бронетранспорт/],
  ['armoured-car',/armou?red car|protected.*vehicle|mrap|бронеавтомоб|бронеавтомашин|разведывательн.*машин/],
  ['anti-tank-weapon',/anti.tank|atgm|противотанк|птрк|птрд/],
  ['small-arms',/rifle|pistol|machine gun|submachine|shotgun|small arms|винтовк|пистолет|пулемёт|пулемет|автомат[ыа ]/],
  ['grenade-launcher',/grenade launcher|гранатомёт|гранатомет/],
  ['mine',/land ?mine|mine system|anti.personnel mine|мина\b|мины\b|мины|минные/],
  ['munition',/missile|grenade|ammunition|bomb|rocket|ракета|ракеты|гранат|боеприпас/],
  ['engineering',/engineering|bridg|recovery vehicle|mine.clear|инженер|мостоуклад|разминир|эвакуац/],
  ['support-vehicle',/truck|logistic|ambulance|utility vehicle|transport vehicle|грузов|санитар|автомобил/],
  ['personal-equipment',/uniform|camouflage|helmet|body armou?r|clothing|individual equipment|каск|шлем|бронежилет/],
  ['aircraft',/aircraft|fighter|bomber|trainer|reconnaissance|transport|самолёт|самолет/],
 ];
 // Сначала назначение строки; широкий заголовок «бронетехника» не должен задавать тип всем.
 for(const [id,re] of rules)if(re.test(s))return id;
 for(const [id,re] of rules)if(re.test(ctx))return id;
 if(/tanks?$|танки/.test(ctx))return 'tank';
 if(r.domain==='air' && /attack|multirole|reconnaissance|transport|airlift|aew|tanker|electronic|utility|patrol|training|fighter|surveillance/i.test(role))return 'aircraft';
 return 'unclassified-equipment';
}
