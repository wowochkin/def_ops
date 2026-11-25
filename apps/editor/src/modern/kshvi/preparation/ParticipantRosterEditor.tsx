import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ParticipantReference, ScenarioParticipant } from '../../../../../../services/kshvi/src/store/scenario-participants';
import type { ExerciseCard, KshviClient, ParticipantRoster } from '../kshvi-api';
import { roleNames } from '../LoginPanel';

const key = (item: ParticipantReference) => JSON.stringify([item.userId, item.roleAssignmentId, item.instanceId]);
const signature = (values: readonly string[]) => JSON.stringify([...values].sort());

export function ParticipantRosterEditor({ exerciseId, revision, client, disabled, onRevision, onError, onPendingChange, acceptsCardResponse }: {
  exerciseId: string; revision: number; client: KshviClient; disabled: boolean;
  onRevision(card: ExerciseCard): void; onError(cause: unknown): void;
  onPendingChange?(dirty: boolean, busy: boolean): void; acceptsCardResponse?(): boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ParticipantRoster | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const active = useRef(true);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; epoch.current++; }; }, []);
  const dirty = open && !!data && signature(selected) !== signature(data.items.map(key));
  useLayoutEffect(() => onPendingChange?.(dirty, busy), [onPendingChange, dirty, busy]);
  useLayoutEffect(() => () => onPendingChange?.(false, false), [onPendingChange]);
  const canApply = (request: number) => active.current && epoch.current === request && acceptsCardResponse?.() !== false;

  async function load() {
    if (disabled || busy) return;
    setOpen(true); setData(null); setError(''); setBusy(true);
    const request = ++epoch.current;
    try {
      const value = await client.getParticipantRoster(exerciseId);
      if (!canApply(request)) return;
      if (value.revision !== revision) throw new Error('Редакция изменилась. Откройте свежую карточку перед выбором участников.');
      setData(value); setSelected(value.items.map(key));
    } catch (cause) {
      if (canApply(request)) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать состав'); onError(cause); }
    } finally { if (active.current && epoch.current === request) setBusy(false); }
  }
  useEffect(() => {
    if (!open || dirty || busy) return;
    if (data && data.revision !== revision) { setOpen(false); setData(null); }
  }, [revision, open, dirty, busy, data]);
  const available = new Map(data?.candidates.map(item => [key(item), item]));
  const options = new Map<string, ScenarioParticipant>();
  for (const item of [...data?.items ?? [], ...data?.candidates ?? []]) options.set(key(item), item);
  const missing = selected.some(id => !available.has(id));

  return <section className="initial-editor-roster" aria-label="Состав участников редакции">
    <button type="button" disabled={disabled || busy} onClick={() => void load()}>Состав участников редакции</button>
    {open && <>
      <p>Выберите действующие назначения. Сохранение создаёт новую редакцию сценария и не изменяет права учётных записей.</p>
      {busy && <p role="status">Загружаем или сохраняем состав…</p>}
      {!busy && data && !options.size && <p>Назначенных инстанций нет. Сначала задайте инстанции в серверных назначениях ролей.</p>}
      {data && <fieldset disabled={disabled || busy}><legend>Назначения участников</legend>{[...options].map(([id, item]) => <label key={id}>
        <input type="checkbox" checked={selected.includes(id)} onChange={event => setSelected(values => event.target.checked ? [...values, id] : values.filter(value => value !== id))} />
        {item.label} · {roleNames[item.role] ?? 'Назначенная роль'} · {item.sideId}
        {!available.has(id) && <span> · назначение больше недоступно для новой редакции</span>}
      </label>)}</fieldset>}
      {missing && <p role="alert">Снимите недоступные назначения или восстановите их на сервере.</p>}
      <button type="button" disabled={disabled || busy || !dirty || missing} onClick={async () => {
        if (!data || !dirty || busy || disabled || missing) return;
        const request = ++epoch.current;
        setBusy(true); setError('');
        try {
          const participants = selected.map(id => {
            const item = available.get(id)!;
            return { userId: item.userId, roleAssignmentId: item.roleAssignmentId, instanceId: item.instanceId };
          });
          const card = await client.bindParticipants(exerciseId, { expectedRevision: revision, participants });
          if (!canApply(request)) return;
          onRevision(card); setOpen(false); setData(null);
        } catch (cause) {
          if (canApply(request)) { setError(cause instanceof Error ? cause.message : 'Состав не сохранён'); onError(cause); }
        } finally { if (active.current && epoch.current === request) setBusy(false); }
      }}>Сохранить состав новой редакцией</button>
      <button type="button" disabled={busy} onClick={() => {
        if (dirty && !window.confirm('Отменить несохранённый выбор участников?')) return;
        epoch.current++; setOpen(false); setData(null); setError('');
      }}>Закрыть состав</button>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
