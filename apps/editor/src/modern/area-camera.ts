import type {BBox} from '@def-ops/core';

// Видимый прямоугольник внутри области, с пропорциями окна в проекции карты.
export function areaCameraBounds([west,south,east,north]:BBox,width:number,height:number,fill:boolean):[[number,number],[number,number]] | null {
  const limit=85.05112878;
  south=Math.max(-limit,south);
  north=Math.min(limit,north);
  if(north<=south)return null;
  if(east<west)east+=360;
  if(!fill||width<=0||height<=0)return [[west,south],[east,north]];
  const toY=(lat:number)=>Math.asinh(Math.tan(lat*Math.PI/180));
  const toLat=(y:number)=>Math.atan(Math.sinh(y))*180/Math.PI;
  const middleX=(west+east)*Math.PI/360;
  const middleY=(toY(south)+toY(north))/2;
  const halfHeight=Math.min(toY(north)-toY(south),(east-west)*Math.PI/180*height/width)/2;
  const halfWidth=halfHeight*width/height;
  return [[(middleX-halfWidth)*180/Math.PI,toLat(middleY-halfHeight)],[(middleX+halfWidth)*180/Math.PI,toLat(middleY+halfHeight)]];
}
