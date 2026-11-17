#!/usr/bin/env python3
"""Предзагрузка Windows wheels на сборочной машине (можно на Mac).
python3 scripts/portable-voice-wheels.py --output release/staging/windows-wheels
Требуются pip и интернет. Манифест появляется только после загрузки всего закреплённого набора.
Не подтверждает работу CUDA/Windows; это проверяется portable-voice-win.ps1 на Windows.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

COMMIT='7447938d791c4f3e643386ee22c33777004293a5'
repo=Path(__file__).resolve().parent.parent
service=repo/'services/voice'
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();output=a.output.resolve();output.mkdir(parents=True,exist_ok=True)

def pip(*args):
 subprocess.run([sys.executable,'-m','pip',*map(str,args)],check=True)

def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

# Фиксированный upstream GigaAM, без одноимённого стороннего пакета PyPI.
giga=output/'gigaam-0.2.0-py3-none-any.whl'
provenance=output/'gigaam-source.json'
known=json.loads(provenance.read_text()) if provenance.is_file() else {}
if not giga.is_file() or known.get('commit')!=COMMIT or known.get('sha256')!=sha(giga):
 pip('wheel','--no-deps','--wheel-dir',output,f'https://github.com/salute-developers/GigaAM/archive/{COMMIT}.zip')
 provenance.write_text(json.dumps({'commit':COMMIT,'sha256':sha(giga)})+'\n',encoding='utf-8')
for name,version in [('antlr4-python3-runtime','4.9.3'),('docopt','0.6.2'),('sox','1.5.0')]:
 if not list(output.glob(name.replace('-','_')+'-'+version+'-*.whl')):
  pip('wheel','--no-deps','--wheel-dir',output,f'{name}=={version}')
lock=service/'requirements-win.lock.txt'
text=lock.read_text(encoding='utf-8').replace('gigaam==0.2.0','gigaam @ '+giga.as_uri())
for name in ('torch','torchaudio'):
 text=text.replace(name+'==2.7.1+cu128',name+' @ https://download.pytorch.org/whl/cu128/'+name+'-2.7.1%2Bcu128-cp312-cp312-win_amd64.whl')
with tempfile.TemporaryDirectory(prefix='defops-win-wheels-') as tmp:
 requirements=Path(tmp)/'download.txt';requirements.write_text(text,encoding='utf-8')
 pip('download','--no-deps','--only-binary=:all:','--platform','win_amd64','--python-version','312',
     '--implementation','cp','--abi','cp312','--dest',output,'--find-links',output,'-r',requirements)
expected={line.split('==')[0].lower().replace('-','_'):line.split('==')[1] for line in lock.read_text().splitlines() if '==' in line and not line.startswith('#')}
seen=set()
for wheel in output.glob('*.whl'):
 name,version=wheel.name.split('-')[:2]
 name=name.lower().replace('-','_')
 if expected.get(name)!=version or name in seen:raise RuntimeError('Лишний/повторный wheel: '+wheel.name)
 seen.add(name)
if seen!=set(expected):raise RuntimeError('Неполный wheelhouse')
entries={f.name:sha(f) for f in sorted(output.glob('*.whl'))}
# Формат, который проверяет services/voice/setup.ps1 перед автономной установкой.
manifest={'version':1,'python':'3.12-x64','gigaam_commit':COMMIT,
          'requirements_sha256':sha(service/'requirements-win.txt'),'lock_sha256':sha(lock),'files':entries}
(output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'ok':True,'wheels':len(entries),'bytes':sum(f.stat().st_size for f in output.glob('*.whl'))}))
