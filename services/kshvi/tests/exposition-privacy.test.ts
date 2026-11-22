import { describe, expect, it } from 'vitest';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import { controlExposition, startAutonomousShow } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive, testFullSimulation } from '../../../packages/kshvi/tests/fixtures/exposition';
import { createProjectorProfile, projectExpositionForAudience } from '../src/exposition/exposition-projection';
import { applyPresenterCommand } from '../src/exposition/exposition-service';

function setup() {
  const session = startAutonomousShow({
    sourceArchive: officialArchive(), program: expositionProgram(), seed: 42,
    sessionId: 'private-show', branchId: 'private-exposition-branch', calculate: testFullSimulation,
  });
  const policy = createAudiencePolicy({
    id: 'audience-policy-1', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
    showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'],
    publicExplanationIds: ['explanation-public'], publicDecisionIds: [],
  });
  const projector = createProjectorProfile({
    id: 'projector-1', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'],
  });
  return { session, policy, projector };
}

describe('серверная аудиторная проекция', () => {
  it('отдаёт общую карту и публичные пояснения без служебных полей на любом уровне', () => {
    const { session, policy, projector } = setup();
    const audience = projectExpositionForAudience({ session, policy, projector });
    expect(audience.purpose).toBe('EXPOSITION');
    expect(audience.label).toBe('Экспозиция');
    expect(audience.map).toEqual({
      weather: { summary: 'Пасмурно, видимость 8 км' },
      terrain: { summary: 'Лес и рубеж высоты' },
      logistics: { summary: 'Склад и маршрут подвоза' },
      modernSymbols: [{ id: 'symbol-1', label: 'Батальон', side: 'BLUE' }],
    });
    expect(audience.program.explanations).toEqual([{ id: 'explanation-public', atMs: 1_000, text: 'Пояснение для аудитории', audience: true }]);
    expect(audience.planFact).toHaveLength(1);
    const serialized = JSON.stringify(audience);
    for (const forbidden of ['Скрытый', 'Служебный', 'Закрытое', 'seed', 'journal', 'officialAssessments', 'sourceArchive', 'hiddenRationale', 'serviceIntent']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('применяет whitelist схемы вместо сохранения неизвестных вложенных полей', () => {
    const source = officialArchive();
    const map: Record<string, unknown> = { ...source.map };
    const archive = { ...source, map };
    map.weather = {
      summary: 'Публичная погода',
      nested: { serviceIntent: 'Вложенный замысел', safe: 'Видимость 8 км' },
      frames: [{ hiddenRationale: 'Вложенное обоснование', summary: 'Без осадков' }],
      futureInput: 'Будущая вводная', commanderNotes: 'Заметки командующего', hidden: true,
    };
    map.terrain = {
      summary: 'Публичная местность', trueForceId: 'force-truth',
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {
        name: 'Рубеж', kind: 'ridge', officialAssessments: [4], trueForceId: 'force-truth', futureInput: 'Секрет', commanderNotes: 'Секрет', hidden: true,
      }, geometry: null }] },
    };
    const session = startAutonomousShow({
      sourceArchive: archive, program: expositionProgram(), seed: 42,
      sessionId: 'deep-private-show', branchId: 'deep-private-branch', calculate: testFullSimulation,
    });
    const policy = createAudiencePolicy({
      id: 'deep-policy', allowedLayers: ['weather', 'terrain'], showPlanFact: false,
      showExplanations: false, publicCaptionIds: [], publicDecisionIds: [],
    });
    const projector = createProjectorProfile({ id: 'deep-projector', allowedLayers: ['weather', 'terrain'] });
    const audience = projectExpositionForAudience({ session, policy, projector });
    expect(audience.map.weather).toEqual({ summary: 'Публичная погода' });
    expect(audience.map.terrain).toEqual({
      summary: 'Публичная местность',
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Рубеж', kind: 'ridge' }, geometry: null }] },
    });
    const serialized = JSON.stringify(audience);
    for (const forbidden of ['serviceIntent', 'hiddenRationale', 'officialAssessments', 'trueForceId', 'futureInput', 'commanderNotes', 'hidden', 'Вложенный замысел']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('не добавляет скрытые данные в поток после команд ведущего', () => {
    const { session, policy, projector } = setup();
    const accelerated = applyPresenterCommand({
      session, command: { type: 'SET_TEMPO', tempo: 4 }, policy, projector,
    });
    expect(accelerated.session.playback.tempo).toBe(4);
    expect(accelerated.audience.playback.tempo).toBe(4);
    expect(accelerated.audience).toEqual(projectExpositionForAudience({ session: accelerated.session, policy, projector }));
    expect(JSON.stringify(accelerated.audience)).not.toContain('Закрытое обоснование');

    const withDecision = controlExposition(accelerated.session, { type: 'SEEK', atMs: 1_000 });
    const decisionStream = projectExpositionForAudience({ session: withDecision, policy, projector, presenterDecisionId: 'decision-1' });
    expect(decisionStream.decision).toBeNull();
    expect(JSON.stringify(decisionStream)).not.toContain('decision-1');
  });

  it('использует отдельный проекторный профиль и не выдаёт ему привилегии ведущего', () => {
    const { session, policy } = setup();
    expect(() => createProjectorProfile({
      id: 'bad-projector', allowedLayers: ['weather'], authorities: ['TRUTH_READ'],
    })).toThrow('привилегии');
    const limited = createProjectorProfile({ id: 'limited-projector', allowedLayers: ['weather'] });
    const audience = projectExpositionForAudience({ session, policy, projector: limited });
    expect(audience.program.layers).toEqual(['weather']);
    expect(audience.map).toEqual({ weather: { summary: 'Пасмурно, видимость 8 км' } });
    expect(audience.projectorProfile).toEqual({ id: 'limited-projector', kind: 'AUDIENCE_PROJECTOR' });
  });
});
