import { useId, useState, type FormEvent } from 'react';
import { exerciseStates, libraryPrimaryAction, stateLabel, type LibraryPrimaryAction } from './library-actions';
import { DateTimeField } from '../DateTimeField';
import { emptyPreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { defaultScenarioSides, type ScenarioSide } from '../../../../../packages/kshvi/src/scenario/sides';
import { ExerciseSidesEditor } from './ExerciseSidesEditor';
import type {
  CreateExerciseInput,
  ExerciseFilters,
  ExercisePurpose,
  ExerciseScale,
  ExerciseState,
  ExerciseSummary,
} from './kshvi-api';

export type LibraryExercise = Pick<ExerciseSummary, 'id' | 'title' | 'revision' | 'state' | 'validation'>
  & Partial<Omit<ExerciseSummary, 'id' | 'title' | 'revision' | 'state' | 'validation'>>;

const scaleLabels: Record<ExerciseScale, string> = {
  tactical: 'Тактический', operational: 'Оперативный', strategic: 'Стратегический', custom: 'Особый масштаб',
};
const purposeLabels: Record<ExercisePurpose, string> = {
  planned: 'Плановое', special: 'Специальное', inspection: 'Проверка', research: 'Исследовательское',
  exposition: 'Экспозиционное', custom: 'Другое назначение',
};
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

type Props = {
  items: readonly LibraryExercise[];
  filters?: ExerciseFilters;
  busy?: boolean;
  loading?: boolean;
  notice?: string;
  error?: string;
  archiveMode?: boolean;
  onFiltersChange?: (filters: ExerciseFilters) => void;
  onCreate?: (input: CreateExerciseInput) => Promise<void>;
  onCopy?: (item: LibraryExercise) => void;
  onCompare?: (item: LibraryExercise) => void;
  onHideArchive?: (item: LibraryExercise, title: string, reason: string) => void;
  onArchive?: (item: LibraryExercise) => void;
  onOpenSession?: (item: LibraryExercise) => void;
  onPrimaryAction?: (item: LibraryExercise, action: LibraryPrimaryAction) => void;
};

export function LibraryView({
  items, filters = {}, busy = false, loading = false, notice = '', error = '', archiveMode = false,
  onFiltersChange, onCreate, onCopy, onCompare, onArchive, onHideArchive, onOpenSession, onPrimaryAction,
}: Props) {
  const uid = useId().replaceAll(':', '');
  const [query, setQuery] = useState(filters.query ?? '');
  const [state, setState] = useState(filters.state ?? '');
  const [scale, setScale] = useState(filters.scale ?? '');
  const [purpose, setPurpose] = useState(filters.purpose ?? '');
  const [hide, setHide] = useState<{ id: string; revision: number; title: string; reason: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [title, setTitle] = useState('');
  const [newPurpose, setNewPurpose] = useState<ExercisePurpose>('planned');
  const [newScale, setNewScale] = useState<ExerciseScale>('operational');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [sides, setSides] = useState<readonly ScenarioSide[]>(defaultScenarioSides);

  function submitFilters(event: FormEvent): void {
    event.preventDefault();
    onFiltersChange?.({
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(state ? { state: state as ExerciseState } : {}),
      ...(scale ? { scale: scale as ExerciseScale } : {}),
      ...(purpose ? { purpose: purpose as ExercisePurpose } : {}),
    });
  }

  async function submitCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!onCreate || saving) return;
    setSaving(true);
    setCreateError('');
    try {
      await onCreate({
        title,
        purpose: newPurpose,
        scale: newScale,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        payload: JSON.parse(JSON.stringify({ preparation: {
          ...emptyPreparationDraft(startsAt ? new Date(startsAt).toISOString() : new Date().toISOString()),
          sides: sides.map(side => ({ ...side })),
        } })) as CreateExerciseInput['payload'],
      });
      setCreating(false);
      setTitle('');
      setStartsAt('');
      setEndsAt('');
      setSides(defaultScenarioSides());
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Не удалось создать учение');
    } finally {
      setSaving(false);
    }
  }

  return <div className="kshvi-library">
    <div className="kshvi-library-heading">
      <div>
        <h2>{archiveMode ? 'Архив учений' : 'Библиотека учений'}</h2>
        <p>{archiveMode ? 'Зафиксированные проекты доступны для просмотра и повторного использования.' : 'Сценарии, редакции, проверки и последние подтверждённые сеансы.'}</p>
      </div>
      {onCreate && <button className="kshvi-primary" type="button" onClick={() => { setCreating(value => !value); setCreateError(''); }}>
        {creating ? 'Отменить создание' : 'Создать учение'}
      </button>}
    </div>

    {creating && onCreate && <form className="kshvi-create" onSubmit={submitCreate}>
      <div className="kshvi-create-grid">
        <label htmlFor={`${uid}-new-title`}>Название учения
          <input id={`${uid}-new-title`} value={title} onChange={event => setTitle(event.target.value)} required maxLength={180} autoFocus />
        </label>
        <label htmlFor={`${uid}-new-purpose`}>Назначение учения
          <select id={`${uid}-new-purpose`} value={newPurpose} onChange={event => setNewPurpose(event.target.value as ExercisePurpose)}>
            {Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label htmlFor={`${uid}-new-scale`}>Масштаб учения
          <select id={`${uid}-new-scale`} value={newScale} onChange={event => setNewScale(event.target.value as ExerciseScale)}>
            {Object.entries(scaleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <DateTimeField id={`${uid}-new-start`} label="Начало" value={startsAt} onChange={setStartsAt} />
        <DateTimeField id={`${uid}-new-end`} label="Окончание" value={endsAt} onChange={setEndsAt} />
      </div>
      <ExerciseSidesEditor value={sides} onChange={setSides} />
      <p className="kshvi-form-note">Новый проект получит первую редакцию. Датами можно дополнить карточку позже; неизвестные сроки не подставляются автоматически.</p>
      <button className="kshvi-primary" type="submit" disabled={saving || busy}>{saving ? 'Ждём подтверждение сервера…' : 'Сохранить на сервере'}</button>
      {createError && <p role="alert" className="kshvi-error">{createError}</p>}
    </form>}

    <form className="kshvi-filters" onSubmit={submitFilters}>
      <label htmlFor={`${uid}-query`}>Поиск
        <input id={`${uid}-query`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название или ответственный" />
      </label>
      {!archiveMode && <label htmlFor={`${uid}-state`}>Состояние
        <select id={`${uid}-state`} value={state} onChange={event => setState(event.target.value as ExerciseState | '')}>
          <option value="">Все состояния</option>
          {exerciseStates.filter(value => value !== 'ARCHIVED').map(value => <option key={value} value={value}>{stateLabel(value)}</option>)}
        </select>
      </label>}
      <label htmlFor={`${uid}-scale`}>Масштаб
        <select id={`${uid}-scale`} value={scale} onChange={event => setScale(event.target.value as ExerciseScale | '')}>
          <option value="">Любой масштаб</option>
          {Object.entries(scaleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label htmlFor={`${uid}-purpose`}>Назначение
        <select id={`${uid}-purpose`} value={purpose} onChange={event => setPurpose(event.target.value as ExercisePurpose | '')}>
          <option value="">Любое назначение</option>
          {Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy}>Найти</button>
    </form>

    {notice && <p role="status" className="kshvi-notice">{notice}</p>}
    {error && <p role="alert" className="kshvi-error">{error}</p>}
    <p className="kshvi-count" aria-live="polite">{loading ? 'Загружаем подтверждённые данные…' : `Проектов: ${items.length}`}</p>

    {!loading && items.length === 0 && <div className="kshvi-empty">
      <h3>{archiveMode ? 'Архив пуст' : 'Учения не найдены'}</h3>
      <p>{archiveMode ? 'Архивированные проекты появятся здесь без удаления редакций.' : 'Измените условия поиска или создайте новый проект на сервере.'}</p>
    </div>}

    <ul className="kshvi-exercise-list">
      {items.map(item => {
        const primary = libraryPrimaryAction(item);
        const copyLabel = item.state === 'ARCHIVED' ? 'Создать рабочую копию' : 'Копировать';
        return <li key={item.id}>
        <article className="kshvi-exercise-card">
          <div className="kshvi-card-heading">
            <div>
              <p className="kshvi-card-kicker">{item.scale ? scaleLabels[item.scale] : 'Масштаб не указан'} · {item.purpose ? purposeLabels[item.purpose] : 'Назначение не указано'}</p>
              <h3>{item.title}</h3>
            </div>
            <span className={`kshvi-state kshvi-state-${item.state.toLocaleLowerCase()}`}>{stateLabel(item.state)}</span>
          </div>
          <div className="kshvi-card-meta">
            <span>Редакция {item.revision}</span>
            <span className={`kshvi-validation kshvi-validation-${item.validation.toLocaleLowerCase()}`}>{stateLabel(item.validation)}</span>
            <span>{item.readiness === undefined || item.validation === 'NOT_RUN' ? 'Готовность не оценена' : `Готовность ${item.readiness}%`}</span>
          </div>
          <dl className="kshvi-card-details">
            <div><dt>Сроки</dt><dd>{item.startsAt || item.endsAt
              ? `${item.startsAt ? dateFormat.format(new Date(item.startsAt)) : 'Начало не задано'} — ${item.endsAt ? dateFormat.format(new Date(item.endsAt)) : 'окончание не задано'}`
              : 'Даты не заданы'}</dd></div>
          </dl>
          <p className="kshvi-owner-readable">{item.ownerId ? `Ответственный: ${item.ownerId}` : 'Ответственный не назначен'}</p>
          <div className="kshvi-card-actions">
            {onPrimaryAction && <button className="kshvi-primary" type="button" disabled={busy} aria-label={`${primary.label} ${item.title}`} onClick={() => onPrimaryAction(item, primary)}>{primary.label}</button>}
            {onCompare && <button type="button" disabled={busy} aria-label={`Сравнить редакции ${item.title}`} onClick={() => onCompare(item)}>Редакции</button>}
            {onOpenSession && item.lastSessionId && primary.id !== 'CONDUCT' && primary.id !== 'DEBRIEF' && <button type="button" disabled={busy} aria-label={`Перейти к последнему сеансу ${item.title}`} onClick={() => onOpenSession(item)}>Последний сеанс</button>}
            {onCopy && <button type="button" disabled={busy} aria-label={`${copyLabel} ${item.title}`} onClick={() => onCopy(item)}>{copyLabel}</button>}
            {onArchive && item.state !== 'ARCHIVED' && <button className="kshvi-danger" type="button" disabled={busy} aria-label={`Архивировать ${item.title}`} onClick={() => onArchive(item)}>Архивировать</button>}
            {archiveMode && onHideArchive && <button type="button" disabled={busy} onClick={() => setHide({ id: item.id, revision: item.revision, title: '', reason: '' })}>Удалить из архива</button>}
          </div>
          {onHideArchive && hide?.id === item.id && hide.revision === item.revision && <form aria-label="Удаление из архива" onSubmit={event => {
            event.preventDefault();
            if (!busy && hide.title === item.title && hide.reason.trim()) onHideArchive(item, hide.title, hide.reason.trim());
          }}>
            <p>Карточка исчезнет из списка. Сохранённые редакции останутся доступны по ссылке.</p>
            <label>Повторите название<input required value={hide.title} onChange={event => setHide({ ...hide, title: event.target.value })} /></label>
            <label>Основание удаления<textarea required value={hide.reason} onChange={event => setHide({ ...hide, reason: event.target.value })} /></label>
            <button type="submit" disabled={busy || hide.title !== item.title || !hide.reason.trim()}>Подтвердить удаление</button>
            <button type="button" disabled={busy} onClick={() => setHide(null)}>Отмена</button>
          </form>}
        </article>
      </li>; })}
    </ul>
  </div>;
}
