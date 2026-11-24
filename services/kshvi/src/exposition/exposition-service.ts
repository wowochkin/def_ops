import type { AudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import {
  controlExposition,
  type ExpositionSession,
  type PresenterCommand,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import {
  projectExpositionForAudience,
  type AudienceProjection,
  type ProjectorProfile,
} from './exposition-projection';

export function applyPresenterCommand(input: Readonly<{
  session: ExpositionSession;
  command: PresenterCommand;
  policy: AudiencePolicy;
  projector: ProjectorProfile;
}>): Readonly<{ session: ExpositionSession; audience: AudienceProjection }> {
  const session = controlExposition(input.session, input.command);
  return {
    session,
    audience: projectExpositionForAudience({ session, policy: input.policy, projector: input.projector }),
  };
}
