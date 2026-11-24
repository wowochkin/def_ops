import type { AdminOverview } from '../kshvi-api';
import { AccountsWorkspace } from './AccountsWorkspace';
import { ConfigCatalog } from './ConfigCatalog';
import { DataSetsPanel } from './DataSetsPanel';
import { OperationsDashboard } from './OperationsDashboard';
import { RoleAssignments } from './RoleAssignments';
import { SecurityAudit } from './SecurityAudit';

export function AdminWorkspace({ overview, onBlock, onArchive, onRevoke, onExportAudit }: {
  overview: AdminOverview;
  onBlock: (accountId: string) => void;
  onArchive: (accountId: string) => void;
  onRevoke: (assignmentId: string) => void;
  onExportAudit: () => void;
}) {
  return <div className="kshvi-admin-workspace">
    <OperationsDashboard snapshot={overview.snapshot} />
    <AccountsWorkspace accounts={overview.accounts} disseminationLabel="ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ" onBlock={onBlock} onArchive={onArchive} />
    <RoleAssignments assignments={overview.assignments} onRevoke={onRevoke} />
    <ConfigCatalog versions={overview.versions} retention={overview.retention} />
    <DataSetsPanel datasets={overview.datasets} />
    <SecurityAudit events={overview.events} onExport={onExportAudit} />
  </div>;
}
