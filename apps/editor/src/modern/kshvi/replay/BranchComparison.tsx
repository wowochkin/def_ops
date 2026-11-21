import type { BranchDifference } from '../../../../../../packages/kshvi/src/replay/branch-diff';

export function BranchComparison({ differences, causalAttribution }: {
  differences: readonly Pick<BranchDifference, 'kind' | 'label'>[];
  causalAttribution: 'NOT_CAUSALLY_COMPARABLE' | 'REQUIRES_RESEARCH_DESIGN';
}) {
  const order: Record<string, number> = { MODEL_VERSION: 0, ENVIRONMENT_VERSION: 1, REDUCER_VERSION: 2 };
  const ordered = [...differences].sort((left, right) => (order[left.kind] ?? 10) - (order[right.kind] ?? 10));
  return <section aria-label="Сравнение ветвей">
    <h2>Сравнение альтернативных ветвей</h2>
    {causalAttribution === 'NOT_CAUSALLY_COMPARABLE'
      ? <p role="alert">Условия различаются: последствия нельзя приписать только решению обучаемого.</p>
      : <p>Для причинного вывода требуется отдельный исследовательский дизайн.</p>}
    <ol>{ordered.map((difference, index) => <li key={`${difference.kind}-${index}`}>{difference.label}</li>)}</ol>
  </section>;
}
