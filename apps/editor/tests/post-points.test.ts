// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Points } from '../src/CommandPost';

const v = { places: [{ id: 'p1', title: 'Зелов', at: [14.4, 52.6] }, { id: 'p2', title: 'Мюнхеберг', at: [14.1, 52.5] }], own: [], intel: [], lines: [], crossings: [] } as never;
const el = (field: 'boundaryR' | 'immediate', pts: [number, number][]) => createElement(Points, { v, label: 'поле', field, pts, pick: null, from: null });
const listOpen = (c: HTMLElement) => !!c.querySelector('.post-objs');

afterEach(cleanup);

describe('«из списка» в поле точек', () => {
  it('разграничительная линия (несколько точек): список открыт, пока игрок его не закроет', () => {
    const r = render(el('boundaryR', []));
    fireEvent.click(r.getByText('из списка'));
    expect(listOpen(r.container)).toBe(true);
    r.rerender(el('boundaryR', [[14.4, 52.6]]));
    expect(listOpen(r.container)).toBe(true);
    r.rerender(el('boundaryR', [[14.4, 52.6], [14.1, 52.5]]));
    expect(listOpen(r.container)).toBe(true);
    fireEvent.click(r.getByText('из списка'));
    expect(listOpen(r.container)).toBe(false);
  });
  it('поле одного объекта: объект поставлен — список закрывается', () => {
    const r = render(el('immediate', []));
    fireEvent.click(r.getByText('из списка'));
    r.rerender(el('immediate', [[14.4, 52.6]]));
    expect(listOpen(r.container)).toBe(false);
  });
});
