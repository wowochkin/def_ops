import { expect, it } from 'vitest';
import { completeComponents, makeArchiveBundle } from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { serializeArchive } from '../../../services/kshvi/src/archive/archive-exporter';
import { verifyStandaloneArchive } from '../src/integrity';

it('R07: standalone viewer перед показом проверяет манифест, SHA-256, ссылки, путь журнала и LIMITED_RESEARCH', () => {
  const valid = JSON.parse(serializeArchive(makeArchiveBundle()));
  expect(verifyStandaloneArchive(valid)).toMatchObject({ mode: 'AUTONOMOUS', autonomous: true, corrupted: [], brokenReferences: [] });

  const tampered = structuredClone(valid);
  tampered.files['replay/archive.json'] = Buffer.from('{"events":[],"snapshots":[]}').toString('base64');
  expect(verifyStandaloneArchive(tampered)).toMatchObject({ mode: 'REJECTED', autonomous: false });
  expect(verifyStandaloneArchive(tampered).corrupted).toContain('replay/archive.json');

  const alternateComponents = completeComponents();
  alternateComponents['replay.archive'] = { ...alternateComponents['replay.archive'], path: 'alternate.json' };
  const alternate = JSON.parse(serializeArchive(makeArchiveBundle({ components: alternateComponents })));
  expect(verifyStandaloneArchive(alternate).autonomous).toBe(true);

  const limitedComponents = completeComponents();
  delete limitedComponents['environment.weather'];
  const limited = verifyStandaloneArchive(JSON.parse(serializeArchive(makeArchiveBundle({ components: limitedComponents }))));
  expect(limited).toMatchObject({ mode: 'LIMITED_RESEARCH', autonomous: false });
  expect(limited.missing).toContain('environment.weather');
});
