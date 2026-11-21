import { randomUUID } from 'node:crypto';

export type Incident = Readonly<{
  id: string;
  startedAt: string;
  scope: string;
  technicalDescription: string;
  conductImpact: string;
  recoveredAt: string | null;
  actions: readonly string[];
  recoveryResult: string | null;
  interruptionMs: number | null;
  methodologicalDecision: 'PENDING' | 'ALLOWED' | 'STOPPED';
  methodologicalReason: string | null;
}>;

export class IncidentService {
  private readonly incidents = new Map<string, Incident>();

  open(input: { startedAt: string; scope: string; technicalDescription: string; conductImpact: string }): Incident {
    const incident: Incident = Object.freeze({
      id: randomUUID(), ...input, recoveredAt: null, actions: [], recoveryResult: null,
      interruptionMs: null, methodologicalDecision: 'PENDING', methodologicalReason: null,
    });
    this.incidents.set(incident.id, incident);
    return structuredClone(incident);
  }

  completeRecovery(id: string, input: { recoveredAt: string; actions: readonly string[]; result: string }): Incident {
    const incident = this.get(id);
    const interruptionMs = Date.parse(input.recoveredAt) - Date.parse(incident.startedAt);
    if (interruptionMs < 0) throw new Error('Время восстановления предшествует инциденту');
    const updated = { ...incident, recoveredAt: input.recoveredAt, actions: [...input.actions], recoveryResult: input.result, interruptionMs };
    this.incidents.set(id, updated);
    return structuredClone(updated);
  }

  decideContinuation(id: string, input: { actorRole: 'DIRECTOR' | 'ADMIN'; decision: 'ALLOWED' | 'STOPPED'; reason: string }): Incident {
    if (input.actorRole !== 'DIRECTOR') throw new Error('Методическое продолжение определяет руководитель');
    const incident = this.get(id);
    if (!incident.recoveredAt) throw new Error('Техническое восстановление ещё не зафиксировано');
    const updated = { ...incident, methodologicalDecision: input.decision, methodologicalReason: input.reason };
    this.incidents.set(id, updated);
    return structuredClone(updated);
  }

  private get(id: string): Incident {
    const incident = this.incidents.get(id);
    if (!incident) throw new Error('Инцидент не найден');
    return incident;
  }
}
