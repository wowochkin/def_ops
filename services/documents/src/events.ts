/**
 * События изменений документов. Подписчики (редакторы, внешние системы)
 * получают их потоком Server-Sent Events. Шина в памяти процесса; для
 * нескольких экземпляров сервиса её заменяют брокером (NATS, Kafka, Redis).
 */
export interface DocumentEvent {
  type: 'document.created' | 'document.updated' | 'document.deleted' | 'layer.updated' | 'layer.features.replaced';
  tenant: string;
  documentId: string;
  revision?: number;
  layerId?: string;
  at: string;
  /** Источник изменения (система/модуль), если передан в X-Source-System. */
  source?: string;
}

type Sub = (e: DocumentEvent) => void;

export class EventBus {
  private subs = new Set<{ tenant: string; fn: Sub }>();
  publish(e: Omit<DocumentEvent, 'at'>) {
    const ev = { ...e, at: new Date().toISOString() };
    for (const s of this.subs) if (s.tenant === e.tenant) s.fn(ev);
  }
  subscribe(tenant: string, fn: Sub): () => void {
    const s = { tenant, fn };
    this.subs.add(s);
    return () => this.subs.delete(s);
  }
}
