import { useEffect, useRef, useState } from 'react';
import '../admin/admin.css';

export function AccessibleCommandDialog({ title, description, confirmLabel, confirmationPhrase, onConfirm, onCancel }: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmationPhrase?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => { previous?.focus(); };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])]
      .filter(element => !element.hasAttribute('disabled'));
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="kshvi-dialog-backdrop">
    <div ref={rootRef} className="kshvi-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="command-dialog-title" aria-describedby="command-dialog-description" onKeyDown={handleKeyDown}>
      <h2 id="command-dialog-title">{title}</h2><p id="command-dialog-description">{description}</p>
      {confirmationPhrase && <label>Введите {confirmationPhrase}<input value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" /></label>}
      <div className="kshvi-dialog-actions">
        <button ref={cancelRef} onClick={onCancel}>Отмена</button>
        <button className="kshvi-danger" disabled={Boolean(confirmationPhrase && phrase !== confirmationPhrase)} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}
