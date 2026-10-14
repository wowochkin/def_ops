import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { rowsToCandidates, templateMapping } from '@def-ops/knowledge';
import { tableRows } from '../src/kb/text';

/** Крошечная книга XLSX: строка заголовка, строка с датой-ячейкой (формат даты) и числами. */
function xlsx(): Uint8Array {
  const serial = Math.round((Date.UTC(1945, 3, 16) - Date.UTC(1899, 11, 30)) / 86400000);
  const strings = ['kind', 'subject', 'date', 'personnel', 'tanks', 'strength', 'Условная 1-я армия'];
  const x = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`);
  const head = strings.slice(0, 5).map((_, i) => `<c r="${'ABCDE'[i]}1" t="s"><v>${i}</v></c>`).join('');
  return zipSync({
    '[Content_Types].xml': x('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'),
    '_rels/.rels': x('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': x('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': x('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'),
    'xl/styles.xml': x('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>'),
    'xl/sharedStrings.xml': x(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': x(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${head}</row><row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" s="1"><v>${serial}</v></c><c r="D2"><v>52000</v></c><c r="E2"><v>310</v></c></row></sheetData></worksheet>`),
  });
}

describe('таблица XLSX → кандидаты', () => {
  it('дата-ячейка становится ГГГГ-ММ-ДД, числа сохраняются', async () => {
    const rows = await tableRows(new File([xlsx() as BlobPart], 't.xlsx'));
    expect(rows[0]).toEqual(['kind', 'subject', 'date', 'personnel', 'tanks']);
    expect(rows[1]).toEqual(['strength', 'Условная 1-я армия', '1945-04-16', '52000', '310']);
    const r = rowsToCandidates(rows, templateMapping(rows[0]), { id: 'x1', name: 't', reliability: 'B' });
    expect(r.errors).toEqual([]);
    expect(r.candidates[0].claim).toMatchObject({ kind: 'strength', at: '1945-04-16', personnel: 52000, tanks: 310 });
  });
});
