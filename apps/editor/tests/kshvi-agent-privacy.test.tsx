// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AgentDecisionTraceView } from '../src/modern/kshvi/conduct/AgentDecisionTraceView';

it('не показывает чужую проекцию и скрытый эталон в DOM', () => {
  render(<AgentDecisionTraceView selected="safe" alternatives={['other']} unknown={[]} hiddenProjection={{ secretIntent: 'Скрытый замысел', trueForceId: 'secret-force' }} />);
  expect(document.body.textContent).not.toContain('Скрытый замысел');
  expect(document.body.textContent).not.toContain('secret-force');
  expect(screen.getByText('Проекция доступна только по назначению; скрытые поля не выводятся')).toBeTruthy();
});
