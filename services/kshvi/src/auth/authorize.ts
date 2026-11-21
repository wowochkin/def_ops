import { HttpError } from '@def-ops/service-kit';

export type ParticipantContext = {
  userId: string;
  activeRole: string | null;
  sideId: string | null;
  organizationId: string;
  roleId?: string | null;
  authorities: readonly string[];
  sessionId?: string;
  csrfHash?: string;
};
export type AuthorizationRequest = {
  action: string;
  organizationId?: string;
  sideId?: string;
  objectExists?: boolean;
};

export function authorize(actor: ParticipantContext, request: AuthorizationRequest): void {
  const allowed = actor.activeRole !== null
    && actor.authorities.includes(request.action)
    && (!request.organizationId || request.organizationId === actor.organizationId)
    && (!request.sideId || request.sideId === actor.sideId);
  if (!allowed) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
}
