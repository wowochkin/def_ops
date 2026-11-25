import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AutonomyEditor } from '../../../src/modern/kshvi/preparation/AutonomyEditor';
import { InterventionDialog } from '../../../src/modern/kshvi/conduct/InterventionDialog';
import '../../../src/styles.css';
import '../../../src/modern/kshvi/kshvi.css';

function Controls() {
  const [confirmed, setConfirmed] = useState(false);
  return <main className="modern-kshvi">
    <AutonomyEditor profile={{ version: 1, level: 'MEDIUM', categories: [{ category: 'RECONNAISSANCE', intensity: 4, maxSeverity: 2 }] }} />
    <InterventionDialog currentAction="Проверка формы" onConfirm={() => setConfirmed(true)} />
    {confirmed && <output>Подтверждено</output>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Controls />);
