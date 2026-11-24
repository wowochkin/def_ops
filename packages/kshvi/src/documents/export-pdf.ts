import type { DocumentExportModel } from './export-model';

type PdfDocument = Readonly<{
  getBuffer: (callback: (bytes: Uint8Array) => void) => void;
}>;

type PdfEngine = {
  vfs: Record<string, string>;
  createPdf: (definition: unknown) => PdfDocument;
};

/** Локальный PDF: pdfmake использует собственный VFS шрифтов, сетевые ресурсы не нужны. */
export async function exportDocumentPdf(model: DocumentExportModel): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const engine = pdfMake as unknown as PdfEngine;
  const fontVfs = vfs as unknown as { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> };
  engine.vfs = fontVfs.pdfMake?.vfs ?? fontVfs.vfs ?? (vfs as unknown as Record<string, string>);
  const document = engine.createPdf({
    pageSize: 'A4',
    pageMargins: [42, 48, 42, 52],
    info: {
      title: model.document.title,
      author: model.exercise.title,
      subject: JSON.stringify(model.source),
    },
    content: model.contentBlocks.map((block, index) => ({
      text: block.text,
      bold: block.kind === 'TITLE',
      fontSize: block.kind === 'TITLE' ? 17 : block.kind === 'SOURCE' ? 8 : 10,
      margin: [0, index === 0 ? 0 : 6, 0, block.kind === 'BODY' ? 10 : 3],
    })),
    footer: (page: number, count: number) => ({ text: `Страница ${page} из ${count}`, alignment: 'center', fontSize: 8, margin: [0, 12, 0, 0] }),
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
  });
  return new Promise<Uint8Array>(resolve => {
    document.getBuffer(bytes => resolve(new Uint8Array(bytes)));
  });
}
