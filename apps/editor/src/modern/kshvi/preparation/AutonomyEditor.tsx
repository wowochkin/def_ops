import { useEffect, useState } from 'react';
import {
  attemptsPerOperationalHour, createAutonomyProfile, updateAutonomyProfile,
  type AutonomyLevel, type AutonomyProfile,
} from '../../../../../../packages/kshvi-events/src/profile/autonomy-profile';
import { METHODICAL_AUTONOMY_PROFILE_V1 } from '../../../../../../packages/kshvi-events/src/profile/intensity-levels';
import { EVENT_CATEGORIES, type EventCategory } from '../../../../../../packages/kshvi-events/src/model/event-template';

export type AutonomyEditorProfile = AutonomyProfile | Readonly<{
  version: number;
  level: AutonomyLevel;
  categories: readonly { category: string; intensity: number; maxSeverity: number }[];
}>;

const titles: Record<EventCategory, string> = {
  control: 'управления и связи', reconnaissance: 'разведки', maneuver: 'манёвра', combat: 'боевых эпизодов',
  engineering: 'инженерных событий', environment: 'среды', logistics: 'МТО', maintenance: 'ремонта',
  personnel: 'личного состава', medical: 'медицинских процессов', settlements: 'населённых пунктов', interaction: 'взаимодействия',
};
const levelTitles: Record<AutonomyLevel, string> = { OFF: 'Отключено', LOW: 'Низкая', MEDIUM: 'Средняя', HIGH: 'Высокая', CUSTOM: 'Настраиваемая' };

function normalize(profile: AutonomyEditorProfile): AutonomyProfile {
  if ('schemaVersion' in profile) return profile;
  const level = profile.level;
  return createAutonomyProfile({
    profileId: 'legacy-editor-profile', level,
    ...(level === 'CUSTOM' ? { settings: METHODICAL_AUTONOMY_PROFILE_V1.levels.MEDIUM } : {}),
    intensity: { categories: Object.fromEntries(profile.categories.map(item => [item.category.toLowerCase(), item.intensity])) },
  });
}

export function AutonomyEditor({ profile, onPreview, onSave }: {
  profile: AutonomyEditorProfile;
  onPreview?(profile: AutonomyProfile): void;
  onSave?(profile: AutonomyProfile): void;
}) {
  const [current, setCurrent] = useState<AutonomyProfile>(() => normalize(profile));
  useEffect(() => setCurrent(normalize(profile)), [profile]);

  function update(next: AutonomyProfile) {
    setCurrent(next); onPreview?.(next);
  }
  function changeCategory(category: EventCategory, value: number) {
    update(updateAutonomyProfile(current, { intensity: { categories: { [category]: value } } }, 'DRAFT'));
  }

  return <section aria-label="Автономное наращивание">
    <h2>Автономное наращивание</h2>
    <p>Вероятностное распределение: Пуассон · методический профиль {current.methodicalProfile.profileId}, версия {current.methodicalProfile.version}.</p>
    <label>Общая интенсивность<select value={current.level} onChange={event => update(updateAutonomyProfile(current, { level: event.target.value as AutonomyLevel }, 'DRAFT'))}>
      {Object.entries(levelTitles).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
    </select></label>
    {current.level === 'CUSTOM' && <label>Базовые попытки на оперативный час<input type="number" min="0" step="0.25" value={current.settings.attemptsPerOperationalHour}
      onChange={event => update(updateAutonomyProfile(current, { settings: { attemptsPerOperationalHour: Number(event.target.value) } }, 'DRAFT'))} /></label>}
    <div className="autonomy-category-grid">{EVENT_CATEGORIES.map(category => {
      const value = current.intensity.categories[category] ?? 1;
      const attempts = attemptsPerOperationalHour(current, { category, stageId: 'preparation', sideId: 'blue', areaId: 'area-1' });
      return <div key={category}>
        <label>Интенсивность {titles[category]}<input aria-label={`Интенсивность ${titles[category]}`} type="range" min="0" max="4" step="0.25" value={value}
          onChange={event => changeCategory(category, Number(event.target.value))} /></label>
        <span>×{value} · ожидаемых попыток: {Number(attempts.toFixed(3))}/оперативный час</span>
        {value === 0 && <>
          <p>Вероятностные события {titles[category]} отключены; плановые и реактивные сохранены</p>
          <small>Плановые и реактивные события сохраняются при нулевом множителе.</small>
        </>}
      </div>;
    })}</div>
    {onSave && <button type="button" onClick={() => onSave(current)}>Сохранить профиль событий</button>}
  </section>;
}
