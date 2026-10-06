/**
 * События изменений реестра. Открытые карты подписываются на поток
 * Server-Sent Events и обновляют характеристики объектов сразу. Шина в памяти
 * процесса; для нескольких экземпляров сервиса её заменяют брокером.
 */
export interface RegistryEvent {
  type: 'entity.created' | 'entity.updated' | 'entity.deleted' | 'fact.changed';
  tenant: string;
  entityId: string;
  /** Для fact.changed: какой факт и что с ним произошло. */
  factId?: string;
  change?: 'created' | 'updated' | 'deleted';
  /** Время события. */
  at: string;
  /** Источник изменения (система/модуль), если передан в X-Source-System. */
  source?: string;
}

type Sub = (e: RegistryEvent) => void;

export class EventBus {
  private subs = new Set<{ tenant: string; fn: Sub }>();
  publish(e: Omit<RegistryEvent, 'at'>) {
    const ev = { ...e, at: new Date().toISOString() };
    for (const s of this.subs) if (s.tenant === e.tenant) s.fn(ev);
  }
  subscribe(tenant: string, fn: Sub): () => void {
    const s = { tenant, fn };
    this.subs.add(s);
    return () => this.subs.delete(s);
  }
}
