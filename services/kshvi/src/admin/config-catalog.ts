import { createHash } from 'node:crypto';
import { canonicalJson } from '@def-ops/kshvi';

export type ConfigKind = 'DOCUMENTS' | 'SCALE' | 'COMMUNICATIONS' | 'WEATHER' | 'MODEL' | 'ASSESSMENT';
export type ConfigVersion = Readonly<{
  profileId: string;
  kind: ConfigKind;
  version: number;
  sha256: string;
  content: unknown;
  source?: string;
  assumption?: string;
  testReport: { status: 'PASSED' | 'FAILED' };
  status: 'IMPORTED' | 'APPROVED';
  approvedBy?: string;
  createdAt: string;
}>;

export class ConfigCatalog {
  private readonly versions = new Map<string, ConfigVersion[]>();

  importProfile(input: {
    profileId: string;
    kind: ConfigKind;
    content: unknown;
    source?: string;
    assumption?: string;
    testReport: { status: 'PASSED' | 'FAILED' };
  }): ConfigVersion {
    if (!input.source?.trim() && !input.assumption?.trim()) throw new Error('Требуется источник или учебное допущение');
    if (input.testReport.status !== 'PASSED') throw new Error('Профиль должен пройти тесты');
    const history = this.versions.get(input.profileId) ?? [];
    const version = history.length + 1;
    const sha256 = createHash('sha256').update(canonicalJson({
      profileId: input.profileId, kind: input.kind, version, content: input.content,
      source: input.source ?? null, assumption: input.assumption ?? null,
    })).digest('hex');
    const record: ConfigVersion = Object.freeze({
      profileId: input.profileId, kind: input.kind, version, sha256, content: structuredClone(input.content),
      ...(input.source ? { source: input.source } : {}), ...(input.assumption ? { assumption: input.assumption } : {}),
      testReport: { status: 'PASSED' }, status: 'IMPORTED', createdAt: new Date().toISOString(),
    });
    this.versions.set(input.profileId, [...history, record]);
    return structuredClone(record);
  }

  approve(actor: { userId: string; domainPermissions: readonly string[] }, profileId: string, version: number): ConfigVersion {
    if (!actor.domainPermissions.includes('config.approve')) throw new Error('Недостаточно предметных прав для утверждения профиля');
    const current = this.get(profileId, version);
    const approved = { ...current, status: 'APPROVED' as const, approvedBy: actor.userId };
    this.replace(approved);
    return structuredClone(approved);
  }

  activate(profileId: string, version: number): ConfigVersion {
    const record = this.get(profileId, version);
    if (record.status !== 'APPROVED') throw new Error('Активировать можно только профиль APPROVED');
    return structuredClone(record);
  }

  resolve(reference: { profileId: string; version: number; sha256: string }): ConfigVersion {
    const record = this.get(reference.profileId, reference.version);
    if (record.sha256 !== reference.sha256) throw new Error('Хеш версионной ссылки не совпадает');
    return structuredClone(record);
  }

  list(profileId?: string): ConfigVersion[] {
    return (profileId ? this.versions.get(profileId) ?? [] : [...this.versions.values()].flat()).map(record => structuredClone(record));
  }

  private get(profileId: string, version: number): ConfigVersion {
    const record = this.versions.get(profileId)?.find(candidate => candidate.version === version);
    if (!record) throw new Error('Версия профиля не найдена');
    return record;
  }

  private replace(record: ConfigVersion): void {
    const history = this.versions.get(record.profileId) ?? [];
    this.versions.set(record.profileId, history.map(candidate => candidate.version === record.version ? record : candidate));
  }
}
