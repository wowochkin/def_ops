import type { AccountRecord } from '../auth/sessions';

/** Снимок назначения для отображения сценария. Не предоставляет полномочий входа. */
export type ScenarioParticipant = Readonly<{
  userId: string;
  roleAssignmentId: string;
  instanceId: string;
  sideId: string;
  role: string;
  label: string;
}>;
export type ParticipantReference = Pick<ScenarioParticipant, 'userId' | 'roleAssignmentId' | 'instanceId'>;
const identity = (value: ParticipantReference) => JSON.stringify([value.userId, value.roleAssignmentId, value.instanceId]);

export function checkedParticipantRoster(input: unknown): readonly ScenarioParticipant[] {
  const fields = ['userId', 'roleAssignmentId', 'instanceId', 'sideId', 'role', 'label'];
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Некорректный состав участников');
  const seen = new Set<string>();
  const sides = new Map<string, string>();
  return input.map(value => {
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !fields.includes(key))
      || fields.some(key => typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 4096)) throw new Error('Неполное назначение участника');
    const key = identity(value);
    if (seen.has(key) || (sides.has(value.instanceId) && sides.get(value.instanceId) !== value.sideId)) throw new Error('Противоречивое назначение участника');
    seen.add(key); sides.set(value.instanceId, value.sideId);
    return { userId: value.userId, roleAssignmentId: value.roleAssignmentId, instanceId: value.instanceId,
      sideId: value.sideId, role: value.role, label: value.label };
  });
}

export function participantCandidates(accounts: readonly AccountRecord[], organizationId: string): readonly ScenarioParticipant[] {
  const result: ScenarioParticipant[] = [];
  for (const account of accounts) {
    if (account.organizationId !== organizationId || account.state !== 'ACTIVE') continue;
    for (const assignment of account.roles) {
      if (!assignment.id.trim() || !assignment.role.trim() || !assignment.sideId?.trim()) continue;
      for (const instanceId of new Set(assignment.assignedInstanceIds ?? [])) {
        if (!instanceId.trim()) continue;
        result.push({ userId: account.userId, roleAssignmentId: assignment.id, instanceId,
          sideId: assignment.sideId, role: assignment.role, label: `${account.username} · ${instanceId}` });
      }
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, 'ru') || identity(a).localeCompare(identity(b)));
}

export function resolveParticipantRoster(accounts: readonly AccountRecord[], organizationId: string, selections: unknown): readonly ScenarioParticipant[] {
  if (!Array.isArray(selections) || selections.length > 1000) throw new Error('Укажите список назначений участников');
  const candidates = new Map(participantCandidates(accounts, organizationId).map(item => [identity(item), item]));
  const used = new Set<string>();
  const roster = selections.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['userId', 'roleAssignmentId', 'instanceId'].includes(key))
      || ['userId', 'roleAssignmentId', 'instanceId'].some(key => typeof value[key] !== 'string' || !value[key].trim())) {
      throw new Error('Передавайте только идентификаторы существующего назначения');
    }
    const id = identity(value), participant = candidates.get(id);
    if (!participant || used.has(id)) throw new Error('Назначение отсутствует, недоступно или выбрано повторно');
    used.add(id);
    return { ...participant };
  });
  const sides = new Map<string, string>();
  for (const item of roster) {
    if (sides.has(item.instanceId) && sides.get(item.instanceId) !== item.sideId) throw new Error('Одна инстанция не может относиться к разным сторонам');
    sides.set(item.instanceId, item.sideId);
  }
  return roster;
}
