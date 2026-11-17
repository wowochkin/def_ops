#!/usr/bin/env python3
"""Сборка собственного runtime на его целевой ОС. Ничего не устанавливает и не скачивает.

Mac: services/voice/.venv/bin/python scripts/portable-voice.py --sources release/staging/voice-sources --output release/staging/runtime
Повтор: добавить --lock release/staging/runtime/source-lock.json (выводить в другую папку).
Проверка: python3 scripts/portable-voice.py --verify release/staging/runtime
Windows: см. portable-voice-win.ps1; сборка и проверка требуют Windows x64.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import zipfile

MODELS = {
    'qwen3-ru-stress': ('3Xj90Ibl4U/qwen3-tts-12hz-1.7b-ru-stress-cf-mlx8', '657c2b4448f78b9e9de2c8c9c4bd595b5ad633fd'),
    'smart-turn': ('mlx-community/smart-turn-v3', '74af1538ebace37b0fcc667a6a8a3d902d73eee0'),
}
MACH = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf'}

def run(*args):
    return subprocess.check_output([str(a) for a in args], text=True, stderr=subprocess.STDOUT)

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')

def copy_tree(source, target):
    shutil.copytree(source, target, dirs_exist_ok=True, symlinks=False,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo', '.DS_Store'))

def files(root):
    return sorted(p for p in root.rglob('*') if p.is_file())

def is_mach(path):
    with path.open('rb') as f:
        return f.read(4) in MACH

def dependencies(path):
    return [line.strip().split(' (compatibility version')[0] for line in run('otool', '-L', path).splitlines()[1:] if 'compatibility version' in line]

def rpaths(path):
    return re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset', run('otool', '-l', path))

def system_library(name):
    return name.startswith(('/System/Library/', '/usr/lib/'))

def native_closure(root):
    """Замкнуть абсолютные dylib-зависимости; внутренние wheel @rpath сохраняются."""
    queue = [p for p in files(root / 'python') if is_mach(p)] + [root / 'bin' / 'ffmpeg']
    copied = {}
    by_name = {}
    for p in queue: by_name.setdefault(p.name, []).append(p)
    seen = set()
    native_dir = root / 'lib'; native_dir.mkdir(exist_ok=True)
    while queue:
        binary = queue.pop(0)
        if binary in seen: continue
        seen.add(binary)
        deps = dependencies(binary)
        dylib_id = run('otool', '-D', binary).splitlines()[1:]
        if dylib_id and dylib_id[0].startswith('/'):
            run('install_name_tool', '-id', '@rpath/' + binary.name, binary)
        for dep in deps:
            if dep in dylib_id or system_library(dep): continue
            if dep.startswith('@rpath/'):
                suffix = dep.removeprefix('@rpath/')
                candidates = []
                for rp in rpaths(binary):
                    candidate = Path(rp.replace('@loader_path', str(binary.parent)).replace('@executable_path', str(root/'python/bin'))) / suffix
                    if candidate.is_file() and candidate.resolve().is_relative_to(root): candidates.append(candidate)
                if candidates: continue
                candidates = by_name.get(Path(suffix).name, [])
                if not candidates: raise ValueError(f'Неразрешённый @rpath: {binary}: {dep}')
                if len(candidates) > 1 and len({digest(p) for p in candidates}) != 1:
                    raise ValueError(f'Неоднозначный @rpath: {binary}: {dep}: {candidates}')
                target = candidates[0]
                relative_rpath = '@loader_path/' + os.path.relpath(target.parent, binary.parent)
                obsolete = [rp for rp in rpaths(binary) if rp.startswith('/') and not system_library(rp)]
                if obsolete:
                    run('install_name_tool', '-rpath', obsolete[0], relative_rpath, binary)
                elif relative_rpath not in rpaths(binary):
                    run('install_name_tool', '-add_rpath', relative_rpath, binary)
                continue
            if not dep.startswith('/'): continue
            source = Path(dep).resolve()
            if not source.is_file(): raise ValueError(f'Нет нативной зависимости {dep}')
            target = native_dir / source.name
            previous = copied.get(source.name)
            if previous and previous['sha256'] != digest(source): raise ValueError(f'Конфликт dylib: {source.name}')
            if not previous:
                shutil.copy2(source, target)
                copied[source.name] = {'source': str(source), 'sha256': digest(source)}
                queue.append(target)
                by_name.setdefault(target.name, []).append(target)
            replacement = '@loader_path/' + os.path.relpath(target, binary.parent)
            run('install_name_tool', '-change', dep, replacement, binary)
        for rpath in rpaths(binary):
            if rpath.startswith('/') and not system_library(rpath):
                run('install_name_tool', '-delete_rpath', rpath, binary)
        # Любое изменение Mach-O требует обновления ad-hoc подписи на Apple Silicon.
        run('codesign', '--force', '--sign', '-', binary)
    return copied, len(seen)

def audit_native(root):
    count = 0
    for binary in files(root):
        if not is_mach(binary): continue
        count += 1
        for dep in dependencies(binary):
            if dep.startswith('@rpath/'):
                # LC_ID_DYLIB не является зависимостью самого себя.
                if dep in run('otool', '-D', binary).splitlines()[1:]: continue
                suffix = dep.removeprefix('@rpath/')
                candidates = [Path(rp.replace('@loader_path', str(binary.parent)).replace('@executable_path', str(root/'python/bin'))) / suffix for rp in rpaths(binary)]
                if not any(p.is_file() and p.resolve().is_relative_to(root) for p in candidates):
                    raise ValueError(f'Неразрешённый @rpath: {binary}: {dep}')
            if dep.startswith('/') and not system_library(dep): raise ValueError(f'Внешняя dylib: {binary}: {dep}')
            if dep.startswith('@loader_path/') and not (binary.parent / dep.removeprefix('@loader_path/')).exists():
                raise ValueError(f'Нет внутренней dylib: {binary}: {dep}')
        for rp in rpaths(binary):
            if rp.startswith('/') and not system_library(rp): raise ValueError(f'Внешний rpath: {binary}: {rp}')
    return count

def native_platform(root):
    versions = {}
    for binary in files(root):
        if not is_mach(binary): continue
        header = run('otool', '-l', binary)
        found = re.findall(r'\bminos (\d+(?:\.\d+)+)', header)
        found += re.findall(r'cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+(?:\.\d+)+)', header)
        if found: versions[binary.relative_to(root).as_posix()] = max(found, key=lambda v: tuple(map(int, v.split('.'))))
    minimum = max(versions.values(), key=lambda v: tuple(map(int, v.split('.')))) if versions else None
    return {'platform': 'darwin-arm64', 'minimum_macos': minimum, 'binaries': versions}

def licenses(root, native):
    target = root / 'licenses'; target.mkdir(exist_ok=True)
    (target / 'ffmpeg-license.txt').write_text(run(root / 'bin/ffmpeg', '-L'), encoding='utf-8')
    (target / 'ffmpeg-build.txt').write_text(run(root / 'bin/ffmpeg', '-version'), encoding='utf-8')
    packages = []
    for dist in sorted(importlib.metadata.distributions(path=[str(root / 'python/lib/python3.12/site-packages')]), key=lambda d: d.metadata.get('Name', '').lower()):
        name = dist.metadata.get('Name', 'unknown')
        evidence = []
        for entry in dist.files or []:
            if any(token in Path(str(entry)).name.lower() for token in ('license', 'copying', 'notice')):
                source = Path(dist.locate_file(entry))
                if source.is_file():
                    dest = target / 'python-packages' / name / str(entry).replace('..', '_')
                    dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, dest)
                    evidence.append(dest.relative_to(root).as_posix())
        packages.append({'name': name, 'version': dist.version, 'license_metadata': dist.metadata.get('License-Expression') or dist.metadata.get('License', ''), 'license_files': evidence})
    formulae = {}
    for info in native.values():
        source = Path(info['source'])
        parts = source.parts
        if 'Cellar' not in parts: continue
        idx = parts.index('Cellar'); formula = '/'.join(parts[idx+1:idx+3]); prefix = Path(*parts[:idx+3])
        if formula in formulae: continue
        evidence = []
        for p in prefix.rglob('*'):
            if p.is_file() and any(t in p.name.lower() for t in ('license', 'copying', 'notice', 'install_receipt')):
                dest = target / 'native' / formula / p.relative_to(prefix)
                dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p, dest)
                evidence.append(dest.relative_to(root).as_posix())
        formulae[formula] = evidence
    report = {'status': 'requires-redistribution-review', 'python_packages': packages, 'native_packages': formulae,
        'models': [{'name': name, 'repository': repo, 'revision': revision, 'declared_license': 'Apache-2.0' if name == 'qwen3-ru-stress' else 'review model upstream'} for name, (repo, revision) in MODELS.items()],
        'pending': ['FFmpeg и связанные GPL-библиотеки: приложить точный соответствующий исходный код и инструкции сборки либо заменить согласованной сборкой.',
                    'Проверить лицензии каждой модели (включая GigaAM, Silero VAD и Smart Turn), токенизаторов и голосовых образцов.',
                    'Проверить пакеты без license_files; метаданные не заменяют текст лицензии.',
                    'Подпись Developer ID/notarization и запуск на чистой учётной записи проверяются отдельно.']}
    write_json(target / 'redistribution-report.json', report)
    (target / 'README.txt').write_text('Комплект содержит фактические тексты лицензий и метаданные установленных компонентов.\nСтатус requires-redistribution-review: это техническая сборка, не подтверждение права распространения.\nПодробности: redistribution-report.json.\n', encoding='utf-8')
    return [{'name': p['name'], 'version': p['version']} for p in packages]

def verify(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    actual = {p.relative_to(root).as_posix() for p in files(root) if p.name != 'manifest.json' or p.parent != root}
    if actual != set(manifest['files']): raise ValueError('Набор файлов runtime отличается от manifest.json')
    for relative, info in manifest['files'].items():
        p = root / relative
        if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()): raise ValueError(f'Внешняя ссылка: {relative}')
        if p.stat().st_size != info['size'] or digest(p) != info['sha256']: raise ValueError(f'Повреждён файл: {relative}')
    if sys.platform == 'darwin': audit_native(root)
    return {'ok': True, 'files': len(actual), 'bytes': sum(i['size'] for i in manifest['files'].values()), 'platform': manifest['platform']}

def build(args):
    root = args.output.resolve()
    if root.exists(): raise ValueError(f'Выходной каталог уже существует: {root}; выберите новый')
    if sys.platform != 'darwin' or platform.machine() != 'arm64': raise ValueError('Эта сборка требует macOS arm64; Windows: portable-voice-win.ps1')
    if sys.version_info[:2] != (3, 12): raise ValueError('Запустите сборщик Python 3.12 из подготовленного voice venv')
    base = Path(sys.base_prefix)
    if sys.prefix == sys.base_prefix: raise ValueError('Запустите сборщик из services/voice/.venv')
    if not args.sources: raise ValueError('Нужен --sources с wheels из portable-voice-fetch.py')
    wheel_lock = json.loads(Path(__file__).with_name('portable-voice-sources.json').read_text())
    for item in wheel_lock['files']:
        source = args.sources / item['name']
        if not source.is_file() or digest(source) != item['sha256']: raise ValueError(f'Нет закреплённого wheel: {source}')
    root.mkdir(parents=True)
    copy_tree(base, root / 'python')
    site = Path(sys.prefix) / 'lib/python3.12/site-packages'
    target_site = root / 'python/lib/python3.12/site-packages'
    if target_site.exists(): shutil.rmtree(target_site)
    copy_tree(site, target_site)
    # pip на новом macOS выбирает wheel min26; для общего комплекта закреплены wheels min14.
    for name in ('mlx', 'mlx-0.32.4.dist-info', 'mlx_metal-0.32.4.dist-info'):
        existing = target_site / name
        if existing.exists(): shutil.rmtree(existing)
    for item in wheel_lock['files']:
        with zipfile.ZipFile(args.sources / item['name']) as archive:
            for name in archive.namelist():
                if not (target_site / name).resolve().is_relative_to(target_site): raise ValueError('Небезопасный путь wheel')
            archive.extractall(target_site)
    ffmpeg = Path(args.ffmpeg).resolve() if args.ffmpeg else next((target_site/'imageio_ffmpeg/binaries').glob('ffmpeg-macos-*'))
    ffmpeg.chmod(0o755)
    # Console-script shebangs исходного Python не должны попадать в комплект.
    for p in (root / 'python/bin').iterdir():
        if not p.name.startswith('python3') or not is_mach(p):
            if p.is_dir(): shutil.rmtree(p)
            else: p.unlink()
    (root / 'bin').mkdir(); shutil.copy2(ffmpeg, root / 'bin/ffmpeg')
    models = root / 'models/voice'; sources = {}
    for name, (repo, rev) in MODELS.items():
        source = args.hf_cache / ('models--' + repo.replace('/', '--')) / 'snapshots' / rev
        if not source.is_dir(): raise ValueError(f'Нет закреплённого snapshot: {source}')
        copy_tree(source, models / name)
        # Исполняемый сторонний пример сервера не требуется для загрузки весов.
        for p in (models / name).glob('*.py'): p.unlink()
        sources[name] = {'repository': repo, 'revision': rev}
    (models / 'gigaam').mkdir()
    for name in ('v3_e2e_rnnt.ckpt', 'v3_e2e_rnnt_tokenizer.model'):
        shutil.copy2(args.gigaam_cache / name, models / 'gigaam' / name)
    native, count = native_closure(root)
    packages = licenses(root, {**native, 'ffmpeg': {'source': str(ffmpeg), 'sha256': digest(ffmpeg)}})
    source_lock = {'schema': 1, 'python': platform.python_version(), 'platform': 'darwin-arm64', 'packages': packages,
                   'models': sources, 'native': native, 'ffmpeg_sha256': digest(ffmpeg), 'wheels': wheel_lock['files'],
                   'python_source_files': {p.relative_to(base).as_posix(): digest(p) for p in files(base) if '__pycache__' not in p.parts and p.suffix not in ('.pyc', '.pyo')},
                   'site_source_files': {p.relative_to(site).as_posix(): digest(p) for p in files(site) if '__pycache__' not in p.parts and p.suffix not in ('.pyc', '.pyo')},
                   'model_files': {p.relative_to(models).as_posix(): digest(p) for p in files(models)}}
    if args.lock and json.loads(args.lock.read_text(encoding='utf-8')) != source_lock: raise ValueError('Источники отличаются от --lock; не выпускать эту сборку')
    write_json(root / 'source-lock.json', source_lock)
    native_info = native_platform(root)
    if tuple(map(int, native_info['minimum_macos'].split('.'))) > (14, 0):
        raise ValueError(f"Нативные компоненты требуют macOS {native_info['minimum_macos']}, целевой минимум 14.0")
    write_json(root / 'native-platform.json', native_info)
    # Проверяется переносимый Python с пустым HOME, без PATH Homebrew и пользовательских site-packages.
    clean = {k: v for k,v in os.environ.items() if not k.startswith(('PYTHON', 'DYLD_', 'LD_LIBRARY'))}
    clean.update(PATH=str(root/'bin') + ':/usr/bin:/bin', PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    imports = 'import sys,ssl,sqlite3,ctypes,numpy,torch,torchaudio,mlx.core,mlx_audio,gigaam,silero_vad,livekit,fastapi,uvicorn,soundfile; from livekit import rtc; print(sys.version)'
    subprocess.run([str(root / 'python/bin/python3'), '-I', '-B', '-c', imports], env=clean, check=True)
    subprocess.run([str(root/'bin/ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.1', '-f', 'null', '-'], env=clean, check=True)
    audit_native(root)
    write_json(root / 'manifest.json', {'schema': 1, 'platform': 'darwin-arm64', 'engine': 'qwen3-ru-stress', 'native_binaries': count,
        'files': {p.relative_to(root).as_posix(): {'size': p.stat().st_size, 'sha256': digest(p)} for p in files(root)}})
    return verify(root)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output', type=Path)
    ap.add_argument('--verify', type=Path)
    ap.add_argument('--lock', type=Path)
    ap.add_argument('--ffmpeg')
    ap.add_argument('--sources', type=Path, help='wheels из portable-voice-fetch.py')
    ap.add_argument('--hf-cache', type=Path, default=Path.home()/'.cache/huggingface/hub')
    ap.add_argument('--gigaam-cache', type=Path, default=Path.home()/'.cache/gigaam')
    args = ap.parse_args()
    if not args.output and not args.verify: ap.error('Нужен --output или --verify')
    try:
        result = verify(args.verify.resolve()) if args.verify else build(args)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(f'Ошибка: {e}', file=sys.stderr); raise SystemExit(1)

if __name__ == '__main__': main()
