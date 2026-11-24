import type { recordPaperExchange } from '../../../../../../packages/kshvi/src/communications/browser';

export function PaperExchangePanel(props: { exchange: ReturnType<typeof recordPaperExchange> }) {
  const { exchange } = props;
  return <section aria-label="Бумажный резерв">
    <h2>Бумажный обмен</h2>
    <p>Документ: {exchange.source.documentId}; редакция {exchange.source.revision}</p>
    <p>Основание: {exchange.evidence.reference}</p>
    <p>Оператор ввода: {exchange.enteredBy}</p>
    <ul>{exchange.facts.map(fact => <li key={fact.type}>
      <p>{fact.type === 'RECEIVED' ? `Фактически получено: ${fact.actualAt}` : `${fact.type === 'ISSUED' ? 'Фактически выдано' : 'Исполнение начато'}: ${fact.actualAt}`}</p>
      <p>Введено в журнал: {fact.recordedAt}</p>
      <p>Ответственный: {fact.actorId}</p>
    </li>)}</ul>
    {exchange.duplicate && !exchange.domainEffectApplied && <p>Доменный эффект уже применён; повторный приказ не создан</p>}
    <p>Разрешение электронной очереди: {exchange.electronicResolution}</p>
    {exchange.cancelledMessageIds.length > 0 && <p>Отменены транспортные дубликаты: {exchange.cancelledMessageIds.join(', ')}</p>}
  </section>;
}
