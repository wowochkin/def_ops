import { useState } from 'react';

export function InterventionDialog({ currentAction, onConfirm }: { currentAction: string; onConfirm: () => void }) {
  const [intercepted, setIntercepted] = useState(false);
  return <section><h2>Перехват управления</h2><p>Текущее действие: {currentAction}</p>{!intercepted ? <button onClick={() => { setIntercepted(true); onConfirm(); }}>Перехватить управление</button> : <p role="status">Мир не откатывается; дальнейшие действия подписывает человек</p>}</section>;
}
