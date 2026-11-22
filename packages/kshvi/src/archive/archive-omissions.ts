import type { ArchiveManifest } from './archive-manifest';

export const LICENSE_LIMITED_COMPONENTS = ['environment.tiles'] as const;

export type ArchiveOmissionEvaluation = {
  errors: readonly string[];
  limitations: readonly string[];
  notices: readonly string[];
  licensedMissing: ReadonlySet<string>;
};

export function evaluateArchiveOmissions(manifest: ArchiveManifest): ArchiveOmissionEvaluation {
  const errors: string[] = [];
  const limitations: string[] = [];
  const notices: string[] = [];
  const licensedMissing = new Set<string>();
  const present = new Set(manifest.components.map(component => component.id));
  for (const omission of manifest.omissions) {
    const reason = omission.reason.trim() || 'Ограничение без пояснения';
    notices.push(`${omission.componentId}: ${reason}`);
    if (!omission.reason.trim()) errors.push(`Omission ${omission.componentId} без пояснения`);
    if (present.has(omission.componentId) && !omission.informational) {
      errors.push(`Omission ${omission.componentId} противоречит наличию компонента`);
    }
    if (omission.licenseLimitation) {
      if (!LICENSE_LIMITED_COMPONENTS.includes(omission.componentId as 'environment.tiles')) {
        errors.push(`Недопустимый тип лицензионного omission: ${omission.componentId}`);
      }
      if (omission.informational) errors.push(`Несовместимые licenseLimitation+informational: ${omission.componentId}`);
      limitations.push(`${omission.componentId}: ${reason}`);
      if (LICENSE_LIMITED_COMPONENTS.includes(omission.componentId as 'environment.tiles') && !omission.informational && !present.has(omission.componentId)) {
        licensedMissing.add(omission.componentId);
      }
    } else if (!omission.informational) limitations.push(`${omission.componentId}: ${reason}`);
  }
  return { errors, limitations, notices, licensedMissing };
}
