// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Scenario } from '../src/modern/replay/session';
import { ScenarioForm } from '../src/modern/replay/ScenarioForm';

vi.mock('../src/modern/replay/ReplayAreaMap', () => ({
  ReplayAreaMap: ({ name, bounds }: { name: string; bounds: number[] }) => <div role="img" aria-label={'Карта · ' + name} data-bounds={bounds.join(',')} />,
}));
vi.mock('../src/modern/CoordinatePicker', () => ({
  CoordinatePicker: ({ offline, onChange, onClose, onConfirm }: {
    offline?: boolean; onChange: (value: number[]) => void; onClose: () => void; onConfirm: () => void;
  }) => <section role="dialog" aria-label={offline ? 'Автономная карта' : 'Карта'}>
    <button onClick={() => onChange([1, 49, 4, 51])}>Выделить</button>
    <button onClick={onClose}>Отмена</button><button onClick={onConfirm}>Готово</button>
  </section>,
}));
vi.mock('../src/modern/environment-api', () => ({
  environmentApi: async (path: string) => path === '/atlas'
    ? [{ id: 'test-map', bounds: [2, 48, 3, 49] }]
    : [],
}));
vi.mock('../../../packages/knowledge/src/modern', async importOriginal => {
  const original = await importOriginal<typeof import('../../../packages/knowledge/src/modern')>();
  const { modernCorpus } = original;
  const sample = modernCorpus.representatives[0];
  const citation = { source: modernCorpus.countries[0].sources[0], section: 'Каталог', designation: 'Образец', modelUrl: null };
  const listed = [{ ...citation, catalogueStatus: 'listed' as const }];
  const prospective = [{ ...citation, catalogueStatus: 'prospective' as const }];
  return { modernCorpus: { ...modernCorpus, objectClasses: [{ id: 'camera', title: 'Камера' }],
    representatives: [
      { ...sample, id: 'catalogue', objectClass: 'camera', title: 'Камера из перечня', countryContext: 'DE', operatorCountries: [], inventoryReferences: listed },
      { ...sample, id: 'operator', objectClass: 'camera', title: 'Камера оператора', countryContext: 'FR', operatorCountries: ['DE'], inventoryReferences: [] },
      { ...sample, id: 'origin', objectClass: 'camera', title: 'Камера разработчика', countryContext: 'FR', originCountries: ['DE'], operatorCountries: [], inventoryReferences: [] },
      { ...sample, id: 'future', objectClass: 'camera', title: 'Перспективная камера', countryContext: 'DE', operatorCountries: [], inventoryReferences: prospective },
    ],
  } };
});

afterEach(() => { cleanup(); localStorage.clear(); });

