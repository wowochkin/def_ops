export interface WeatherRegion {bounds:[number,number,number,number];cols:number;rows:number}
export function weatherGrid(region:WeatherRegion):[number,number][]{
 const {bounds:b,cols,rows}=region;
 if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||Math.abs(b[0])>180||Math.abs(b[2])>180||Math.abs(b[1])>90||Math.abs(b[3])>90||b[1]>=b[3]||b[0]===b[2]||!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||rows<2||cols>25||rows>25)throw Error('Область WGS84 и сетка от 2×2 до 25×25');
 const east=b[2]<b[0]?b[2]+360:b[2],points:[number,number][]=[];
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const lon=b[0]+(east-b[0])*x/(cols-1);points.push([((lon+180)%360+360)%360-180,b[3]-(b[3]-b[1])*y/(rows-1)]);}
 const unique=new Map<string,[number,number]>();for(const point of points)unique.set(point.join('/'),point);return [...unique.values()];
}
