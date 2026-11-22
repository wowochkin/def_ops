import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConductWorkspace, type ConductRole } from './ConductWorkspace';
import { HttpConductClient } from './conduct-api';
import './conduct.css';

const roles = [
  ['TRAINEE', 'Обучаемый'], ['LEADER', 'Руководитель'], ['PLAYGROUP', 'Группа розыгрыша'],
  ['INTERMEDIARY', 'Посредник'], ['ANALYST', 'Аналитик'], ['PROJECTOR', 'Проектор'],
] as const;

function ConductPreview() {
  const [role, setRole] = useState<ConductRole>('TRAINEE');
  const context = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    return { instanceId: query.get('instanceId') ?? 'preview-instance', sideId: query.get('sideId') ?? 'blue', role, operationalAt: query.get('operationalAt') ?? undefined };
  }, [role]);
  const client = useMemo(() => new HttpConductClient(context), [context]);
  return <div className="kshvi-preview">
    <nav className="kshvi-preview-nav" aria-label="Рабочие места КШВИ">{roles.map(([id, label]) => <button type="button" key={id} aria-current={role === id ? 'page' : undefined} onClick={() => setRole(id)}>{label}</button>)}</nav>
    <ConductWorkspace role={role} client={client} context={context} />
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент предпросмотра КШВИ');
createRoot(root).render(<ConductPreview />);
