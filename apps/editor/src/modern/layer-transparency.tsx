import {useState} from 'react';
import type {Season} from './seasonal-atlas';
import type {MapWeatherField} from './weather-layer';

type Field = MapWeatherField | Season;
export type Transparency = Partial<Record<Field, number>>;
const key = 'def_ops.modern.atlas.transparency';

export function transparencyFor(values: Transparency, field: Field) {
  const value = values[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : 24;
}

export function useTransparency() {
  const [values, setValues] = useState<Transparency>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(key) ?? '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  });
  function change(field: Field, value: number) {
    const next = {...values, [field]:value};
    setValues(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Настройка останется до закрытия карты. */ }
  }
  return {values, change};
}

export function TransparencyInput({title,value,onChange}:{title:string;value:number;onChange:(value:number)=>void}) {
  return <label className="layer-transparency">
    <span>Прозрачность <output>{value}%</output></span>
    <input type="range" aria-label={'Прозрачность · '+title} min={0} max={100} value={value}
      aria-valuetext={value+'%'} onChange={event=>onChange(Number(event.target.value))}/>
  </label>;
}
