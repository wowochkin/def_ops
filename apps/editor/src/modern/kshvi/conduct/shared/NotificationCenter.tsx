import { useState } from 'react';
import type { ConductNotification } from './types';

export function NotificationCenter({ notifications, onAcknowledge, onDismiss }: {
  notifications: readonly ConductNotification[];
  onAcknowledge?: (groupId: string) => void;
  onDismiss?: (groupId: string) => void;
}) {
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [sound, setSound] = useState(true);
  const [popups, setPopups] = useState(true);
  const groups = new Map<string, ConductNotification[]>();
  for (const notification of notifications) groups.set(notification.groupId, [...groups.get(notification.groupId) ?? [], notification]);
  return <section className="kshvi-notifications" aria-label="Уведомления">
    <fieldset><legend>Профиль уведомлений</legend><label><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} />Звуковые уведомления</label><label><input type="checkbox" checked={popups} onChange={event => setPopups(event.target.checked)} />Всплывающие уведомления</label></fieldset>
    {[...groups.entries()].filter(([groupId]) => !dismissed.includes(groupId)).map(([groupId, items]) => {
      const critical = items.some(item => item.priority === 'CRITICAL');
      const isAcknowledged = acknowledged.includes(groupId) || items.every(item => item.acknowledged);
      return <article key={groupId} className={critical ? 'kshvi-notification-critical' : ''}>
        <strong>{items[0].text}</strong><span>{items.length} события</span>
        <p>Приоритет: {items[0].priority}; адресат: {items[0].recipient}; срок: {items.map(item => item.dueAt).sort().at(-1)}</p>
        {isAcknowledged ? <p>Подтверждено</p> : critical ? <button type="button" onClick={() => { setAcknowledged(current => [...current, groupId]); onAcknowledge?.(groupId); }}>Подтвердить критическое</button>
          : <button type="button" onClick={() => { setDismissed(current => [...current, groupId]); onDismiss?.(groupId); }}>Скрыть</button>}
      </article>;
    })}
  </section>;
}
