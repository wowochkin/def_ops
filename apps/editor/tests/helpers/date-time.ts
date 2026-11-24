import { fireEvent, screen } from '@testing-library/react';

export function chooseDateTime(label: string | RegExp, value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) throw new Error(`Некорректная тестовая дата: ${value}`);
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.change(screen.getByLabelText('Год'), { target: { value: match[1] } });
  fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: String(Number(match[2]) - 1) } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${Number(match[3])} \\D+ ${match[1]}$`) }));
  if (match[4] !== undefined) {
    fireEvent.change(screen.getByLabelText('Время'), { target: { value: `${match[4]}:${match[5]}` } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
}
