import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Staffs } from '../src/CommandStaffs';

const hq = (name: string, echelon: string, parent: string | null, control = 'agent') => ({ control, led: false, name, echelon, parent });
const view = (mode: string) => ({ turn: 2, terms: { topGen: 'Ставки' }, places: [], own: [], command: {
  mode, led: [], requests: [], historical: [], enemy: { hqs: {}, divisions: {} },
  hqs: { s: hq('Ставка ВГК', 'high_command', null), f1: hq('1-й Белорусский фронт', 'front', 's'), a1: hq('8 гв. А', 'army', 'f1', 'player'), a2: hq('33 А', 'army', 'f1') },
  documents: [{ time: '17.04 05:00', hq: 'a2', hqName: '33 А', kind: 'order', to: [], text: 'чужой приказ', rule: null }],
} }) as never;

describe('вкладка «Штабы»', () => {
  it('«взять» и «вернуть» — отдельные кнопки в рамке с промежутком', () => {
    const html = renderToString(createElement(Staffs, { v: view('intent'), cmds: [], issuer: null }));
    expect(html).toMatch(/<span class="staffs-acts">(<button[^>]*class="staffs-btn[^"]*"[^>]*>[^<]+<\/button>){1,2}<\/span>/);
    expect(html).not.toMatch(/взять<\/button><button[^>]*class="link/);
  });
  it('пункт армии — только её поддерево и документы, переключатель «показать все»; без пункта — всё', () => {
    const own = renderToString(createElement(Staffs, { v: view('agents'), cmds: [], issuer: 'a1' }));
    expect(own).toContain('8 гв. А');
    expect(own).not.toContain('33 А');
    expect(own).not.toContain('чужой приказ');
    expect(own).toContain('data-action="command.staffs.all"');
    const all = renderToString(createElement(Staffs, { v: view('agents'), cmds: [], issuer: null }));
    expect(all).toContain('33 А');
    expect(all).not.toContain('data-action="command.staffs.all"');
  });
});
