const STATUS_LABELS = {
  queued: 'В очереди', running: 'Выполняется', succeeded: 'Завершено', failed: 'Ошибка', cancelled: 'Отменено',
} as const;

export function JobQueuePanel({ jobs, onCancel, onRetry }: {
  jobs: readonly { id: string; kind: string; status: keyof typeof STATUS_LABELS; progress: number; attempts: number }[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  return <section><h2>Фоновые задания</h2>{jobs.map(job => <article key={job.id}>
    <strong>{job.kind}: {job.id}</strong><p>{STATUS_LABELS[job.status]}; попытка {job.attempts}</p>
    <progress max={100} value={job.progress} aria-label={`Прогресс ${job.id}`} /><span>{job.progress}%</span>
    {(job.status === 'queued' || job.status === 'running') && <button onClick={() => onCancel(job.id)}>Отменить {job.id}</button>}
    {(job.status === 'failed' || job.status === 'cancelled') && <button onClick={() => onRetry(job.id)}>Повторить {job.id}</button>}
  </article>)}</section>;
}
