import { describe, expect, it } from 'vitest';
import type { IntelReport, UnitReport } from '@def-ops/sim';
import type { TurnView } from '../src/sim/game-protocol';
import { draftAssessment, draftEnemyIntent, draftField, draftIntent, draftReport, draftRisks, fieldPrompt, type DraftScope } from '../src/decision-drafts';

const u = (id: string, name: string, o: Partial<UnitReport> = {}): UnitReport => ({
  id, name, parent: 'a', echelon: 'corps', status: 'active', at: [14, 52], place: 'у Зелова', posture: 'наступает', task: 'наступать', target: 'Зелов',
  orderSource: null, personnel: 10000, tanks: 0, guns: 100, strength: 0.9, ammo: 0.8, fuel: 0.8, fatigue: 0.3, cutOff: false, movedKm: 5, combats: [], pending: [], ...o,
} as UnitReport);
const e = (id: string, name: string, o: Partial<IntelReport> = {}): IntelReport => ({ id, name, at: [14.1, 52], place: 'у Мюнхеберга', posture: 'обороняется', estimate: '', nearest: { name: '4 гв. ск', km: 6 }, fresh: false, ...o });
const v = { time: '1945-04-18T23:00', turnHours: 12, battles: [{ time: '', at: [14, 52], place: 'у Зелова', role: 'attack', own: [{ id: 'k4', name: '4 гв. ск' }], enemy: [], outcome: 'breakthrough', outcomeText: '' }] } as unknown as TurnView;
const scope = (o: Partial<DraftScope> = {}): DraftScope => ({ who: '8-я гвардейская армия', own: [u('k4', '4 гв. ск'), u('k28', '28 гв. ск', { posture: 'обороняется', place: 'у Мюнхеберга' })], intel: [e('x', 'CI армейский корпус'), e('y', 'LVI танковый корпус', { fresh: true, posture: 'на марше' })], plans: [], ...o });
const D = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' };

describe('черновики полей решения', () => {
  it('оценка: час, свои по положению, бои своих, противник, снабжение', () => {
    const t = draftAssessment(v, scope());
    expect(t).toContain('К 23:00 18.04.');
    expect(t).toContain('8-я гвардейская армия: в строю 2, укомплектованность 90 %; наступают — 4 гв. ск (у Зелова); обороняются — 28 гв. ск (у Мюнхеберга).');
    expect(t).toContain('За ход: прорыв у Зелова.');
    expect(t).toContain('перед фронтом 2 соединений, из них новых за сутки — 1; ближайшие — CI армейский корпус (у Мюнхеберга, в 6 км от наших войск)');
    expect(t).toContain('Снабжение: перебоев по докладам нет.');
  });
  it('замысел противника — по положению обнаруженных соединений', () => {
    const t = draftEnemyIntent(scope());
    expect(t).toMatch(/^Обороняется у Мюнхеберга \(1 соед\.\); подтягивает силы: LVI танковый корпус\./);
    expect(t).toContain('Вероятно, намерен удерживать занимаемые рубежи');
    expect(draftEnemyIntent(scope({ intel: [] }))).toContain('не вскрыт');
  });
  it('решение — из документов хода; нет их — продолжать задачи', () => {
    expect(draftIntent(v, scope({ plans: ['4 гв. ск — наступать: Зелов'] }))).toBe('На 19.04: 4 гв. ск — наступать: Зелов.');
    expect(draftIntent(v, scope())).toBe('На 19.04 — продолжать выполнение задач: 4 гв. ск, 28 гв. ск — наступать: Зелов.');
  });
  it('риски — отрезанные, обескровленные, новые силы противника рядом', () => {
    const t = draftRisks(scope({ own: [u('k4', '4 гв. ск', { cutOff: true, strength: 0.4 })] }));
    expect(t).toContain('4 гв. ск — без подвоза');
    expect(t).toContain('Обескровлены 4 гв. ск (40 %)');
    expect(t).toContain('Новые силы противника рядом: LVI танковый корпус у Мюнхеберга');
    expect(draftRisks(scope({ intel: [] }))).toContain('Существенных угроз по докладам нет');
  });
  it('донесение — положение, итоги и решение на следующий ход', () => {
    const t = draftReport(v, scope(), { ...D, intent: 'Прорвать третью полосу' });
    expect(t).toContain('К 23:00 18.04: в строю 2');
    expect(t).toContain('Решение на 19.04: Прорвать третью полосу.');
    expect(draftField('report', v, scope(), D)).not.toContain('Решение на');
    expect(draftReport(v, scope(), { ...D, intent: 'На 19.04 — продолжать выполнение задач' })).toContain('Решение на 19.04: Продолжать выполнение задач.');
    expect(draftAssessment(v, scope({ own: [u('k4', '4 гв. ск', { place: 'у Платков (Platkow)' })] }))).toContain('4 гв. ск (у Платков)');
  });
  it('вопрос советнику — одно поле, за штаб пункта, с уже написанным', () => {
    const q = fieldPrompt('risks', scope({ plans: ['4 гв. ск — наступать: Зелов'] }), { ...D, intent: 'Прорвать полосу' });
    expect(q).toContain('за штаб «8-я гвардейская армия» риски решения');
    expect(q).toContain('решение: Прорвать полосу');
    expect(q).toContain('Документы на этот ход: 4 гв. ск — наступать: Зелов.');
  });
});
