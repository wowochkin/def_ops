import { randomUUID } from 'node:crypto';

export type TechnicalNotification = Readonly<{
  id: string;
  recipientId: string;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  title: string;
  deduplicationKey: string;
  createdAt: string;
  expiresAt: string;
  groupCount: number;
  acknowledgedAt: string | null;
}>;

export class NotificationService {
  private readonly notifications = new Map<string, TechnicalNotification>();
  private readonly preferences = new Map<string, { sound: boolean; popup: boolean }>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  publish(input: Omit<TechnicalNotification, 'id' | 'createdAt' | 'groupCount' | 'acknowledgedAt'>): TechnicalNotification {
    const existing = [...this.notifications.values()].find(notification => notification.recipientId === input.recipientId
      && notification.deduplicationKey === input.deduplicationKey && !notification.acknowledgedAt);
    if (existing) {
      const grouped = { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, groupCount: existing.groupCount + 1, acknowledgedAt: null };
      this.notifications.set(existing.id, grouped);
      return structuredClone(grouped);
    }
    const notification: TechnicalNotification = Object.freeze({
      ...input, id: randomUUID(), createdAt: this.now().toISOString(), groupCount: 1, acknowledgedAt: null,
    });
    this.notifications.set(notification.id, notification);
    return structuredClone(notification);
  }

  visibleFor(recipientId: string): TechnicalNotification[] {
    const timestamp = this.now().getTime();
    const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 } as const;
    return [...this.notifications.values()]
      .filter(notification => notification.recipientId === recipientId && !notification.acknowledgedAt
        && (notification.priority === 'CRITICAL' || Date.parse(notification.expiresAt) > timestamp))
      .sort((left, right) => rank[left.priority] - rank[right.priority])
      .map(notification => structuredClone(notification));
  }

  acknowledge(id: string, recipientId: string): TechnicalNotification {
    const notification = this.notifications.get(id);
    if (!notification) throw new Error('Уведомление не найдено');
    if (notification.recipientId !== recipientId) throw new Error('Подтверждение доступно только адресату');
    const acknowledged = { ...notification, acknowledgedAt: this.now().toISOString() };
    this.notifications.set(id, acknowledged);
    return structuredClone(acknowledged);
  }

  setPreferences(recipientId: string, preferences: { sound: boolean; popup: boolean }): void {
    this.preferences.set(recipientId, { ...preferences });
  }
}
