export type RegionalSurfaceContext={elevationM:number|null;landcoverClass:number|null;sourceIds:string[];demId?:string;landcoverId?:string;referenceM?:number;lapseKPerKm?:number};
export type RegionalContextStatus={mode:'REGIONAL_ONLY'|'COMPLETE'|'PARTIAL';limitations:string[];sourceIds:readonly string[];elevationM:number|null;landcoverClass:number|null};
const classes=new Set([10,20,30,40,50,60,70,80,90,95,100]);
export function regionalContext(input:{elevationM:number|null;landcoverClass:number|null;demId?:string;landcoverId?:string;referenceM?:number;lapseKPerKm?:number}):RegionalSurfaceContext{
 if(input.elevationM!==null&&(!Number.isFinite(input.elevationM)||input.elevationM< -500||input.elevationM>11000))throw Error('Некорректная высота местного контекста');
 if(input.landcoverClass!==null&&!classes.has(input.landcoverClass))throw Error('Неизвестный класс покрова');
 if(input.referenceM!==undefined&&(!Number.isFinite(input.referenceM)||input.referenceM< -500||input.referenceM>11000)||input.lapseKPerKm!==undefined&&(!Number.isFinite(input.lapseKPerKm)||Math.abs(input.lapseKPerKm)>15))throw Error('Некорректная высотная модель');
 return {...input,sourceIds:[...new Set([input.demId,input.landcoverId].filter((id):id is string=>Boolean(id)))]};
}
export function regionalContextStatus(context?:RegionalSurfaceContext):RegionalContextStatus{
 const limitations:string[]=[];
 if(!context?.demId)limitations.push('Ограниченный режим: ЦМР не выбрана');else if(context.elevationM===null)limitations.push('Недостаточно данных о высоте');
 if(!context?.landcoverId)limitations.push('Ограниченный режим: покров не выбран');else if(context.landcoverClass===null)limitations.push('Недостаточно данных о покрове');
 return {mode:!context?.demId&&!context?.landcoverId?'REGIONAL_ONLY':limitations.length?'PARTIAL':'COMPLETE',limitations,sourceIds:context?.sourceIds??[],elevationM:context?.elevationM??null,landcoverClass:context?.landcoverClass??null};
}
