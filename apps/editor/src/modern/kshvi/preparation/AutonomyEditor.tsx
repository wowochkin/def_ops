import { useState } from 'react';

export type AutonomyEditorProfile = { version: number; level: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CUSTOM'; categories: { category: string; intensity: number; maxSeverity: number }[] };
const titles: Record<string, string> = { CONTROL: 'управления и связи', RECONNAISSANCE: 'разведки', MANEUVER: 'манёвра', COMBAT: 'боевых эпизодов', ENGINEERING: 'инженерных событий', ENVIRONMENT: 'среды', LOGISTICS: 'МТО', MAINTENANCE: 'ремонта', PERSONNEL: 'личного состава', MEDICAL: 'медицинских процессов', SETTLEMENTS: 'населённых пунктов', INTERACTION: 'взаимодействия' };

export function AutonomyEditor({ profile }: { profile: AutonomyEditorProfile }) {
  const [intensities, setIntensities] = useState<Record<string, number>>(() => Object.fromEntries(profile.categories.map(category => [category.category, category.intensity])));
  return <section>
    <h2>Автономное наращивание · {profile.level}</h2>
    {profile.categories.map(category => <div key={category.category}>
      <label>Интенсивность {titles[category.category] ?? category.category}<input type="number" min={0} value={intensities[category.category]} onChange={event => setIntensities(current => ({ ...current, [category.category]: Number(event.target.value) }))} /></label>
      {intensities[category.category] === 0 && <p>Вероятностные события {titles[category.category] ?? category.category} отключены; плановые и реактивные сохранены</p>}
    </div>)}
  </section>;
}
