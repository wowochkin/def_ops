import { validateKit, type ScenarioKit } from '@def-ops/kshvi/browser';

export function KitStep({ items, documents, omissions, usesLogistics }: Pick<ScenarioKit, 'items' | 'documents' | 'omissions' | 'usesLogistics'>) {
  const issues = validateKit({ items, documents, omissions, usesLogistics });
  return <section>
    <h2>Сценарный комплект</h2>
    <p>19 обязательных частей сценария</p>
    <ul>{items.filter(item => item.present && item.documentId).map(item => <li key={item.item}>{item.item}: {item.documentId}, редакция {item.revision}</li>)}</ul>
    {issues.some(issue => issue.code === 'LOGISTICS_PLAN_REQUIRED') && <p role="alert">План МТО обязателен при использовании логистики</p>}
    <ul>{issues.filter(issue => issue.code !== 'LOGISTICS_PLAN_REQUIRED').map(issue => <li key={`${issue.code}-${issue.item}`}>{issue.message}</li>)}</ul>
  </section>;
}
