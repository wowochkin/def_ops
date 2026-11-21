// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AppWorkspace } from '../src/AppMode';

it('открывает отдельный справочник знаков в современном режиме', async () => {
  localStorage.setItem('def_ops.app.mode', 'modern');
  render(<AppWorkspace historical={() => <div>История</div>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Условные знаки' }));
  expect(await screen.findByRole('heading', { name: 'Условные знаки' })).toBeTruthy();
  expect(localStorage.getItem('def_ops.modern.section')).toBe('symbols');
});
