import { useEffect, useState } from 'react';
import { AnalystWorkspace } from './AnalystWorkspace';
import { LegacyConductWorkspace } from './LegacyConductWorkspace';
import { IntermediaryWorkspace } from './IntermediaryWorkspace';
import { LeaderWorkspace } from './LeaderWorkspace';
import { PlaygroupWorkspace } from './PlaygroupWorkspace';
import { ProjectorWorkspace } from './ProjectorWorkspace';
import { TraineeWorkspace } from './TraineeWorkspace';
import { WorkspaceState } from './shared/WorkspaceState';
import type { ConductClient, ConductProjection, WorkspaceStatus } from './shared/types';

export type ConductRole = 'TRAINEE' | 'LEADER' | 'PLAYGROUP' | 'INTERMEDIARY' | 'ANALYST' | 'PROJECTOR';
function errorStatus(cause: unknown): WorkspaceStatus {
  const status = typeof cause === 'object' && cause !== null && 'status' in cause ? Number((cause as { status?: unknown }).status) : 0;
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NO_DATA';
  if (status >= 500 || status === 0) return 'UNAVAILABLE';
  return 'PARTIAL_FAILURE';
}

export function ConductWorkspace({ role, client, context, onHandover }: {
  role?: ConductRole;
  client?: ConductClient;
  context?: { instanceId: string; sideId: string; role: string; operationalAt?: string };
  onHandover?: () => void | Promise<void>;
}) {
  const [projection, setProjection] = useState<ConductProjection | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus | 'READY'>('LOADING');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!client || !context || role === 'PROJECTOR') return;
    let current = true;
    setStatus('LOADING');
    void client.loadProjection(context).then(result => {
      if (!current) return;
      if (result.status === 'READY') { setProjection(result); setStatus('READY'); }
      else setStatus(result.status);
    }).catch(cause => { if (current) setStatus(errorStatus(cause)); });
    return () => { current = false; };
  }, [client, context?.instanceId, context?.sideId, context?.role, context?.operationalAt, reload, role]);
  if (!role || !client || !context) return <LegacyConductWorkspace />;
  if (role === 'PROJECTOR') return <ProjectorWorkspace commands={client} />;
  if (status !== 'READY') return <main className="kshvi-conduct-workspace"><h1>Серверная проекция КШВИ</h1><WorkspaceState status={status} onAction={() => setReload(value => value + 1)} /></main>;
  if (!projection) return <WorkspaceState status="NO_DATA" onAction={() => setReload(value => value + 1)} />;
  if (role === 'TRAINEE') return <TraineeWorkspace projection={projection} commands={client} onHandover={onHandover} />;
  if (role === 'LEADER') return <LeaderWorkspace projection={projection} commands={client} onHandover={onHandover} />;
  if (role === 'PLAYGROUP') return <PlaygroupWorkspace projection={projection} commands={client} onHandover={onHandover} />;
  if (role === 'INTERMEDIARY') return <IntermediaryWorkspace projection={projection} onHandover={onHandover} />;
  return <AnalystWorkspace projection={projection} commands={client} onHandover={onHandover} />;
}
