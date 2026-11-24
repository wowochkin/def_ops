import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('browser-точки документов и связи не подтягивают Node и файловые экспортёры', async () => {
  const documentsEntry = new URL('../src/documents/browser.ts', import.meta.url);
  const communicationsEntry = new URL('../src/communications/browser.ts', import.meta.url);
  const documentsSource = readFileSync(documentsEntry, 'utf8');
  const communicationsSource = readFileSync(communicationsEntry, 'utf8');
  for (const source of [documentsSource, communicationsSource]) {
    expect(source).not.toContain('node:');
    expect(source).not.toContain('export-pdf');
    expect(source).not.toContain('export-docx');
    expect(source).not.toContain('export-set');
  }
  const documents = await import('../src/documents/browser');
  const communications = await import('../src/communications/browser');
  expect(documents.transitionDocument).toBeTypeOf('function');
  expect(documents.issueCascade).toBeTypeOf('function');
  expect(communications.routeMessage).toBeTypeOf('function');
  expect(communications.checkReportDeadline).toBeTypeOf('function');
});
