import type { ReplayActor, ReplayPerspective } from './types';

export function assertPerspectiveAccess(actor: ReplayActor, perspective: ReplayPerspective): void {
  if (actor.role === 'TECH_ADMIN') throw new Error('403: Технический администратор не получает содержание реплея');
  if (perspective === 'TRUTH' && (actor.role !== 'LEADER' || !actor.authorities.includes('TRUTH_READ'))) {
    throw new Error('403: Истинное состояние реплея недоступно');
  }
}

export function perspectiveLabel(perspective: ReplayPerspective): string {
  return perspective === 'TRUTH'
    ? 'Истинное состояние — постоянная метка'
    : 'Как видел участник — сохранённая серверная проекция';
}
