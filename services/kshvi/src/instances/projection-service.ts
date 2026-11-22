import { projectWorld, type ProjectableWorld } from '../../../../packages/kshvi/src/projections/project';
import type { VisibilityActor } from '../../../../packages/kshvi/src/projections/visibility-policy';

export class ProjectionService {
  project(world: ProjectableWorld, actor: VisibilityActor) {
    return projectWorld(world, actor);
  }

  search(world: ProjectableWorld, actor: VisibilityActor, query: string) {
    const projected = this.project(world, actor);
    const needle = query.trim().toLocaleLowerCase('ru');
    const matches = (value: unknown) => JSON.stringify(value).toLocaleLowerCase('ru').includes(needle);
    return {
      ...projected,
      forces: projected.forces.filter(matches),
      observations: projected.observations.filter(matches),
      inputs: projected.inputs.filter(matches),
      ...('documents' in projected ? { documents: projected.documents.filter(matches) } : {}),
    };
  }

  export(world: ProjectableWorld, actor: VisibilityActor) {
    return this.project(world, actor);
  }

  attachment(world: ProjectableWorld, actor: VisibilityActor, documentId: string, attachmentId: string): string {
    const projected = this.project(world, actor);
    const document = 'documents' in projected ? projected.documents.find(item => item.id === documentId) : undefined;
    const attachment = document?.attachments.find(item => item.id === attachmentId);
    if (!attachment) throw new Error('403: Вложение недоступно');
    return attachment.content;
  }
}
