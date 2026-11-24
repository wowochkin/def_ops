export type VisibilityActor = {
  side: string;
  role: string;
  operationalAt: string;
  scope: 'own' | 'truth';
  nodeId?: string;
  authorities?: readonly string[];
  demonstration?: boolean;
};

export function canReadTruth(actor: VisibilityActor): boolean {
  return actor.scope === 'truth' && actor.role === 'LEADER' && !!actor.authorities?.includes('TRUTH_READ');
}

export function assertRoleCombination(actor: VisibilityActor): void {
  if (actor.role === 'TECH_ADMIN') throw new Error('403: Технический администратор не получает содержание учения');
  if (actor.role === 'TRAINEE_LEADER' && !actor.demonstration) throw new Error('403: Совмещение ролей допускается только с демонстрационной меткой');
}
