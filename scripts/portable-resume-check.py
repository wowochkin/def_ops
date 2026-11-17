"""Проверить сохранённую подготовку перед продолжением Windows-сборки."""
import hashlib
import json
from pathlib import Path
import sys


def verify(root, entries):
    if not entries:
        raise ValueError('Пустой манифест')
    for name, item in entries.items():
        if not name or '\\' in name or ':' in name or name.startswith('/') or '..' in Path(name).parts:
            raise ValueError('Недопустимый путь: ' + name)
        p = root / name
        if not p.resolve().is_relative_to(root.resolve()) or not p.is_file() or p.stat().st_size != item['size']:
            raise ValueError('Отсутствует или повреждён файл: ' + str(p))
        with p.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        if digest != item['sha256']:
            raise ValueError('Не совпадает SHA256: ' + str(p))


def check(repo):
    runtime = repo / 'apps/desktop/portable/runtime'
    library = repo / 'apps/desktop/portable/library'
    m = json.loads((runtime / 'manifest.json').read_text(encoding='utf-8-sig'))
    if m['schema'] != 1 or m['platform'] != 'win32-x64' or m['engine'] != 'qwen3-ru-stress':
        raise ValueError('Неизвестный runtime')
    verify(runtime, m['files'])
    m = json.loads((library / 'manifest.json').read_text(encoding='utf-8-sig'))
    if m['format'] != 'def-ops-file-library' or m['version'] != 1:
        raise ValueError('Неизвестная библиотека')
    verify(library / 'files', {e['path']: e for e in m['files']})
    for name in ['node_modules/tsx/package.json', 'release/downloads/node-runtime/LICENSE',
                 'apps/desktop/portable/runtime/python/python.exe', 'scripts/data/stress-suggestions.json']:
        if not (repo / name).is_file():
            raise ValueError('Не готов этап подготовки: ' + name)
    print('Сохранённые runtime и библиотека: SHA256 совпадают. Продолжаем со словаря.', flush=True)


if __name__ == '__main__':
    check(Path(sys.argv[1]).resolve())
