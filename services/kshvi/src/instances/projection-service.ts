import { projectWorld, type ProjectableWorld } from '../../../../packages/kshvi/src/projections/project';
import type { VisibilityActor } from '../../../../packages/kshvi/src/projections/visibility-policy';

export class ProjectionService {
  project(world: ProjectableWorld, actor: VisibilityActor) {
    return projectWorld(world, actor);
  }
}
