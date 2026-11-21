import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AnalystWorkspace,
  IntermediaryWorkspace,
  LeaderWorkspace,
  PlaygroupWorkspace,
  ProjectorWorkspace,
  TraineeWorkspace,
} from './browser';

const roles = [
  ['TRAINEE', 'Обучаемый'], ['LEADER', 'Руководитель'], ['PLAYGROUP', 'Группа розыгрыша'],
  ['INTERMEDIARY', 'Посредник'], ['ANALYST', 'Аналитик'], ['PROJECTOR', 'Проектор'],
] as const;
type PreviewRole = typeof roles[number][0];

function ConductPreview() {
  const [role, setRole] = useState<PreviewRole>('TRAINEE');
  return <div className="kshvi-preview">
    <nav className="kshvi-preview-nav" aria-label="Рабочие места КШВИ">{roles.map(([id, label]) => <button type="button" key={id} aria-current={role === id ? 'page' : undefined} onClick={() => setRole(id)}>{label}</button>)}</nav>
    {role === 'TRAINEE' && <TraineeWorkspace />}
    {role === 'LEADER' && <LeaderWorkspace />}
    {role === 'PLAYGROUP' && <PlaygroupWorkspace />}
    {role === 'INTERMEDIARY' && <IntermediaryWorkspace />}
    {role === 'ANALYST' && <AnalystWorkspace canReadTruth />}
    {role === 'PROJECTOR' && <ProjectorWorkspace />}
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент предпросмотра КШВИ');
createRoot(root).render(<ConductPreview />);
