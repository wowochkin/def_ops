import { describe, expect, it } from 'vitest';
// @ts-expect-error build script
import { classifyTestReport } from '../../../scripts/portable-test-report.mjs';

const failed = (front: string, message = `AssertionError: expected ${front === 'su_1uf' ? '1.9343714350901209 to be less than 1.7999999999999998' : '1.5 to be less than 1.5'}\n at apps/editor/tests/expo-turns.test.ts:98:34`) => ({
  status: 'failed', fullName: `переломы с настоящим ядром ${front}: history, every card, delay`, failureMessages: [message],
});
const report = (assertions: object[]) => ({ numTotalTests: 3, numFailedTests: assertions.length,
  numRuntimeErrorTestSuites: 0, testResults: [{ name: '/repo/apps/editor/tests/expo-turns.test.ts', assertionResults: [...assertions, ...Array.from({ length: 3 - assertions.length }, () => ({ status: 'passed' }))] }] });
describe('приёмочная сборка с известным конфликтом оценки', () => {
  it('по умолчанию останавливается даже на известных падениях', () => {
    expect(classifyTestReport(report([failed('su_1bf'), failed('su_1uf')])).ok).toBe(false);
  });
  it('явный режим оставляет известные падения в отчёте, не называет тесты успешными', () => {
    const result = classifyTestReport(report([failed('su_1bf'), failed('su_1uf')]), true);
    expect(result).toMatchObject({ ok: true, status: 'diagnostic-candidate', failed: 2 });
  });
  it.each(['TimeoutError: test timed out', 'AssertionError: expected 3 to equal 2'])('останавливается при иной причине: %s', message => {
    expect(classifyTestReport(report([failed('su_1bf', message), failed('su_1uf')]), true).ok).toBe(false);
  });
  it('не разрешает неожиданный тест или неполный отчёт', () => {
    expect(classifyTestReport(report([failed('other')]), true).ok).toBe(false);
    expect(classifyTestReport({}, true).ok).toBe(false);
    expect(classifyTestReport({ ...report([]), numRuntimeErrorTestSuites: 1 }, true).ok).toBe(false);
  });
  it('не разрешает скрытую потерю результатов и принимает успешный полный отчёт', () => {
    expect(classifyTestReport({ ...report([]), numFailedTests: 2 }, true).ok).toBe(false);
    expect(classifyTestReport(report([]))).toMatchObject({ ok: true, status: 'tests-passed', failed: 0 });
  });
  it('не пропускает ошибку производительности под именем известного теста', () => {
    expect(classifyTestReport(report([failed('su_1bf', 'AssertionError: expected 20000 to be less than 15000'), failed('su_1uf')]), true).ok).toBe(false);
  });
  it('не пропускает ошибку загрузки другого тестового файла', () => {
    const r = report([failed('su_1bf'), failed('su_1uf')]);
    const result = { ...r, testResults: [...r.testResults, { status: 'failed', name: '/repo/other.test.ts', assertionResults: [], message: 'Error: setup failure' }] };
    expect(classifyTestReport(result, true).ok).toBe(false);
  });
  it('не пропускает необработанную ошибку из журнала Vitest', () => {
    expect(classifyTestReport(report([failed('su_1bf'), failed('su_1uf')]), true, 'Unhandled Errors\nError: boom').ok).toBe(false);
  });
});
