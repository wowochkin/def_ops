export type SessionMode = 'DEMONSTRATION' | 'TRAINING' | 'OFFICIAL';
export type SharedCatalogVersion = Readonly<{
  catalogId: string;
  version: number;
  sha256: string;
  allowedOrganizationIds: readonly string[];
}>;
export type OrganizationPolicy = Readonly<{
  organizationId: string;
  disseminationLabel: string;
  sharedCatalogs: readonly SharedCatalogVersion[];
  certificationClaim: boolean;
}>;

export function assertOrganizationAccess(actorOrganizationId: string, resource: {
  organizationId: string;
  kind: 'object' | 'file' | 'job' | 'subscription';
}): void {
  if (actorOrganizationId !== resource.organizationId) throw new Error('Действие недоступно');
}

export function sessionModeLabel(mode: SessionMode): string {
  const labels = {
    DEMONSTRATION: 'Демонстрационный сеанс',
    TRAINING: 'Тренировочный сеанс',
    OFFICIAL: 'Официальный сеанс',
  } as const;
  return labels[mode];
}

export class OrganizationPolicyService {
  private readonly policies = new Map<string, OrganizationPolicy>();

  setPolicy(policy: OrganizationPolicy): void {
    if (policy.certificationClaim) throw new Error('Сертификация секретности реализацией не подтверждается');
    if (!policy.disseminationLabel.trim()) throw new Error('Укажите метку ограниченного распространения');
    this.policies.set(policy.organizationId, structuredClone(policy));
  }

  catalogFor(organizationId: string, catalogId: string, version: number): SharedCatalogVersion {
    const versions = [...this.policies.values()].flatMap(policy => policy.sharedCatalogs)
      .filter(catalog => catalog.catalogId === catalogId);
    const catalog = versions.find(candidate => candidate.version === version);
    if (!catalog) throw new Error('Требуется неизменяемая версионная ссылка на общий справочник');
    if (!catalog.allowedOrganizationIds.includes(organizationId)) throw new Error('Действие недоступно');
    return structuredClone(catalog);
  }

  certificationNotice(): string {
    return 'Сертификация для обработки секретных сведений не заявляется.';
  }
}
