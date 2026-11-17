#!/usr/bin/env python3
"""Собрать переносимый набор для запуска сборки на Windows, без объявления готового EXE."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

repo = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
out = a.output.resolve()
if out.exists():
    raise SystemExit('Выходная папка уже существует; используйте новую')
inputs = repo / 'release/windows-preparation/inputs'
installers = repo / 'release/staging/windows-installers'
node = repo / 'release/staging/windows-node'

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

wm = json.loads((inputs / 'wheels/manifest.json').read_text())
for name, digest in wm['files'].items():
    if Path(name).name != name or sha(inputs / 'wheels' / name) != digest:
        raise RuntimeError('Повреждён wheel: ' + name)
if sha(installers / 'rustup-init.exe') != (installers / 'rustup-init.exe.sha256').read_text().split()[0]:
    raise RuntimeError('SHA256 rustup не совпадает с официальным')
for name in ('rustup-init.exe', 'vs_buildtools.exe', 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'):
    with (installers / name).open('rb') as f:
        if f.read(2) != b'MZ':
            raise RuntimeError('Вместо Windows установщика получен другой файл: ' + name)
if (installers / 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe').stat().st_size < 100_000_000:
    raise RuntimeError('Нужен полный WebView2, не сетевой bootstrapper')
out.mkdir(parents=True)

def copytree(src, dst):
    # APFS clone экономит место на машине подготовки; в ZIP попадут настоящие байты.
    if __import__('sys').platform == 'darwin':
        subprocess.run(['cp', '-cR', str(src), str(dst)], check=True)
    else:
        shutil.copytree(src, dst)

copytree(inputs, out / 'inputs')
(out / 'tools').mkdir()
copytree(node, out / 'tools/node')
copytree(installers, out / 'tools/installers')
shutil.copyfile(repo / 'release/downloads/node-v22.23.4-win-x64.zip', out / 'tools/node-v22.23.4-win-x64.zip')
paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repo).decode().split('\0')
for name in sorted(set(paths)):
    if not name:
        continue
    rel = Path(name)
    if any(part in {'node_modules', '.venv', '.git', 'target', 'dist', '__pycache__', 'release'} for part in rel.parts):
        continue
    if name.startswith(('apps/desktop/portable/', 'apps/desktop/src-tauri/binaries/', 'apps/desktop/server/voice-service/')):
        continue
    if rel.name.startswith('.env') and not rel.name.endswith('.example'):
        continue
    src = repo / rel
    if not src.exists():
        continue
    if src.is_symlink():
        raise RuntimeError('Ссылка в исходниках: ' + name)
    if src.is_file():
        dst = out / 'source' / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
# Все локальные данные модели, включая незакоммиченные ресурсы, нужны готовому приложению.
shutil.rmtree(out / 'source/packages/sim/data')
copytree(repo / 'packages/sim/data', out / 'source/packages/sim/data')
# Общий gitignore для data не должен исключать словарь и его лицензию.
shutil.copytree(repo / 'scripts/data', out / 'source/scripts/data', dirs_exist_ok=True)
if not (out / 'source/scripts/data/stress-suggestions.json').is_file():
    raise RuntimeError('В комплекте отсутствуют подсказки ударений')
(out / 'BUILD-WINDOWS.cmd').write_bytes(b'@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0source\\scripts\\portable-windows-start.ps1" -KitRoot "%~dp0."\r\nset "BUILD_RESULT=%ERRORLEVEL%"\r\npause\r\nexit /b %BUILD_RESULT%\r\n')
(out / 'НАЧНИТЕ ЗДЕСЬ.txt').write_text('''КОМПЛЕКТ СБОРКИ ДЛЯ WINDOWS 10/11 X64 И NVIDIA CUDA

1. Перенесите архив на локальный SSD Windows и распакуйте целиком, например в C:\\DefOpsKit.
   Нужны интернет для первой сборки и запас свободного места — желательно не менее 60 ГБ.
2. Запустите BUILD-WINDOWS.cmd обычным двойным щелчком.
3. Если нет C++ Build Tools, появится системный запрос администратора на их установку.
   При запросе перезагрузки перезагрузите ПК и снова запустите тот же файл.
4. Скрипт сам проверит файлы, подготовит инструменты и соберёт приложение. Окно не закрывайте.
5. После успешной сборки путь к готовой папке появится в LAST-BUILD.txt.
   В этой папке откройте launch.cmd. Переносить на другой ПК нужно ВСЮ папку готового приложения.
6. Установите LM Studio, загрузите LLM/embeddings, включите локальный сервер и выберите модели
   в мастере приложения. Затем проверьте работу с отключённой сетью.

Python, Node, FFmpeg, словари, база, карты, предзаписи и модели голоса включены.
Rust/MSVC нужны только для этой сборки; готовой программе инструменты разработчика не нужны.
Сборка использует GPU и требует установленного драйвера NVIDIA с поддержкой CUDA 12.8.
Если голосовой тест сообщает, что CUDA недоступна, проверьте драйвер и журнал; CPU-подмена не выполняется.

ЭТО НАБОР ДЛЯ СБОРКИ, А НЕ УЖЕ ПРОВЕРЕННАЯ WINDOWS-ПРОГРАММА.
Сейчас включён режим приёмочной сборки: два известных падения тестов оценки промедления
сохраняются в test-assessment.json; они не исправлены и не скрыты. Любое другое падение
останавливает сборку. Модель боя и её тестовые ожидания не подменяются ради переноса.
После компиляции обязательны проверка обоих фронтов, голоса, автономности и трёх телевизоров.
Обычный HDMI-сплиттер дублирует картинку; три роли требуют трёх независимых дисплеев.

При ошибке пришлите журнал из logs. Промежуточные файлы сохраняются в work;
повторный запуск создаёт новую попытку, не удаляя старую.
Подробности: source/docs/expo-portable-windows-build.md.
''', encoding='utf-8-sig')
entries = []
for file in sorted(out.rglob('*')):
    if file.is_symlink():
        raise RuntimeError('Ссылка в комплекте: ' + str(file))
    if file.is_file():
        entries.append({'path': file.relative_to(out).as_posix(), 'size': file.stat().st_size, 'sha256': sha(file)})
(out / 'kit-manifest.json').write_text(json.dumps({'schema': 1, 'kind': 'windows-build-kit', 'windows_verified': False, 'files': entries}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'files': len(entries), 'bytes': sum(f['size'] for f in entries), 'path': str(out)}))
