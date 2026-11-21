export type CapabilityInput = {
  initialAssessment: { value: number; source: string };
  equipment: { actual: number; authorized: number } | null;
  personnel: { actual: number; authorized: number } | null;
  supplies: { available: number; required: number } | null;
  fatigue: number;
  morale: number;
  readiness: number;
  supply: number;
  manualCorrection: { value: number; reason: string; author: string } | null;
};

export function capabilityFactors(input: CapabilityInput) {
  const unknown: string[] = [];
  const ratio = (value: { actual: number; authorized: number } | null, name: string) => {
    if (!value || value.authorized <= 0) { unknown.push(name); return null; }
    return value.actual / value.authorized;
  };
  const factors = {
    equipment: ratio(input.equipment, 'equipment'),
    personnel: ratio(input.personnel, 'personnel'),
    supplies: input.supplies ? input.supplies.available / input.supplies.required : null,
    fatigue: input.fatigue,
    morale: input.morale,
    readiness: input.readiness,
    supply: input.supply,
  };
  if (!input.supplies) unknown.push('supplies');
  return { status: unknown.length ? 'REQUIRES_REVIEW' as const : 'CALCULATED' as const, unknown, factors, initialAssessment: input.initialAssessment, manualCorrection: input.manualCorrection };
}
