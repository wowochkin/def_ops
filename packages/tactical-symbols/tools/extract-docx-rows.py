"""Изолирует строки исходных таблиц DOCX без изменения их графики."""
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def text(element):
    return ' '.join(' '.join(node.text or '' for node in p.findall('.//' + W + 't')).strip()
                    for p in element.findall('./' + W + 'p')).strip()


def extract(source: Path, target: Path):
    with ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    original = files['word/document.xml']
    root = ET.fromstring(original)
    body = root.find(W + 'body')
    rows = body.findall('.//' + W + 'tr')
    manifest = []
    for index, keep in enumerate(rows):
        row_root = ET.fromstring(original)
        row_body = row_root.find(W + 'body')
        for child in list(row_body):
            if child.tag not in (W + 'tbl', W + 'sectPr'):
                row_body.remove(child)
        cloned_rows = row_body.findall('.//' + W + 'tr')
        parents = {child: parent for parent in row_root.iter() for child in parent}
        for row_index, row in enumerate(cloned_rows):
            if row_index != index:
                parents[row].remove(row)
        cells = keep.findall('./' + W + 'tc')
        cell_texts = [text(cell) for cell in cells]
        description_cells = [
            {'cell': cell_index, 'text': value}
            for cell_index, value in enumerate(cell_texts[1:], 1) if value
        ]
        description = max(description_cells, key=lambda item: len(item['text']), default={'cell': None, 'text': ''})
        name = f'row-{index:03d}.docx'
        files['word/document.xml'] = ET.tostring(row_root, encoding='utf-8', xml_declaration=True)
        with ZipFile(target / name, 'w', ZIP_DEFLATED) as archive:
            for file_name, data in files.items():
                archive.writestr(file_name, data)
        manifest.append({
            'row': index,
            'file': name,
            'description': description['text'],
            'descriptionCell': description['cell'],
            'cellTexts': cell_texts,
        })
    return manifest


def main():
    source_root, target_root = map(Path, sys.argv[1:3])
    target_root.mkdir(parents=True, exist_ok=True)
    result = {}
    for source in sorted(source_root.glob('*.docx')):
        target = target_root / source.stem
        target.mkdir(parents=True, exist_ok=True)
        result[source.stem] = extract(source, target)
    (target_root / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
