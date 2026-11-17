// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MonitorOrder, ServiceSummary, Stepper, moveMonitor } from '../src/expo/operator-parts';
afterEach(cleanup);

it('stepper moves by step and stops at bounds', () => {
  const values: number[] = [];
  const view = render(<Stepper label="Время выбора, с" value={115} min={10} max={120} step={5} onValue={(v) => values.push(v)} />);
  fireEvent.click(view.getByRole('button', { name: 'Время выбора, с: больше' }));
  expect(values).toEqual([120]);
  view.rerender(<Stepper label="Время выбора, с" value={120} min={10} max={120} step={5} onValue={(v) => values.push(v)} />);
  expect((view.getByRole('button', { name: 'Время выбора, с: больше' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Время выбора, с: меньше' }));
  expect(values).toEqual([120, 115]);
  expect(view.getByRole('group', { name: 'Время выбора, с' }).textContent).toContain('120');
});

it('monitor order fills unknown and moves within bounds', () => {
  expect(moveMonitor([], ['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  expect(moveMonitor(['c', 'x'], ['a', 'b', 'c'], 'c', -1)).toEqual(['c', 'x', 'a', 'b']);
  expect(moveMonitor(['b'], ['a', 'b'], 'a', 1)).toEqual(['b', 'a']);
  const saved: string[][] = [];
  const view = render(
    <MonitorOrder
      monitors={[
        { id: 'a', name: 'Левый', x: 0, y: 0, width: 1, height: 1, scale: 1 },
        { id: 'b', name: 'Правый', x: 1, y: 0, width: 1, height: 1, scale: 1 },
      ]}
      order={[]}
      onOrder={(o) => saved.push(o)}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: 'Правый: выше' }));
  expect(saved).toEqual([['b', 'a']]);
  expect((view.getByRole('button', { name: 'Левый: выше' }) as HTMLButtonElement).disabled).toBe(true);
});

it('перестановка подключённых экранов сохраняет места отключённых', () => {
  expect(moveMonitor(['middle', 'left', 'right'], ['left', 'right'], 'right', -1)).toEqual(['middle', 'right', 'left']);
});

it('назначения трёх экранов видны по роли и порядку слева направо', () => {
  const view = render(<MonitorOrder monitors={[
    { id: 'right', name: 'TV', x: 3840, y: 0, width: 1920, height: 1080, scale: 1 },
    { id: 'left', name: 'TV', x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
    { id: 'middle', name: 'TV', x: 1920, y: 0, width: 1920, height: 1080, scale: 1 },
  ]} order={['offline']} onOrder={() => {}} />);
  expect(view.getAllByRole('listitem')[0].textContent).toContain('left');
  for (const label of ['Левый — Штаб ИИ', 'Центральный — Карта', 'Правый — Ход операции']) expect(view.getByText(label)).toBeTruthy();
  expect(view.getByText(/Не подключён: offline/)).toBeTruthy();
});

it('summary speaks words, not codes', () => {
  const view = render(
    <ServiceSummary
      health={{ core: 'ok', voice: 'fail', model: 'off', windows: 'ok' }}
      note="Запуск в режиме без ИИ"
      stats={{ sessions: 3, finished: 2, failures: 1 }}
      screens={{ open: 2, want: 3 }}
    />,
  );
  for (const t of ['Ядро — готово', 'Голос — нет связи', 'Языковая модель — не требуется', 'Экраны — 2 из 3', 'Запуск в режиме без ИИ']) {
    expect(view.getByText(t)).toBeTruthy();
  }
  expect(view.queryByText(/\bok\b|\boff\b/)).toBeNull();
});
