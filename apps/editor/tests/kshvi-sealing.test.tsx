// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { SealingStep } from '../src/modern/kshvi/preparation/SealingStep';
import {
  READINESS_AREAS,
  REHEARSAL_CHECKS,
  type SealScenarioInput,
} from '../../../packages/kshvi/src/scenario/sealing';
import { VALIDATION_AREAS, type ValidationReport } from '../../../packages/kshvi/src/scenario/validation';
import {
  addInitialMapMarker,
  approveInitialMap,
  createInitialSituationMap,
  type ApprovedInitialMap,
} from '../../../packages/kshvi/src/scenario/initial-map';
import { hashCanonical } from '../../../packages/kshvi/src/scenario/initial-map-hash';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-02T06:00:00+03:00';
const scenario = { id: 'scenario-ui', title: 'Учение', stages: ['one', 'two'] };

function validMap(): ApprovedInitialMap {
  const map = createInitialSituationMap({
    id: 'map-sealing-ui', revision: 1,
    environment: { snapshotId: 'env-1', manifestSha256: hashA, bounds: [0, 0, 1, 1] },
    initialOperationalAt: start, timeZone: 'Europe/Moscow', weatherFrameRef: 'weather-1', terrainStateRef: 'terrain-1',
    symbolSet: { id: 'symbols', revision: 1, sha256: hashB }, attribution: ['OSM'],
  });
  return approveInitialMap(addInitialMapMarker(map, {
    id: 'force', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: 'source', authorId: 'author', eventId: 'event',
    validFrom: start, validUntil: end, state: 'OBSERVED', confidence: 0.8,
    uncertainty: { radiusM: 10, note: '' }, visibility: { sideIds: ['blue'] }, links: { forceId: 'force-1' },
    sideId: 'blue', symbol: { id: 'force', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'source.doc', sourcePage: 1 },
  }));
}

function validReport(): ValidationReport {
  return { schemaVersion: 1, checkedAreas: VALIDATION_AREAS, issues: [], status: 'OK' };
}

function validInput(): SealScenarioInput {
  return {
    id: 'scenario-ui', revision: 2, state: 'APPROVED', scenario, issues: [],
    requiredConfirmations: [...READINESS_AREAS],
    confirmations: READINESS_AREAS.map(area => ({
      id: area === 'ENVIRONMENT_MAP' ? 'confirm-env' : area === 'DOCUMENTS' ? 'confirm-docs' : `confirm-${area}`,
      area,
      userId: area === 'ENVIRONMENT_MAP' ? 'env-owner' : area === 'DOCUMENTS' ? 'docs-owner' : `owner-${area}`,
      role: 'RESPONSIBLE', confirmedAt: start, subjectHash: hashA, dependsOn: [],
    })),
    confirmationSubjects: Object.fromEntries(READINESS_AREAS.map(area => [area, hashA])),
    rehearsal: {
      schemaVersion: 1, id: 'rehearsal-ui', scenarioSha256: hashCanonical(scenario), full: true, isolated: true,
      status: 'PASSED', eventLogId: 'rehearsal-log', officialEventLogId: 'official-log',
      checks: Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])),
    },
    initialMap: validMap(),
    environmentSnapshot: { manifestSha256: hashA, contentRef: 'environment/hash', autonomous: true },
    expectedEnvironmentSha256: hashA,
    officialEventLogId: 'official-log', sealedAt: start,
    hashes: { weather: hashB, elevation: hashB, symbols: hashB, agents: hashB, eventLibrary: hashB, models: hashB, roles: hashB, communications: hashB, documents: hashB, rehearsal: hashC },
  };
}

const startCommand = { instanceId: 'instance-ui', idempotencyKey: 'start-ui', seed: 'seed-ui', actorRole: 'DIRECTOR', serverCommand: true };

