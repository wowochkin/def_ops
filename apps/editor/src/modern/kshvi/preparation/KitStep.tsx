import { validateKit, type ScenarioKit } from '@def-ops/kshvi';

export function KitStep({ items, omissions, usesLogistics }: Pick<ScenarioKit, 'items' | 'omissions' | 'usesLogistics'>) {
  const issues = validateKit({ items, omissions, usesLogistics });
  return <section>
    <h2>Сценарный комплект</h2>
    <p>19 обязательных частей сценария</p>
    {issues.some(issue => issue.code === 'LOGISTICS_PLAN_REQUIRED') && <p role="alert">План МТО обязателен при использовании логистики</p>}
    <ul>{issues.filter(issue => issue.code !== 'LOGISTICS_PLAN_REQUIRED').map(issue => <li key={`${issue.code}-${issue.item}`}>{issue.message}</li>)}</ul>
  </section>;
}
