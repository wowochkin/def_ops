import type { ReplayActor, ReplayPerspective } from './types';

export function assertPerspectiveAccess(actor: ReplayActor, perspective: ReplayPerspective): void {
  if (actor.role === 'TECH_ADMIN') throw new Error('403: Технический администратор не получает содержание реплея');
  if (perspective === 'TRUTH' && (actor.role !== 'LEADER' || !actor.authorities.includes('TRUTH_READ'))) {
    throw new Error('403: Истинное состояние реплея недоступно');
  }
}

export function tagReplayObjectSources(value: unknown, source: 'TRUTH' | 'PARTICIPANT'): unknown {
  if (Array.isArray(value)) return value.map(item => tagReplayObjectSources(item, source));
  if (!value || typeof value !== 'object') return value;
  return {
    ...Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'source')
      .map(([key, nested]) => [key, tagReplayObjectSources(nested, source)])),
    source,
  };
}

export function perspectiveLabel(perspective: ReplayPerspective): string {
  return perspective === 'TRUTH'
    ? 'Истинное состояние — постоянная метка'
    : 'Как видел участник — сохранённая серверная проекция';
}
