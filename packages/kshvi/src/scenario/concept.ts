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
  referenceData: string;
  task: string;
};

export function buildOperationalAssignment(source: ConceptSource, input: OperationalAssignmentInput): OperationalAssignment {
  if (!input.allowedGeneralSituation.trim() || !input.task.trim()) throw new Error('Частное задание должно содержать разрешённую обстановку и задачу');
  return {
    nodeId: input.nodeId,
    generalSituation: input.allowedGeneralSituation,
    privateSituation: input.privateSituation,
    referenceData: source.referenceData,
    task: input.task,
  };
}
