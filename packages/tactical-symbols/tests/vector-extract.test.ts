import { expect, it } from 'vitest';
import { assertContiguousCoverage, extractNumberedEntries, extractNumberedEntriesFromBBox, normalizeSourceEntries } from '../src/source/vector-extract';

it('отличает исходные номера от вариантов и сохраняет текст записи', () => {
  const page = `75\n\nТанк\n\n76\n\nБоевая машина пехоты\n\n80\n  1\n  2\nТягачи: 1 — танковый; 2 — гусеничный`;
  expect(extractNumberedEntries(page)).toEqual([
    { number: '75', text: 'Танк' },
    { number: '76', text: 'Боевая машина пехоты' },
    { number: '80', text: '1\n2\nТягачи: 1 — танковый; 2 — гусеничный' },
  ]);
});

it('подтверждает непрерывность и не скрывает пропущенный номер', () => {
  expect(assertContiguousCoverage([{ number: '75' }, { number: '76' }, { number: '77' }])).toEqual({ first: 75, last: 77, count: 3 });
  expect(() => assertContiguousCoverage([{ number: '75' }, { number: '77' }])).toThrow('76');
  expect(() => assertContiguousCoverage([{ number: '75' }, { number: '75' }])).toThrow('дубликат');
});

it('использует левую колонку PDF для номеров и не принимает вариант за отдельный знак', () => {
  const xml = `<doc><page width="595" height="842">
    <word xMin="260" yMin="60" xMax="350" yMax="72">Заголовок</word>
    <word xMin="83" yMin="120" xMax="90" yMax="132">75</word>
    <word xMin="260" yMin="120" xMax="290" yMax="132">Танк</word>
    <word xMin="140" yMin="155" xMax="145" yMax="167">1</word>
    <word xMin="84" yMin="220" xMax="91" yMax="232">76</word>
    <word xMin="260" yMin="220" xMax="350" yMax="232">Боевая</word>
    <word xMin="260" yMin="235" xMax="350" yMax="247">машина</word>
  </page></doc>`;
  expect(extractNumberedEntriesFromBBox(xml)).toEqual([
    { number: '75', text: 'Танк', page: 1, x: 83, y: 120 },
    { number: '76', text: 'Боевая машина', page: 1, x: 84, y: 220 },
  ]);
});


it('объединяет повтор документа и отклоняет номера вариантов без потери следов', () => {
  const raw = [
    { documentId: 'doc-a', sourceDocument: '003.doc', page: 1, number: '68', text: 'Движение', x: 84, y: 100 },
    { documentId: 'doc-b', sourceDocument: '03.doc', page: 1, number: '68', text: 'Движение', x: 84, y: 100 },
    { documentId: 'doc-c', sourceDocument: '04.doc', page: 1, number: '100', text: 'Знак', x: 84, y: 100 },
    { documentId: 'doc-c', sourceDocument: '04.doc', page: 1, number: '1', text: 'Вариант', x: 84, y: 150 },
    { documentId: 'doc-c', sourceDocument: '04.doc', page: 2, number: '836', text: 'Артефакт', x: 84, y: 100 },
    { documentId: 'doc-d', sourceDocument: 'Усл.знаки МПО.doc', page: 1, number: '1', text: 'Непронумерованный материал', x: 84, y: 100 },
  ];
  const result = normalizeSourceEntries(raw);
  expect(result.entries).toHaveLength(2);
  expect(result.entries[0]).toMatchObject({ number: '68', sourceDocument: '003.doc' });
  expect(result.entries[0].sourceDocuments).toEqual(['003.doc', '03.doc']);
  expect(result.discarded.map(entry => `${entry.number}:${entry.reason}`)).toEqual([
    '1:номер варианта', '836:вне диапазона источника', '1:непронумерованный документ',
  ]);
});

it('разрешает только явно зафиксированный пробел исходной нумерации', () => {
  expect(assertContiguousCoverage([{ number: '320' }, { number: '324' }], [321, 322, 323])).toEqual({ first: 320, last: 324, count: 2 });
});


it('сохраняет целый блок описания, даже если его первая строка выше номера знака', () => {
  const xml = `<doc><page width="595" height="842">
    <block xMin="250" yMin="90" xMax="500" yMax="140"><word xMin="250" yMin="90" xMax="300" yMax="102">Полное</word><word xMin="250" yMin="112" xMax="300" yMax="124">название</word></block>
    <word xMin="83" yMin="120" xMax="90" yMax="132">75</word>
  </page></doc>`;
  expect(extractNumberedEntriesFromBBox(xml)[0].text).toBe('Полное название');
});
