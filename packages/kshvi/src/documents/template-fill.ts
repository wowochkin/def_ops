import { computeDocumentSha256, type DocumentRequisites, type DocumentRevision } from './document';
import type { DocumentTemplate } from './template';

export type PermittedDocumentProjection = Readonly<{
  fields: Readonly<Record<string, string>>;
  requisites?: Partial<DocumentRequisites>;
}>;

export type FilledDocumentDraft = Readonly<{
  status: 'DRAFT';
  revision: DocumentRevision;
  autoFilledFields: readonly string[];
}>;

function render(layout: string, fields: Readonly<Record<string, string>>): string {
  return layout.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_placeholder, key: string) => {
    const value = fields[key];
    if (value === undefined || value === null) throw new Error(`UNKNOWN: ${key}; автозаполнение не подставляет значение вместо пробела`);
    return value;
  });
}

/** Вход — уже серверно разрешённая проекция; незапрошенные поля в документ не попадают. */
export async function fillTemplate(input: {
  template: DocumentTemplate;
  base: DocumentRevision;
  permittedProjection: PermittedDocumentProjection;
}): Promise<FilledDocumentDraft> {
  const autoFilledFields: string[] = [];
  let requisites = input.base.requisites;
  for (const key of input.template.autoFillRequisites) {
    const value = input.permittedProjection.requisites?.[key];
    if (value === undefined) continue;
    requisites = { ...requisites, [key]: value };
    autoFilledFields.push(`requisites.${key}`);
  }
  const fields = {
    ...input.permittedProjection.fields,
    body: input.permittedProjection.fields.body ?? input.base.content.body,
  };
  const body = render(input.template.textLayout, fields);
  autoFilledFields.push('content.body');
  const unsigned: DocumentRevision = {
    ...input.base,
    state: 'DRAFT',
    requisites,
    content: { ...input.base.content, body },
    approvalRouteId: input.template.approvalRouteId,
    signatures: [],
    delivery: { state: 'NOT_ISSUED', facts: [] },
    returnComment: undefined,
  };
  const sha256 = await computeDocumentSha256(unsigned);
  return { status: 'DRAFT', revision: { ...unsigned, sha256 }, autoFilledFields };
}
