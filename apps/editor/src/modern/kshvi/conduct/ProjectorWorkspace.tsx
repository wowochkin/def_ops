import { useState } from 'react';
import type { Audience, ConductClient, ConductProjection } from './shared/types';

const audiences = [
  ['GENERAL_SERVICE', 'общий служебный'], ['SIDE', 'сторонний'], ['TRAINEE', 'обучаемый'], ['PUBLIC_FINAL', 'публичный итоговый'],
] as const;

export function ProjectorWorkspace({ commands }: { commands: Pick<ConductClient, 'checkAudience' | 'loadAudienceProjection'> }) {
  const [audience, setAudience] = useState<Audience | ''>('');
  const [projection, setProjection] = useState<ConductProjection | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = audiences.find(([id]) => id === audience)?.[1];
  return <main className="kshvi-conduct-workspace kshvi-projector">
    <header className="kshvi-conduct-header"><div><p className="kshvi-kicker">КШВИ · изолированная аудиторная проекция</p><h1>Проектор</h1></div></header>
    <section className="kshvi-conduct-panel">
      <label>Профиль аудитории<select value={audience} onChange={event => { setAudience(event.target.value as Audience | ''); setProjection(null); setReason(''); setError(''); }}><option value="">Не выбрана</option>{audiences.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
      {!audience && <p>Аудитория не выбрана</p>}
      {reason && <p>Проверка видимости: {reason}</p>}
      <p>Профиль предыдущего пользователя не восстанавливается; каждая проекция запрашивается отдельно.</p>
      <button type="button" disabled={!audience || busy} onClick={() => {
        if (!audience) return;
        setBusy(true); setError('');
        void commands.checkAudience(audience).then(async check => {
          setReason(check.reason);
          if (!check.allowed) throw new Error('Аудиторная проекция запрещена серверной политикой');
          setProjection(await commands.loadAudienceProjection(audience));
        }).catch(cause => { setError(cause instanceof Error ? cause.message : 'Не удалось получить аудиторную проекцию'); }).finally(() => setBusy(false));
      }}>Вывести на проектор</button>
      {error && <p role="alert">{error}</p>}
    </section>
    {projection && <section key={audience} className="kshvi-projector-output" aria-label={`Проекция: ${label}`}>
      <h2>{projection.projectorTitle ?? `Аудиторная проекция: ${label}`}</h2><p>{projection.live.state}</p>
      <div className="kshvi-map-marker">{projection.live.geometry} · {projection.officialOperationalAt}</div>
      <span>Соединение: {projection.connection} · Синхронизировано: {projection.lastServerSyncAt}</span>
    </section>}
  </main>;
}
