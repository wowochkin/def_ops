/**
 * События сервиса картографии (поток Server-Sent Events /cartography/events):
 * изменения карт и ход заданий. Шина в памяти процесса, события — только своей
 * организации.
 *
 * job.done — задание выполнено; job.failed — завершилось ошибкой или отменено
 * (различает поле job.status: failed | cancelled).
 */
import type { MapJob } from '@def-ops/core';

export interface CartographyEvent {
  type: 'map.created' | 'map.updated' | 'map.deleted' | 'job.progress' | 'job.done' | 'job.failed';
  tenant: string;
  mapId: string;
  jobId?: string;
  /** Для событий заданий — снимок задания. */
  job?: MapJob;
  at: string;
}

type Sub = (e: CartographyEvent) => void;

export class EventBus {
  private subs = new Set<{ tenant: string; fn: Sub }>();
  publish(e: Omit<CartographyEvent, 'at'>) {
    const ev = { ...e, at: new Date().toISOString() };
    for (const s of this.subs) if (s.tenant === e.tenant) s.fn(ev);
  }
  subscribe(tenant: string, fn: Sub): () => void {
    const s = { tenant, fn };
    this.subs.add(s);
    return () => this.subs.delete(s);
  }
}
