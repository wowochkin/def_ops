import { readFile } from 'node:fs/promises';
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

export async function createFileExpositionService(input: Readonly<{
  repository: ExpositionRepository;
  runtimePath: string;
  engine?: AgentEnginePort;
}>): Promise<ExpositionSessionService> {
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
