function lattice(seed:number,x:number,y:number) {
  let n=seed^Math.imul(x,0x1f1f1f1f)^Math.imul(y,0x6c8e9cf5);
  n=Math.imul(n^(n>>>16),0x45d9f3b);
  return ((n^(n>>>16))>>>0)/2147483648-1;
}

function noise(seed:number,x:number,y:number) {
  const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const top=lattice(seed,i,j)*(1-sx)+lattice(seed,i+1,j)*sx;
  const bottom=lattice(seed,i,j+1)*(1-sx)+lattice(seed,i+1,j+1)*sx;
  return top*(1-sy)+bottom*sy;
}

// Сценарные полосы и ячейки осадков. Координаты на сфере обеспечивают
// непрерывность поля при переходе через 180-й меридиан.
export function showerIntensity(base:number, variability:number, seed:number, lat:number, lon:number, hours:number, speed:number, direction:number) {
  if (!variability) return base;
  const rad=Math.PI/180, latitude=lat*rad, longitude=lon*rad;
  const x=6371*Math.cos(latitude)*Math.cos(longitude);
  const y=6371*Math.cos(latitude)*Math.sin(longitude);
  const z=6371*Math.sin(latitude);
  const wind=direction*rad, drift=hours*speed*3.6;
  const east=drift*Math.sin(wind), north=drift*Math.cos(wind);
  const u=x*.57+y*.82+east, v=z+north*Math.cos(latitude);
  const bend=18*noise(seed+3,u/52,v/52);
  const along=u+.7*v+bend, across=v-.35*u;
  const texture=noise(seed,along/54,across/27)*.9
    +noise(seed+1,along/20,across/11)*.7
    +noise(seed+2,along/7,across/5)*.32;
  return Math.max(0,base+variability*Math.min(5,base*.85+1.9)*texture);
}
