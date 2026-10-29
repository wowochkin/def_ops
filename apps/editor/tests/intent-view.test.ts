import { describe, expect, it } from 'vitest';
import type { AgentTrace } from '@def-ops/sim';
import { intentAt, intentBadge } from '../src/intent-view';

const base = { scenario: 's', name: 'S', start: '1945-04-16T05:00', hours: 100, seed: 1, fields: [], divisions: [], hqs: [], frames: [], journal: [] };
const withIntent = (intent?: AgentTrace['intent']): AgentTrace => ({ ...base, ...(intent ? { intent } : {}) } as AgentTrace);
const t = withIntent([{ hq: 'su_3gta', changes: [
  { tick: 0, status: 'history', reason: null },
  { tick: 24, status: 'shifted', reason: 'сутки задержки у Зеелова' },
  { tick: 60, status: 'own', reason: 'ушла дальше 30 км' },
] }]);

describe('intentAt', () => {
  it('берёт последнее изменение не позже часа', () => {
    expect(intentAt(t, 'su_3gta', 0)).toEqual({ status: 'history', reason: null, since: 0 });
    expect(intentAt(t, 'su_3gta', 23)).toMatchObject({ status: 'history', since: 0 });
    expect(intentAt(t, 'su_3gta', 24)).toEqual({ status: 'shifted', reason: 'сутки задержки у Зеелова', since: 24 });
    expect(intentAt(t, 'su_3gta', 99)).toEqual({ status: 'own', reason: 'ушла дальше 30 км', since: 60 });
  });
  it('нет данных об intent — null (бейджа нет)', () => {
    expect(intentAt(withIntent(), 'su_3gta', 10)).toBeNull();
    expect(intentAt(t, 'su_other', 10)).toBeNull();
    expect(intentAt(t, 'su_3gta', -1)).toBeNull();
  });
});

describe('intentBadge', () => {
  it('тексты бейджа', () => {
    expect(intentBadge({ status: 'history', reason: null, since: 0 })).toBe('по истории');
    expect(intentBadge({ status: 'shifted', reason: null, since: 0 })).toBe('по истории со сдвигом');
    expect(intentBadge({ status: 'shifted', reason: 'задержка', since: 0 })).toBe('по истории со сдвигом: задержка');
    expect(intentBadge({ status: 'own', reason: 'ушла', since: 0 })).toBe('сам: ушла');
    expect(intentBadge({ status: 'own', reason: null, since: 0 })).toBe('сам');
    expect(intentBadge(null)).toBeNull();
  });
});
