import JSZip from 'jszip';
import type { DocumentRevision } from './document';
import { exportDocumentDocx } from './export-docx';
import { exportDocument } from './export-json';
import type { DocumentExportContext, DocumentExportModel } from './export-model';
import { exportDocumentPdf } from './export-pdf';

export type DocumentExportSet = Readonly<{
  model: DocumentExportModel;
  json: string;
  pdf: Uint8Array;
  docx: Uint8Array;
}>;

export async function exportDocumentSet(revision: DocumentRevision, context: DocumentExportContext): Promise<DocumentExportSet> {
  const model = exportDocument(revision, context);
  const [pdf, docx] = await Promise.all([exportDocumentPdf(model), exportDocumentDocx(model)]);
  return { model, json: JSON.stringify(model, null, 2), pdf, docx };
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export async function verifyExportSet(set: DocumentExportSet): Promise<Readonly<{ valid: boolean; issues: readonly string[] }>> {
  const issues: string[] = [];
  let parsed: DocumentExportModel;
  try {
    parsed = JSON.parse(set.json) as DocumentExportModel;
  } catch {
    return { valid: false, issues: ['JSON_INVALID'] };
  }
  if (parsed.source.revision !== set.model.source.revision || parsed.source.documentId !== set.model.source.documentId) issues.push('SOURCE_REVISION_MISMATCH');
  if (parsed.source.sha256 !== set.model.source.sha256 || parsed.source.templateVersion !== set.model.source.templateVersion) issues.push('SOURCE_HASH_MISMATCH');
  if (JSON.stringify(parsed.contentBlocks) !== JSON.stringify(set.model.contentBlocks)) issues.push('CONTENT_BLOCKS_MISMATCH');
  if (JSON.stringify(parsed.legend) !== JSON.stringify(set.model.legend) || JSON.stringify(parsed.attribution) !== JSON.stringify(set.model.attribution)) issues.push('MAP_ATTRIBUTION_MISMATCH');
  if (new TextDecoder().decode(set.pdf.slice(0, 5)) !== '%PDF-') issues.push('PDF_INVALID');
  try {
    const zip = await JSZip.loadAsync(set.docx);
    const document = await zip.file('word/document.xml')?.async('string');
    if (!document) issues.push('DOCX_DOCUMENT_MISSING');
    else {
      for (const block of set.model.contentBlocks) {
        if (!document.includes(xml(block.text))) issues.push('DOCX_CONTENT_MISMATCH');
      }
      if (!zip.file('word/footer1.xml')) issues.push('DOCX_PAGE_NUMBERING_MISSING');
    }
  } catch {
    issues.push('DOCX_INVALID');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
