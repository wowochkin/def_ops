import type { BranchVersions } from './branch';
import type { ReplayVersionRef } from './types';

export type RerunParticipant = { participantId: string; userId: string; role: string };
export type RerunSession = {
  sessionId: string;
  scenarioRevision: ReplayVersionRef;
  participants: readonly RerunParticipant[];
  roles: Readonly<Record<string, string>>;
  versions: BranchVersions;
};
export type RerunComparison = {
  environment: readonly string[];
  model: readonly string[];
  composition: readonly string[];
  roles: readonly string[];
};
export type Rerun = RerunSession & { comparison: RerunComparison; ranking: null };
export type CreateRerunInput = {
  sessionId: string;
  participants: readonly RerunParticipant[];
  roles: Readonly<Record<string, string>>;
  environment?: ReplayVersionRef;
  model?: ReplayVersionRef;
};

function versionDifference(label: string, left: ReplayVersionRef, right: ReplayVersionRef): string[] {
  return left.revision === right.revision && left.sha256 === right.sha256 ? [] : [`${label}: ${left.revision} → ${right.revision}`];
}

function buildComparison(source: RerunSession, next: RerunSession): RerunComparison {
  const oldParticipants = new Map(source.participants.map(participant => [participant.participantId, participant.userId]));
  const newParticipants = new Map(next.participants.map(participant => [participant.participantId, participant.userId]));
  const composition = [
    ...[...oldParticipants.keys()].filter(id => !newParticipants.has(id)).map(id => `Участник удалён: ${id}`),
    ...[...newParticipants.keys()].filter(id => !oldParticipants.has(id)).map(id => `Участник добавлен: ${id}`),
  ];
  const roleKeys = [...new Set([...Object.keys(source.roles), ...Object.keys(next.roles)])].sort();
  const roles = roleKeys.filter(key => source.roles[key] !== next.roles[key]).map(key => `${key}: ${source.roles[key] ?? 'нет'} → ${next.roles[key] ?? 'нет'}`);
  return {
    environment: versionDifference('environment', source.versions.environment, next.versions.environment),
    model: versionDifference('model', source.versions.model, next.versions.model),
    composition,
    roles,
  };
}

export function createRerun(source: RerunSession, input: CreateRerunInput): Rerun {
  if (!input.sessionId.trim() || input.sessionId === source.sessionId) throw new Error('Повторному прохождению нужен новый идентификатор сеанса');
  if (!input.participants.length) throw new Error('Для повторного прохождения нужны новые назначения участников');
  const sourceAssignments = new Set(source.participants.map(participant => participant.participantId));
  if (input.participants.some(participant => sourceAssignments.has(participant.participantId))) throw new Error('Назначения участников повторного прохождения должны быть новыми');
  const next: RerunSession = {
    sessionId: input.sessionId,
    scenarioRevision: structuredClone(source.scenarioRevision),
    participants: structuredClone(input.participants),
    roles: structuredClone(input.roles),
    versions: {
      ...structuredClone(source.versions),
      environment: structuredClone(input.environment ?? source.versions.environment),
      model: structuredClone(input.model ?? source.versions.model),
    },
  };
  return { ...next, comparison: buildComparison(source, next), ranking: null };
}

export function compareReruns(source: RerunSession, rerun: RerunSession): RerunComparison {
  return buildComparison(source, rerun);
}

export function rankReruns(): never {
  throw new Error('единый рейтинг разных учений не создаётся');
}
