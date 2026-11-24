export function DebriefWorkspace({ scope, revision, audience, referenceIntent }: {
  scope: 'GENERAL' | 'PRIVATE';
  revision: number;
  audience: readonly string[];
  referenceIntent: string;
}) {
  return <section>
    <h2>{scope === 'GENERAL' ? 'Общий разбор' : 'Частный разбор'}</h2>
    <p>Редакция {revision}; аудитория: {audience.join(', ')}</p>
    <article><h3>Замысел руководства</h3><p>{referenceIntent}</p>
      <strong>Эталон — замысел руководства, не единственно правильное решение. Обоснованные отклонения разбираются по последствиям.</strong>
    </article>
  </section>;
}
