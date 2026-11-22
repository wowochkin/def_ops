import { expect, it } from 'vitest';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import {
  continueFromCheckpoint,
  restartAutonomousShow,
  startArchiveShow,
  startAutonomousShow,
} from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { exportExpositionArchive, verifyExpositionDerivative } from '../src/exposition/exposition-export';
import { createProjectorProfile, projectExpositionForAudience } from '../src/exposition/exposition-projection';

it('AC-28: оба показа, продолжение и производный архив не меняют официальный источник и оценки', () => {
  const archive = officialArchive();
  const sourceBefore = JSON.stringify(archive);
  const assessmentsBefore = structuredClone(archive.officialAssessments);
  const program = expositionProgram();
  const policy = createAudiencePolicy({
    id: 'audience-policy-ac28', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
    showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'], publicDecisionIds: [],
  });
  const projector = createProjectorProfile({
    id: 'projector-ac28', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
  });

  const archiveShow = startArchiveShow({
    sourceArchive: archive, program, sessionId: 'ac28-archive', branchId: 'ac28-archive-exposition',
  });
  expect(archiveShow.journal).toEqual(archive.journal);
  expect(archiveShow.randomOutcomesCreated).toBe(0);
  expect(archiveShow.purpose).toBe('EXPOSITION');

  const autonomous = startAutonomousShow({
    sourceArchive: archive, program, seed: 28, sessionId: 'ac28-auto', branchId: 'ac28-auto-branch',
  });
  const continued = continueFromCheckpoint(autonomous, 'cp-1', {
    sessionId: 'ac28-continued', branchId: 'ac28-continued-branch',
  });
  const replayed = restartAutonomousShow(continued, { mode: 'REPLAY_SAVED_LINE', sessionId: 'ac28-replayed' });
  expect(replayed.journal).toEqual(continued.journal);
  expect(replayed.branchId).toBe(continued.branchId);

  const audience = projectExpositionForAudience({ session: continued, policy, projector });
  expect(audience.map.weather).toBeDefined();
  expect(audience.map.terrain).toBeDefined();
  expect(audience.map.logistics).toBeDefined();
  expect(audience.map.modernSymbols).toBeDefined();
  expect(JSON.stringify(audience)).not.toContain('Скрытый служебный замысел');

  expect(() => exportExpositionArchive({ session: continued, policy, archiveId: archive.archiveId }))
    .toThrow('идентификатор официального архива');
  const derivative = exportExpositionArchive({ session: continued, policy, archiveId: 'ac28-derived-archive' });
  expect(derivative.schemaVersion).toBe('1.0.0');
  expect(derivative.archiveId).toBe('ac28-derived-archive');
  expect(derivative.archiveId).not.toBe(archive.archiveId);
  expect(derivative.branchId).toBe('ac28-continued-branch');
  expect(derivative.purpose).toBe('EXPOSITION');
  expect(derivative.label).toBe('Экспозиция');
  expect(derivative.origin).toMatchObject({
    archiveId: archive.archiveId,
    branchId: archive.branchId,
    manifestHash: archive.manifestHash,
    parentBranchId: autonomous.branchId,
    checkpointId: 'cp-1',
  });
  expect(derivative.program).toEqual(program);
  expect(derivative.explanations).toEqual(program.explanations);
  expect(derivative.audiencePolicy).toEqual(policy);
  expect(derivative.seed).toBe(28);
  expect(derivative.journal).toEqual(continued.journal);
  expect(derivative.officialAssessmentCreated).toBe(false);
  expect(derivative.officialAssessments).toEqual([]);
  expect(derivative.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  expect(verifyExpositionDerivative(derivative, archive)).toBe(true);

  expect(JSON.stringify(archive)).toBe(sourceBefore);
  expect(archive.officialAssessments).toEqual(assessmentsBefore);
  expect(archive.manifestHash).toBe('a'.repeat(64));
});
