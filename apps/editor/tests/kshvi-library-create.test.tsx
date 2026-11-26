// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LibraryView } from '../src/modern/kshvi/LibraryView';
import type { CreateExerciseInput } from '../src/modern/kshvi/kshvi-api';

afterEach(cleanup);

it('создаёт учение с двумя сторонами и необязательной страной', async () => {
  let created: CreateExerciseInput | undefined;
  render(<LibraryView items={[]} onCreate={async input => { created = input; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Создать учение' }));
  fireEvent.change(screen.getByLabelText('Название учения'), { target: { value: 'Учение со сторонами' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить на сервере' }));
  expect(created).toBeDefined();
  expect(created?.payload).toMatchObject({ preparation: {
    sides: [
      { name: 'Красные', color: 'red', country: null },
      { name: 'Синие', color: 'blue', country: null },
    ],
  } });
});
