import { publishDebrief, type DebriefPackage, type DebriefPublicationInput, type PublishedDebrief } from '../../../../packages/kshvi/src/assessment/debrief';

export type LocalExportFormat = 'JSON' | 'PDF' | 'DOCX';
export type LocalDebriefExport = {
  format: LocalExportFormat;
  mimeType: string;
  schemaVersion: 1;
  revision: number;
  audience: readonly string[];
  attribution: readonly string[];
  units: readonly string[];
  legend: readonly string[];
  pageNumbering: true;
  data: Uint8Array;
};

function stringsForKey(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(item => stringsForKey(item, key));
  return Object.entries(value as Record<string, unknown>).flatMap(([entryKey, entryValue]) => {
    if (entryKey === key && typeof entryValue === 'string') return [entryValue];
    return stringsForKey(entryValue, key);
  });
}

function publicationLines(published: PublishedDebrief, attribution: readonly string[], units: readonly string[], legend: readonly string[]): string[] {
  return [
    'Материалы разбора КШВИ', `Редакция ${published.revision}`, `Аудитория: ${published.audience.join(', ')}`,
    `Опубликовал: ${published.publishedBy}`, `Время: ${published.publishedAt}`,
    `Атрибуция: ${attribution.join('; ') || 'нет'}`, `Единицы: ${units.join('; ') || 'нет'}`,
    `Легенда: ${legend.join('; ') || 'нет'}`, 'Эталон: замысел руководства, не единственно правильное решение',
    ...published.materials.map(material => `${material.section}: ${JSON.stringify(material.payload)}`),
  ];
}

type PdfStream = {
  on(event: 'data', handler: (chunk: Buffer) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  end(): void;
};
type PdfPrinterInstance = { createPdfKitDocument(definition: Record<string, unknown>): PdfStream };
type PdfPrinterConstructor = new (fonts: Record<string, { normal: Buffer; bold: Buffer; italics: Buffer; bolditalics: Buffer }>) => PdfPrinterInstance;

async function makePdf(lines: readonly string[], revision: number): Promise<Uint8Array> {
  const printerModule = 'pdfmake';
  const fontsModule = 'pdfmake/build/vfs_fonts.js';
  const [{ default: PdfPrinter }, { default: vfs }] = await Promise.all([
    import(printerModule) as unknown as Promise<{ default: PdfPrinterConstructor }>,
    import(fontsModule) as unknown as Promise<{ default: Record<string, string> }>,
  ]);
  const regular = Buffer.from(vfs['Roboto-Regular.ttf'], 'base64');
  const printer = new PdfPrinter({ Roboto: { normal: regular, bold: regular, italics: regular, bolditalics: regular } });
  const document = printer.createPdfKitDocument({
    pageSize: 'A4', pageMargins: [45, 50, 45, 50],
    info: { title: `Разбор КШВИ, редакция ${revision}`, author: 'Локальный экспорт КШВИ' },
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    content: lines.map(line => ({ text: line, margin: [0, 0, 0, 5] })),
    footer: (page: number) => ({ text: String(page), alignment: 'right', margin: [45, 0], fontSize: 9 }),
  });
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function xml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function zip(entries: readonly { name: string; text: string }[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.text, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
function makeDocx(lines: readonly string[], revision: number): Uint8Array {
  const paragraphs = lines.map(line => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraphs}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/></w:sectPr></w:body></w:document>`;
  return zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/document.xml', text: document },
    { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>' },
    { name: 'word/footer1.xml', text: '<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>' },
    { name: 'docProps/core.xml', text: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Разбор КШВИ, редакция ${revision}</dc:title></cp:coreProperties>` },
  ]);
}

export class PublicationService {
  publish(debrief: DebriefPackage, input: DebriefPublicationInput): PublishedDebrief {
    return publishDebrief(debrief, input);
  }

  async export(published: PublishedDebrief, format: LocalExportFormat): Promise<LocalDebriefExport> {
    const attribution = [...new Set(stringsForKey(published.materials, 'attribution'))];
    const units = [...new Set(stringsForKey(published.materials, 'unit'))];
    const legend = [...new Set(stringsForKey(published.materials, 'legend'))];
    const lines = publicationLines(published, attribution, units, legend);
    const common = {
      format, schemaVersion: 1 as const, revision: published.revision, audience: [...published.audience],
      attribution, units, legend, pageNumbering: true as const,
    };
    if (format === 'JSON') return { ...common, mimeType: 'application/json', data: Buffer.from(JSON.stringify({ ...common, data: undefined, publication: published }, null, 2)) };
    if (format === 'PDF') return { ...common, mimeType: 'application/pdf', data: await makePdf(lines, published.revision) };
    return { ...common, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: makeDocx(lines, published.revision) };
  }
}
