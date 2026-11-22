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
  /** Обязателен для любого серверного решения; значение получают из доверенного объекта/сессии. */
  organizationId?: string;
  /** Обязателен для объектной команды; null и пропуск не считаются совпадением. */
  sideId?: string;
  /** Для объектной команды обязано быть true; отсутствие объекта не раскрывается и даёт 403. */
  objectExists?: boolean;
  scope?: 'organization' | 'object';
};

export function authorize(actor: ParticipantContext, request: AuthorizationRequest): void {
  // Безопасное значение по умолчанию — объектная команда. Организационный контур нельзя получить пропуском полей.
  const objectScoped = request.scope !== 'organization';
  const organizationAllowed = typeof request.organizationId === 'string'
    && request.organizationId.length > 0
    && request.organizationId === actor.organizationId;
  const objectAllowed = !objectScoped || (
    request.objectExists === true
    && typeof request.sideId === 'string'
    && request.sideId.length > 0
    && request.sideId === actor.sideId
  );
  const allowed = actor.activeRole !== null
    && actor.authorities.includes(request.action)
    && organizationAllowed
    && objectAllowed;
  if (!allowed) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
}