describe('SealingStep: проверка и персональные подтверждения', () => {
  it('показывает все области проверки и отдельных ответственных', () => {
    render(<SealingStep report={validReport()} input={validInput()} onValidate={vi.fn(() => validReport())} onRehearsal={vi.fn()} startCommand={startCommand} />);
    expect(screen.getByRole('heading', { name: 'Проверка и фиксация сценария' })).toBeTruthy();
    expect(screen.getByText(`Областей проверено: ${VALIDATION_AREAS.length}`)).toBeTruthy();
    expect(screen.getByText('env-owner')).toBeTruthy();
    expect(screen.getByText('docs-owner')).toBeTruthy();
    expect(screen.getByText('DRAFT → IN_REVIEW → APPROVED → SEALED → ACTIVE ↔ PAUSED → COMPLETED → ARCHIVED')).toBeTruthy();
  });

  it('показывает блокирующую ошибку и не вызывает подтверждение SEALED', () => {
    const input = validInput();
    input.issues = [{ severity: 'ERROR', code: 'MAP_INVALID', message: 'Ошибка карты' }];
    const report = { ...validReport(), status: 'ERROR' as const, issues: [{ code: 'MAP_INVALID', severity: 'ERROR' as const, area: 'INITIAL_MAP' as const, message: 'Ошибка карты', waivable: false }] };
    const onSealed = vi.fn();
    render(<SealingStep report={report} input={input} onValidate={vi.fn(() => report)} onRehearsal={vi.fn()} onSealed={onSealed} startCommand={startCommand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать SEALED' }));
    expect(screen.getByRole('alert').textContent).toContain('MAP_INVALID');
    expect(onSealed).not.toHaveBeenCalled();
  });

  it('отмечает отсутствующее персональное подтверждение', () => {
    const input = validInput();
    input.confirmations = input.confirmations.filter(item => item.area !== 'DOCUMENTS');
    render(<SealingStep report={validReport()} input={input} onValidate={vi.fn(() => validReport())} onRehearsal={vi.fn()} startCommand={startCommand} />);
    expect(screen.getByText('Требуется подтверждение: DOCUMENTS')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать SEALED' }));
    expect(screen.getByText(/CONFIRMATION_REQUIRED:DOCUMENTS/)).toBeTruthy();
  });
});

describe('SealingStep: репетиция, SEALED и запуск', () => {
  it('запускает полный пробный прогон через интеграционный порт', async () => {
    const input = validInput();
    const onRehearsal = vi.fn(async () => input.rehearsal!);
    render(<SealingStep report={validReport()} input={input} onValidate={vi.fn(() => validReport())} onRehearsal={onRehearsal} startCommand={startCommand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Запустить полный пробный прогон' }));
    await waitFor(() => expect(onRehearsal).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Пробный прогон: PASSED; проверок: 14')).toBeTruthy();
    expect(screen.getByText('Журнал репетиции изолирован от официального учения')).toBeTruthy();
  });

  it('фиксирует хеши карты и сценария, затем идемпотентно запускает сеанс', async () => {
    const onSealed = vi.fn();
    const onStart = vi.fn();
    render(<SealingStep report={validReport()} input={validInput()} onValidate={vi.fn(() => validReport())} onRehearsal={vi.fn()} onSealed={onSealed} onStart={onStart} startCommand={startCommand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать SEALED' }));
    expect(onSealed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Сценарий: [0-9a-f]{64}/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Карта: ${validMap().sha256}`))).toBeTruthy();
    const startButton = screen.getByRole('button', { name: 'Запустить сеанс' });
    fireEvent.click(startButton);
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart.mock.calls[0][0]).toBe(onStart.mock.calls[1][0]);
    expect(screen.getByText('Зарегистрировано сеансов: 1')).toBeTruthy();
    expect(screen.getByText('Сеанс: ACTIVE; журнал: events-instance-ui')).toBeTruthy();
  });
});

describe('SealingStep: браузерный вход', () => {
  it('не использует серверный вход пакета или Node API', () => {
    const step = readFileSync('apps/editor/src/modern/kshvi/preparation/SealingStep.tsx', 'utf8');
    const confirmations = readFileSync('apps/editor/src/modern/kshvi/preparation/SealingConfirmations.tsx', 'utf8');
    expect(step + confirmations).not.toContain("@def-ops/kshvi'");
    expect(step + confirmations).not.toMatch(/node:|indexedDB|\bfetch\s*\(/);
  });
});


describe('SealingStep: единый результат валидации', () => {
  it('не игнорирует ERROR отчёта, если он отсутствует в исходном вводе', () => {
    const input = validInput();
    input.issues = [];
    const report = { ...validReport(), status: 'ERROR' as const, issues: [{ code: 'REPORT_ERROR', severity: 'ERROR' as const, area: 'MODEL' as const, message: 'Ошибка отчёта', waivable: false }] };
    const onSealed = vi.fn();
    render(<SealingStep report={report} input={input} onValidate={vi.fn(() => report)} onRehearsal={vi.fn()} onSealed={onSealed} startCommand={startCommand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать SEALED' }));
    expect(screen.getByRole('alert').textContent).toContain('REPORT_ERROR');
    expect(onSealed).not.toHaveBeenCalled();
  });
});
