import type { DocumentRevision } from './document';
import {
  createDocumentExportModel,
  type DocumentExportContext,
  type DocumentExportModel,
} from './export-model';

export function exportDocument(revision: DocumentRevision, context: DocumentExportContext): DocumentExportModel {
  return createDocumentExportModel(revision, context);
}
