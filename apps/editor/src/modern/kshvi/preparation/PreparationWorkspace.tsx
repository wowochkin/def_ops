import { AutonomyEditor, type AutonomyEditorProfile } from './AutonomyEditor';
import { CatalogBrowser } from './CatalogBrowser';
import { RehearsalReport } from './RehearsalReport';
import { ReadinessStep } from './ReadinessStep';
import { LogisticsStep } from './LogisticsStep';
import { FormationStep } from './FormationStep';
import { EquipmentStep } from './EquipmentStep';
import { applyEquipmentGroupChange, createEquipmentRowsFromTemplate, exportEquipmentTable, importEquipmentTable, previewEquipmentGroupChange, validateEquipmentEditorRows } from '@def-ops/kshvi/browser';

const categories = ['CONTROL', 'RECONNAISSANCE', 'MANEUVER', 'COMBAT', 'ENGINEERING', 'ENVIRONMENT', 'LOGISTICS', 'MAINTENANCE', 'PERSONNEL', 'MEDICAL', 'SETTLEMENTS', 'INTERACTION'];
const defaultProfile: AutonomyEditorProfile = { version: 1, level: 'MEDIUM', categories: categories.map(category => ({ category, intensity: 2, maxSeverity: 2 })) };

export function PreparationWorkspace() {
  return <section className="kshvi-preparation-workspace">
    <AutonomyEditor profile={defaultProfile} />
    <CatalogBrowser total={240} categories={12} operations={48} />
    <RehearsalReport attempts={[]} />
    <ReadinessStep
      stage={{ title: 'Этап обеспечения боевой готовности', startsAt: 'не назначено', dueAt: 'не назначено', signal: { id: 'Сигнал готовности', receivedAt: null } }}
      activities={[]}
      readiness={{ status: 'NOT_STARTED', initialLevel: null, requiredLevel: null, limitations: ['SIGNAL_NOT_RECEIVED'] }}
    />
    <LogisticsStep requests={[]} movements={[]} balances={[]} repairs={[]} />
    <FormationStep
      plan={{ id: 'План оперативного построения', orderVersion: 1, echelons: [], reserves: [], columns: [], areas: [], controlPosts: [] }}
      issues={[]}
      execution={{ status: 'PLANNED', positions: [] }}
    />
    <EquipmentStep
      initialRows={createEquipmentRowsFromTemplate([])}
      operations={{
        importTable: importEquipmentTable,
        exportTable: exportEquipmentTable,
        previewGroupChange: previewEquipmentGroupChange,
        applyGroupChange: applyEquipmentGroupChange,
        validateRows: validateEquipmentEditorRows,
      }}
    />
  </section>;
}