it('связывает регион, отдельные комплекты чтения и авторское условие события с итоговым сценарием', async () => {
  localStorage.setItem('defops.atlas.regionNames', JSON.stringify({ '2.000000,48.000000,3.000000,49.000000': 'Область сборника' }));
  const onCreate = vi.fn<(scenario: Scenario) => void>();
  render(<ScenarioForm onCreate={onCreate} />);
  const option = await screen.findByRole('option', { name: 'Область сборника' });
  fireEvent.change(screen.getByLabelText('Область атласа'), { target: { value: (option as HTMLOptionElement).value } });
  fireEvent.change(screen.getByLabelText('Начало (UTC)'), { target: { value: '2030-05-01T06:00' } });
  fireEvent.change(screen.getByLabelText('Окончание (UTC)'), { target: { value: '2030-05-02T18:00' } });
  fireEvent.change(screen.getByLabelText('Длительность периода'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  const a = within(screen.getByRole('group', { name: 'Участник А' }));
  const b = within(screen.getByRole('group', { name: 'Участник Б' }));
  fireEvent.change(a.getByLabelText('Страна участника А'), { target: { value: 'DE' } });
  fireEvent.change(b.getByLabelText('Страна участника Б'), { target: { value: 'FR' } });
  expect(a.getAllByRole('button', { name: /^Добавить «/ })).toHaveLength(5);
  const firstName = a.getAllByRole('button', { name: /^Добавить «/ })[0].getAttribute('aria-label')!;
  fireEvent.click(a.getByRole('button', { name: 'Далее' }));
  expect(a.queryByRole('button', { name: firstName })).toBeNull();
  fireEvent.change(a.getByLabelText('Категория'), { target: { value: 'Камера' } });
  expect(a.getAllByRole('button', { name: /^Добавить «/ })).toHaveLength(2);
  expect(a.getByText(/Оператор для этой страны не подтверждён/)).toBeTruthy();
  expect(b.queryByRole('option', { name: 'Камера' })).toBeNull();
  fireEvent.click(a.getByRole('button', { name: 'Добавить «Камера из перечня»' }));
  fireEvent.click(a.getByRole('checkbox', { name: 'Обязательная карточка «Камера из перечня»' }));
  fireEvent.change(a.getByRole('searchbox'), { target: { value: 'оператора' } });
  fireEvent.click(a.getByRole('button', { name: 'Добавить «Камера оператора»' }));
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Добавить событие' }));
  fireEvent.change(screen.getByLabelText('Текст события'), { target: { value: 'Уточнение принято' } });
  fireEvent.change(screen.getByLabelText('Время события (UTC)'), { target: { value: '2030-05-01T11:30' } });
  fireEvent.change(screen.getByLabelText('Решение участника А'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByLabelText(/Время оповещения участника А/), { target: { value: '2030-05-01T11:45' } });
  fireEvent.change(screen.getByLabelText('Кому показать'), { target: { value: 'b' } });
  fireEvent.change(screen.getByLabelText(/Время оповещения участника Б/), { target: { value: '2030-05-01T12:00' } });
  fireEvent.click(screen.getByLabelText('Завершить сеанс при этом событии'));
  fireEvent.click(screen.getByRole('button', { name: 'Начать сеанс' }));
  expect(onCreate).toHaveBeenCalledOnce();
  const scenario = onCreate.mock.calls[0][0];
  expect(scenario).toMatchObject({ area: 'Область сборника', areaBounds: [2, 48, 3, 49], periodHours: 12,
    start: '2030-05-01T06:00:00.000Z', end: '2030-05-02T18:00:00.000Z', disclosure: 'mutual' });
  expect(scenario.sides.a.materials).toMatchObject([
    { label: 'Камера из перечня', required: true, category: 'Камера' },
    { label: 'Камера оператора', required: false, category: 'Камера' },
  ]);
  expect(scenario.sides.a.materials?.[0].sourceUrl).toMatch(/^https:\/\//);
  expect(scenario.sides.b).toMatchObject({ country: 'Франция', materials: [] });
  expect(scenario.events[0].reportAt).toEqual({ b: '2030-05-01T12:00:00.000Z' });
  expect(scenario.events).toMatchObject([{ at: '2030-05-01T11:30:00.000Z', text: 'Уточнение принято', audience: 'b', when: { a: 'c1' }, ends: true }]);
});

it('возвращает к пропущенному шагу и исключает чужие материалы при смене страны', async () => {
  const onCreate = vi.fn<(scenario: Scenario) => void>();
  render(<ScenarioForm onCreate={onCreate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Решения и события' }));
  fireEvent.click(screen.getByRole('button', { name: 'Начать сеанс' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Выберите страну/);
  const a = within(screen.getByRole('group', { name: 'Участник А' }));
  fireEvent.change(a.getByLabelText('Страна участника А'), { target: { value: 'DE' } });
  fireEvent.change(a.getByRole('searchbox'), { target: { value: 'Камера из перечня' } });
  fireEvent.click(a.getByRole('button', { name: 'Добавить «Камера из перечня»' }));
  fireEvent.change(a.getByLabelText('Страна участника А'), { target: { value: 'SE' } });
  expect(a.queryByRole('checkbox', { name: /Обязательная карточка/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Страна участника Б'), { target: { value: 'FI' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сценарий' }));
  fireEvent.click(screen.getByRole('button', { name: 'Решения и события' }));
  fireEvent.click(screen.getByRole('button', { name: 'Начать сеанс' }));
  expect(onCreate.mock.calls[0][0].sides.a).toMatchObject({ country: 'Швеция', materials: [] });
});

it('сохраняет личный выбор из нескольких стран с отдельными комплектами и допускает общую страну у двух участников', async () => {
  const onCreate = vi.fn<(scenario: Scenario) => void>();
  render(<ScenarioForm onCreate={onCreate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Участники' }));
  const a = within(screen.getByRole('group', { name: 'Участник А' }));
  const b = within(screen.getByRole('group', { name: 'Участник Б' }));
  fireEvent.change(a.getByLabelText('Страна участника А'), { target: { value: 'FR' } });
  fireEvent.change(b.getByLabelText('Страна участника Б'), { target: { value: 'FR' } });
  const addCountry = a.getByLabelText('Добавить страну на выбор участнику А');
  fireEvent.change(addCountry, { target: { value: 'DE' } });
  fireEvent.change(addCountry, { target: { value: 'FI' } });
  expect(within(addCountry).queryByRole('option', { name: 'Германия' })).toBeNull();
  expect(within(addCountry).queryByRole('option', { name: 'Франция' })).toBeNull();
  const germanSummary = a.getByText('Страна на выбор · Германия');
  fireEvent.click(germanSummary);
  const german = within(germanSummary.closest('details')!);
  fireEvent.change(german.getByRole('searchbox'), { target: { value: 'Камера из перечня' } });
  fireEvent.click(german.getByRole('button', { name: 'Добавить «Камера из перечня»' }));
  fireEvent.click(german.getByRole('checkbox', { name: 'Обязательная карточка «Камера из перечня»' }));
  fireEvent.click(screen.getByRole('button', { name: 'Решения и события' }));
  fireEvent.click(screen.getByRole('button', { name: 'Начать сеанс' }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreate.mock.calls[0][0].sides).toMatchObject({
    a: { country: 'Франция', materials: [], alternatives: [
      { country: 'Германия', materials: [{ label: 'Камера из перечня', required: true }] },
      { country: 'Финляндия', materials: [] },
    ] },
    b: { country: 'Франция', materials: [], alternatives: [] },
  });
});

it('применяет произвольную рамку только после подтверждения и показывает её в восстановленном черновике', async () => {
  const create = vi.fn();
  const first = render(<ScenarioForm onCreate={create} />);
  await screen.findByRole('option', { name: /текущая область/ });
  const initialBounds = screen.getByRole('img').getAttribute('data-bounds');
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать рамку на карте' }));
  expect(screen.getByRole('dialog', { name: 'Автономная карта' }).closest('form')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Выделить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.getByRole('img').getAttribute('data-bounds')).toBe(initialBounds);
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать рамку на карте' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выделить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
  expect(screen.getByRole('img').getAttribute('data-bounds')).toBe('1,49,4,51');
  fireEvent.change(screen.getByLabelText('Название сценария'), { target: { value: 'Мой черновик' } });
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  fireEvent.change(screen.getByLabelText('Страна участника А'), { target: { value: 'FR' } });
  first.unmount();
  render(<ScenarioForm onCreate={create} />);
  expect(screen.getByText('Авторский черновик восстановлен на этом компьютере.')).toBeTruthy();
  expect((screen.getByLabelText('Страна участника А') as HTMLSelectElement).value).toBe('FR');
  fireEvent.click(screen.getByRole('button', { name: 'Сценарий' }));
  expect((screen.getByLabelText('Название сценария') as HTMLInputElement).value).toBe('Мой черновик');
  expect(screen.getByRole('img').getAttribute('data-bounds')).toBe('1,49,4,51');
  expect(screen.getByRole('option', { name: /выбранная рамка/ })).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
});

it('блокирует повторное сохранение, оставляет черновик при ошибке и очищает его после успешной записи', async () => {
  let fail!: (cause: Error) => void;
  const create = vi.fn<(scenario: Scenario) => Promise<void>>()
    .mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }))
    .mockResolvedValueOnce(undefined);
  const onSavingChange = vi.fn();
  const { unmount } = render(<ScenarioForm onCreate={create} onSavingChange={onSavingChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Участники' }));
  fireEvent.change(screen.getByLabelText('Страна участника А'), { target: { value: 'FR' } });
  fireEvent.change(screen.getByLabelText('Страна участника Б'), { target: { value: 'FI' } });
  fireEvent.click(screen.getByRole('button', { name: 'Решения и события' }));
  const form = screen.getByRole('form');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(create).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: 'Сохранение…' }) as HTMLButtonElement).disabled).toBe(true);
  fail(new Error('Запись недоступна.'));
  expect((await screen.findByRole('alert')).textContent).toContain('Можно повторить попытку');
  expect(localStorage.getItem('def_ops.modern.replay.author.v1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Начать сеанс' }));
  await waitFor(() => expect(localStorage.getItem('def_ops.modern.replay.author.v1')).toBeNull());
  expect(create).toHaveBeenCalledTimes(2);
  expect(onSavingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  unmount();
  render(<ScenarioForm onCreate={create} />);
  expect(screen.queryByText(/Авторский черновик восстановлен/)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Параметры сеанса' })).toBeTruthy();
});
