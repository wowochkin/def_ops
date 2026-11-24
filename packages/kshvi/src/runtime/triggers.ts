export type TriggerCondition = { left: unknown; operator: 'EQ' | 'NE' | 'LT' | 'LE' | 'GT' | 'GE'; right: unknown };

export function evaluateTrigger(condition: TriggerCondition): 'TRUE' | 'FALSE' | 'UNRESOLVED' {
  if (condition.left === null || condition.left === undefined || (typeof condition.left === 'object' && 'status' in condition.left && condition.left.status === 'UNKNOWN')) return 'UNRESOLVED';
  const left = condition.left as string | number | boolean;
  const right = condition.right as string | number | boolean;
  switch (condition.operator) {
    case 'EQ': return left === right ? 'TRUE' : 'FALSE';
    case 'NE': return left !== right ? 'TRUE' : 'FALSE';
    case 'LT': return left < right ? 'TRUE' : 'FALSE';
    case 'LE': return left <= right ? 'TRUE' : 'FALSE';
    case 'GT': return left > right ? 'TRUE' : 'FALSE';
    case 'GE': return left >= right ? 'TRUE' : 'FALSE';
  }
}

export function validateTriggerGraph(rules: readonly { id: string; emits: readonly string[] }[]) {
  const issues: { code: string; ruleId: string }[] = [];
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { issues.push({ code: 'TRIGGER_CYCLE', ruleId: id }); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of byId.get(id)?.emits ?? []) if (byId.has(next)) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const rule of rules) visit(rule.id);
  return issues;
}
