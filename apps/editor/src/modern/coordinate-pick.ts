/** WGS84: клик на копии мира и короткая рамка через антимеридиан. */
export function pickPoint(lon:number,lat:number):[number,number]{if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>90)throw Error('Недопустимые координаты');return [Number(((((lon+180)%360)+360)%360-180).toFixed(6)),Number(lat.toFixed(6))];}
export function pickBounds(a:[number,number],b:[number,number]):[number,number,number,number]|null{
 const [x,y]=pickPoint(...a),[u,v]=pickPoint(...b);if(x===u||y===v)return null;
 const lo=Math.min(x,u),hi=Math.max(x,u);return hi-lo>180?[hi,Math.min(y,v),lo,Math.max(y,v)]:[lo,Math.min(y,v),hi,Math.max(y,v)];
}
export function selectionGeometry(mode:'point'|'bounds',v:number[]):GeoJSON.FeatureCollection{
 if(!v.every(Number.isFinite))return {type:'FeatureCollection',features:[]};
 let geometry:GeoJSON.Geometry|undefined;
 if(mode==='point'&&v.length===2&&Math.abs(v[0])<=180&&Math.abs(v[1])<=90)geometry={type:'Point',coordinates:v};
 if(mode==='bounds'&&v.length===4&&Math.abs(v[0])<=180&&Math.abs(v[2])<=180&&v[1]<v[3]&&Math.abs(v[1])<=85.051129&&Math.abs(v[3])<=85.051129){
  const ring=(w:number,e:number)=>[[w,v[1]],[e,v[1]],[e,v[3]],[w,v[3]],[w,v[1]]];geometry=v[0]<=v[2]?{type:'Polygon',coordinates:[ring(v[0],v[2])]}:{type:'MultiPolygon',coordinates:[[ring(v[0],180)],[ring(-180,v[2])]]};
 }
 return {type:'FeatureCollection',features:geometry?[{type:'Feature',properties:{},geometry}]:[]};
}
