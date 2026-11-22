import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { REQUIRED_DEBRIEF_SECTIONS } from '../../../packages/kshvi/src/assessment/debrief';
import { DebriefService } from '../src/assessment/debrief-service';
import { PublicationService } from '../src/assessment/publication-service';

it('PDF и DOCX открываются локально и сохраняют русский текст, редакцию, единицы и атрибуцию', async () => {
  const service = new PublicationService();
  const debrief = new DebriefService().build({
    scope: 'GENERAL', instanceId: 'all', trainingQuestions: ['q'], audience: 'GENERAL', allowedSideIds: ['blue'],
    materials: REQUIRED_DEBRIEF_SECTIONS.map((section, index) => ({
      id: `m${index}`, section, instanceId: 'hq', sideId: 'blue', trainingQuestions: ['q'], audience: ['GENERAL', 'commanders'],
      payload: { text: 'Учебный материал', unit: 's', attribution: 'Локальный атлас', legend: 'Легенда знаков' },
    })),
    referenceIntent: { text: 'Замысел руководства' }, deviations: [],
  });
  const published = service.publish(debrief, { revision: 7, audience: ['commanders'], publishedBy: 'leader', publishedAt: '2026-11-21T12:00:00Z' });
  const pdf = await service.export(published, 'PDF');
  const document = await getDocument({ data: new Uint8Array(pdf.data), verbosity: 0 }).promise;
  const page = await document.getPage(1);
  const text = (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/gu, ' ');
  expect(text).toContain('Редакция 7');
  expect(text).toContain('Локальный атлас');
  expect(text).toContain('Единицы: s');
  await document.destroy();

  const docx = await service.export(published, 'DOCX');
  const extracted = await mammoth.extractRawText({ buffer: Buffer.from(docx.data) });
  expect(extracted.value).toContain('Редакция 7');
  expect(extracted.value).toContain('Локальный атлас');
  expect(extracted.value).toContain('Единицы: s');
  expect(extracted.value).toContain('Легенда знаков');
});
