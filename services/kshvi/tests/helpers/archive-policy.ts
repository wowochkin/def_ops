import { ARCHIVE_COMPONENTS } from '../../../../packages/kshvi/src/archive/archive-components';
import { StaticArchiveActorPolicyAdapter } from '../../src/archive/archive-exporter';

const componentIds = ARCHIVE_COMPONENTS.map(component => component.id);
const audiences = ['GENERAL', 'PRIVATE', 'PUBLIC', 'commanders'];
const assignments = ['exporter-1', 'offline-exporter', 'exporter', 'forbidden'].map(userId => ({
  organizationId: 'org-1', userId, componentIds, sideIds: ['blue', 'red'], audiences, includeDisplayNames: false,
}));
export const fullArchivePolicyAdapter = new StaticArchiveActorPolicyAdapter(assignments);
