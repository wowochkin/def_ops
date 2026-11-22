import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expositionProgram, officialArchive } from '../../../../packages/kshvi/tests/fixtures/exposition';
import { sealOfficialExpositionArchive } from './exposition-repository';
import balancedProfile from '../../../../packages/kshvi-agents/data/modern-profiles/balanced.json' with { type: 'json' };
import type { AgentEnginePort } from '../../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../../packages/kshvi-agents/src/ports/modern-choice';
import { createAudiencePolicy, type AudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import { RustWorker } from '../agents/rust-worker';
import { ExpositionSessionService } from './exposition-session-service';
import { createProjectorProfile, type ProjectorProfile } from './exposition-projection';
import { SystemAgentExpositionCalculator } from './system-agent-calculator';
import type { ExpositionRepository } from './exposition-repository';

export type ExpositionRuntimeConfig = Readonly<{
  policy: Parameters<typeof createAudiencePolicy>[0];
  projectors: readonly Readonly<{ id: string; allowedLayers: ProjectorProfile['allowedLayers'] }>[];
}>;

async function ensureExpositionFiles(input: Readonly<{
  runtimePath: string;
  archivePath?: string;
  programPath?: string;
  allowDemoFixtures?: boolean;
}>): Promise<void> {
  const archivePath = input.archivePath ?? './data/kshvi/exposition/official-archive.json';
  const programPath = input.programPath ?? './data/kshvi/exposition/program.json';
  try {
    await Promise.all([readFile(input.runtimePath, 'utf8'), readFile(archivePath, 'utf8'), readFile(programPath, 'utf8')]);
    return;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
  if (!input.allowDemoFixtures) throw new Error('Официальный комплект экспозиции не найден: задайте runtime, архив и программу');
  const layers = ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'] as const;
  const config: ExpositionRuntimeConfig = {
    policy: {
      id: 'development-audience', allowedLayers: layers, showPlanFact: true, showExplanations: true,
      publicCaptionIds: ['caption-public'], publicExplanationIds: ['explanation-public'], publicDecisionIds: [],
    },
    projectors: [{ id: 'development-projector', allowedLayers: layers }],
  };
  await Promise.all([mkdir(dirname(input.runtimePath), { recursive: true }), mkdir(dirname(archivePath), { recursive: true }), mkdir(dirname(programPath), { recursive: true })]);
  await Promise.all([
    writeFile(input.runtimePath, JSON.stringify(config, null, 2)),
    writeFile(archivePath, JSON.stringify(sealOfficialExpositionArchive(officialArchive()), null, 2)),
    writeFile(programPath, JSON.stringify(expositionProgram(), null, 2)),
  ]);
}

export async function createFileExpositionService(input: Readonly<{
  repository: ExpositionRepository;
  runtimePath: string;
  archivePath?: string;
  programPath?: string;
  allowDemoFixtures?: boolean;
  engine?: AgentEnginePort;
}>): Promise<ExpositionSessionService> {
  await ensureExpositionFiles(input);
  const config = JSON.parse(await readFile(input.runtimePath, 'utf8')) as ExpositionRuntimeConfig;
  let worker: AgentEnginePort | undefined = input.engine;
  const engine: AgentEnginePort = {
    async evaluateChoices(request) {
      worker ??= new RustWorker();
      return worker.evaluateChoices(request);
    },
    async close() { await worker?.close?.(); },
  };
  return new ExpositionSessionService({
    repository: input.repository,
    calculator: new SystemAgentExpositionCalculator({
      engine,
      profileFor: side => assertModernAgentProfile({ ...balancedProfile, id: side.agentId, version: side.profileVersion }),
    }),
    policy: createAudiencePolicy(config.policy as AudiencePolicy),
    projectors: config.projectors.map(createProjectorProfile),
  });
}
