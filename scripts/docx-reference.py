"""Шаблон стилей Word для описания системы (docs/reference.docx): шрифты, цвета заголовков, таблицы с рамками.
Запуск: pandoc -o base.docx --print-default-data-file reference.docx && python3 scripts/docx-reference.py base.docx docs/reference.docx"""
import sys
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

src, out = sys.argv[1], sys.argv[2]
d = Document(src)
RED = RGBColor(0x7A, 0x1B, 0x16)
# шрифты Office с кириллицей: есть у читателя в Word без установки (PT — только в PDF)
SERIF, SANS, MONO = 'Cambria', 'Calibri', 'Consolas'

def font(style, name, size=None, bold=None, color=None, italic=None):
    f = style.font
    f.name = name
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts'); rpr.append(rfonts)
    for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        rfonts.set(qn(a), name)
    for a in ('w:asciiTheme', 'w:hAnsiTheme', 'w:cstheme', 'w:eastAsiaTheme'):
        if rfonts.get(qn(a)) is not None: del rfonts.attrib[qn(a)]
    if size: f.size = Pt(size)
    if bold is not None: f.bold = bold
    if italic is not None: f.italic = italic
    if color is not None: f.color.rgb = color

S = {s.name: s for s in d.styles}  # по имени как в документе (без перевода имён python-docx)
for n in ('Normal', 'Body Text', 'First Paragraph', 'Compact'):
    if n in S: font(S[n], SERIF, 10.5)
for n in ('Body Text', 'First Paragraph'):
    if n in S:
        pf = S[n].paragraph_format; pf.space_after = Pt(6); pf.space_before = Pt(0); pf.line_spacing = 1.15
font(S['Title'], SANS, 22, True, RED)
font(S['TOC Heading'], SANS, 16, True, RED)
for lvl, size in ((1, 18), (2, 14), (3, 12)):
    st = S[f'Heading {lvl}']
    font(st, SANS, size, True, RED if lvl < 3 else RGBColor(0x1D, 0x1D, 0x1B))
    st.paragraph_format.space_before = Pt(16 if lvl < 3 else 10); st.paragraph_format.space_after = Pt(6)
    st.paragraph_format.keep_with_next = True
S['Heading 1'].paragraph_format.page_break_before = True
for n in ('Source Code', 'Verbatim Char'):
    if n in S: font(S[n], MONO, 8.5)
if 'Hyperlink' in S: S['Hyperlink'].font.color.rgb = RED

# таблицы: рамки, шапка с заливкой
t = S['Table']
tbl = t.element
tblPr = tbl.find(qn('w:tblPr'))
if tblPr is None:
    tblPr = OxmlElement('w:tblPr'); tbl.append(tblPr)
for old in tblPr.findall(qn('w:tblBorders')): tblPr.remove(old)
b = OxmlElement('w:tblBorders')
for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
    e = OxmlElement(f'w:{side}'); e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), '4'); e.set(qn('w:color'), 'B9B4A8'); b.append(e)
tblPr.append(b)
font(t, SANS, 9)
d.save(out)
