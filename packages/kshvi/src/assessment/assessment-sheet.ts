export type AssessmentInput = {
  scope: 'INDIVIDUAL' | 'COLLECTIVE';
  subjectId: string;
  criteria: readonly string[];
  scale: readonly string[];
  observations: readonly { eventId: string; text: string }[];
  positiveFacts: readonly string[];
  negativeFacts: readonly string[];
  comment: string;
  assessor: { id: string; role: string };
  systemProposal?: string;
};
export type AssessmentSheet = AssessmentInput & {
  status: 'DRAFT' | 'APPROVED';
  finalAssessment: string | null;
  finalComment: string | null;
  confirmation: { id: string; role: string; confirmedAt: string } | null;
};
export type AssessmentApproval = {
  finalAssessment: string;
  comment: string;
  confirmedBy: { id: string; role: string };
  confirmedAt: string;
};

export function draftAssessment(input: AssessmentInput): AssessmentSheet {
  if (!input.criteria.length || !input.scale.length || !input.observations.length) throw new Error('Листу оценки нужны критерии, шкала и наблюдения');
  if (!input.assessor.id.trim() || input.assessor.role === 'SYSTEM') throw new Error('Оценивающим должен быть человек');
  return {
    ...structuredClone(input), status: 'DRAFT', finalAssessment: null, finalComment: null, confirmation: null,
  };
}

export function approveAssessment(sheet: AssessmentSheet, approval: AssessmentApproval): AssessmentSheet {
  if (!approval.finalAssessment.trim() || !approval.comment.trim()) throw new Error('Итоговая оценка и комментарий человека обязательны');
  if (approval.confirmedBy.role !== 'LEADER' || !approval.confirmedBy.id.trim() || approval.confirmedBy.id === 'system') {
    throw new Error('Итоговую оценку формулирует и подтверждает человек — руководитель учения');
  }
  return {
    ...structuredClone(sheet), status: 'APPROVED', finalAssessment: approval.finalAssessment, finalComment: approval.comment,
    confirmation: { ...approval.confirmedBy, confirmedAt: approval.confirmedAt },
  };
}
