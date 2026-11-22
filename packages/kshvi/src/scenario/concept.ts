export type ConceptSource = {
  generalSituation: string;
  fullIntent: string;
  referenceData: string;
};
export type OperationalAssignmentInput = {
  nodeId: string;
  privateSituation: string;
  task: string;
  allowedGeneralSituation: string;
};
export type OperationalAssignment = {
  nodeId: string;
  generalSituation: string;
  privateSituation: string;
  task: string;
};

export function buildOperationalAssignment(_source: ConceptSource, input: OperationalAssignmentInput): OperationalAssignment {
  if (!input.allowedGeneralSituation.trim() || !input.task.trim()) throw new Error('Частное задание должно содержать разрешённую обстановку и задачу');
  return {
    nodeId: input.nodeId,
    generalSituation: input.allowedGeneralSituation,
    privateSituation: input.privateSituation,
    task: input.task,
  };
}
