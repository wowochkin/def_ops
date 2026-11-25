import { useEffect, useState } from 'react';
import type { AutonomyProfile } from '@def-ops/kshvi-events';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { AutonomyCatalogResponse, AutonomyRehearsalResponse, ExerciseCard, KshviClient } from '../kshvi-api';
import { AutonomyEditor } from './AutonomyEditor';
import { CatalogBrowser } from './CatalogBrowser';
import { RehearsalReport } from './RehearsalReport';

export function EventsWorkspace({ card, draft, client, onCard }: {
  card: ExerciseCard;
  draft: PreparationDraft;
  client: KshviClient;
  onCard(card: ExerciseCard): void;
}) {
  const [catalog, setCatalog] = useState<AutonomyCatalogResponse | null>(null);
  const [profile, setProfile] = useState<AutonomyProfile>(draft.autonomy ?? catalog?.profile ?? null!);
  const [report, setReport] = useState<AutonomyRehearsalResponse | null>(null);
  const [seeds, setSeeds] = useState('seed-1');
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    client.getAutonomyCatalog(card.id).then(result => {
      if (!active) return;
      setCatalog(result);
      if (!draft.autonomy) setProfile(result.profile);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Каталог событий недоступен'); });
    return () => { active = false; };
  }, [client, card.id, card.revision]);
  useEffect(() => { if (draft.autonomy) setProfile(draft.autonomy); }, [draft.autonomy]);

  async function save(next: AutonomyProfile) {
    setBusy(true); setError('');
    try { onCard(await client.saveAutonomyProfile(card.id, { expectedRevision: card.revision, profile: next })); setReport(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Профиль не сохранён'); }
    finally { setBusy(false); }
  }
  async function rehearse() {
    setBusy(true); setError('');
    try {
      const values = seeds.split(',').map(item => item.trim()).filter(Boolean);
      setReport(await client.rehearseAutonomy(card.id, { seeds: values, fromSecond: 0, toSecond: Math.round(hours * 3600) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Репетиция не выполнена'); }
    finally { setBusy(false); }
  }

  return <section aria-label="События и репетиция">
    {error && <p role="alert">{error}</p>}
    {profile ? <AutonomyEditor profile={profile} onPreview={setProfile} onSave={next => void save(next)} /> : <p>Загружается методический профиль…</p>}
    {catalog ? <CatalogBrowser items={catalog.items} /> : !error && <p>Загружается каталог событий…</p>}
    <section aria-label="Параметры репетиции событий"><h2>Репетиция событий</h2>
      <label>Зёрна через запятую<input value={seeds} onChange={event => setSeeds(event.target.value)} /></label>
      <label>Горизонт, оперативных часов<input type="number" min="1" max="72" value={hours} onChange={event => setHours(Number(event.target.value))} /></label>
      <button type="button" disabled={busy || !catalog} onClick={() => void rehearse()}>Выполнить репетицию</button>
    </section>
    {report && <RehearsalReport report={report} />}
  </section>;
}
