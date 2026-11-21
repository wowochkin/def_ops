import {
  validateDocumentReadiness,
  type DocumentFactType,
  type DocumentRevision,
} from '../../../../../../packages/kshvi/src/documents/browser';

const factLabels: Record<DocumentFactType, string> = {
  DELIVERED: 'Получение',
  ACKNOWLEDGED: 'Ознакомление',
  EXECUTION_STARTED: 'Начало исполнения',
};

export function DocumentEditor(props: {
  revision: DocumentRevision;
  onApprove?: () => void;
  onContentChange?: (body: string) => void;
}) {
  const { revision } = props;
  const issues = validateDocumentReadiness(revision);
  const signed = revision.state === 'APPROVED' || revision.state === 'ISSUED' || revision.state === 'SUPERSEDED';
  return <section aria-label="Редактор документа">
    <h2>{revision.requisites.title}</h2>
    <p>Редакция {revision.revision}</p>
    <p>Тип: {revision.requisites.type}; состояние: {revision.state}</p>
    <dl>
      <div><dt>Номер</dt><dd>{revision.requisites.number}</dd></div>
      <div><dt>Оперативное время</dt><dd>{revision.requisites.operationalAt}</dd></div>
      <div><dt>Место составления</dt><dd>{revision.requisites.place}</dd></div>
      <div><dt>Основание</dt><dd>{revision.requisites.basis || 'Не указано'}</dd></div>
      <div><dt>Исполнитель</dt><dd>{revision.requisites.executorId || 'Не указан'}</dd></div>
      <div><dt>Адресаты</dt><dd>{revision.requisites.addressees.map(item => item.instanceId).join(', ') || 'Не указаны'}</dd></div>
    </dl>
    {issues.length > 0 && <div role="alert">
      <strong>Документ не готов к утверждению</strong>
      <ul>{issues.map(issue => <li key={`${issue.code}:${issue.field}`}>{issue.message}</li>)}</ul>
    </div>}
    <label>
      Содержимое документа
      <textarea
        aria-label="Содержимое документа"
        value={revision.content.body}
        readOnly={revision.state !== 'DRAFT'}
        onChange={event => props.onContentChange?.(event.target.value)}
      />
    </label>
    <p>SHA-256 содержимого:</p>
    <code>{revision.sha256}</code>
    {revision.supersedesRevision !== null && <section aria-label="Происхождение редакции">
      <h3>Заменяет редакцию {revision.supersedesRevision}</h3>
      <p>Основание новой редакции: {revision.supersedeReason}</p>
      <code>{revision.supersedes}</code>
      {revision.previousRevision?.signatures.map(signature => <p key={`${signature.userId}:${signature.signedAt}`}>
        Прежняя подпись: {signature.userId} / {signature.role}
      </p>)}
    </section>}
    {revision.signatures.map(signature => <section aria-label="Подпись документа" key={`${signature.userId}:${signature.signedAt}`}>
      <p>Подпись: {signature.userId} / {signature.role}</p>
      <p>Момент подписания: {signature.signedAt}; редакция: {signature.revision}</p>
      {signature.external && <p>Внешняя криптоподпись: {signature.external.provider}</p>}
    </section>)}
    {signed && <p>Подписанное содержимое доступно только для чтения; исправление создаёт новую редакцию.</p>}
    <section aria-label="Факты выдачи и исполнения">
      <h3>Выдача и исполнение — отдельные факты</h3>
      {revision.delivery.facts.length === 0 ? <p>Факты получения ещё не зарегистрированы</p> : <ul>
        {revision.delivery.facts.map(fact => <li key={`${fact.type}:${fact.at}`}>{factLabels[fact.type]}: {fact.at}</li>)}
      </ul>}
    </section>
    <button type="button" disabled={issues.length > 0 || revision.state !== 'IN_REVIEW'} onClick={props.onApprove}>Утвердить</button>
  </section>;
}
