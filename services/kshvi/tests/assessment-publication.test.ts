import { expect, it } from 'vitest';
import { MetricService } from '../src/assessment/metric-service';
import { DebriefService } from '../src/assessment/debrief-service';
import { PublicationService } from '../src/assessment/publication-service';
import { deliveryDelayMetric, sent } from '../../../packages/kshvi/tests/fixtures/metric-fixture';
import { REQUIRED_DEBRIEF_SECTIONS } from '../../../packages/kshvi/src/assessment/debrief';

it('сервис метрик сохраняет доказательства и неизвестное', () => {
  const result = new MetricService().calculate(deliveryDelayMetric, [sent]);
  expect(result.value).toBe('UNKNOWN');
  expect(result.evidence[0].eventId).toBe('sent-1');
});

it('локальные PDF, DOCX и JSON соответствуют одной редакции и не содержат черновики', async () => {
  const debrief = new DebriefService().build({
    scope: 'GENERAL', instanceId: 'all', trainingQuestions: ['q'], audience: 'GENERAL', allowedSideIds: ['blue'],
    materials: REQUIRED_DEBRIEF_SECTIONS.map((section, index) => ({ id: `m${index}`, section, instanceId: 'hq', sideId: 'blue', trainingQuestions: ['q'], audience: ['GENERAL', 'commanders'], payload: { text: section, unit: 's', attribution: 'Локальный атлас', legend: 'Легенда' } })),
    referenceIntent: { instanceId: 'hq', sideId: 'blue', trainingQuestions: ['q'], audience: ['GENERAL', 'commanders'], content: { text: 'Замысел руководства' } }, deviations: [],
  });
  debrief.draftComments = ['Черновой служебный комментарий'];
  const published = new PublicationService().publish(debrief, { revision: 5, audience: ['commanders'], publishedBy: 'leader', publishedAt: '2026-11-21T12:00:00Z' });
  const service = new PublicationService();
  const json = await service.export(published, 'JSON');
  const pdf = await service.export(published, 'PDF');
  const docx = await service.export(published, 'DOCX');
  expect(JSON.parse(new TextDecoder().decode(json.data)).revision).toBe(5);
  expect(new TextDecoder().decode(pdf.data).startsWith('%PDF-')).toBe(true);
  expect(new TextDecoder().decode(docx.data).startsWith('PK')).toBe(true);
  for (const artifact of [json, pdf, docx]) {
    expect(artifact.revision).toBe(5);
    expect(artifact.pageNumbering).toBe(true);
    expect(artifact.attribution).toContain('Локальный атлас');
    expect(artifact.units).toContain('s');
    expect(JSON.stringify(artifact)).not.toContain('Черновой служебный комментарий');
  }
});
