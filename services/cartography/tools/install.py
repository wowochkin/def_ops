"""Установка GIS-дополнений из локальных wheels, не затрагивает TTS site-packages."""
import json
import platform
import runpy
import sys
from pathlib import Path
here=Path(__file__).resolve().parent
wheels=here/'wheels'
pip=next(wheels.glob('pip-*.whl'),None)
if not pip:
    raise SystemExit('Нет локального pip wheel в server/gis/wheels; подготовьте комплект на машине с сетью')
if sys.version_info[:2] != (3,12):
    raise SystemExit('Этот автономный набор GIS рассчитан на Python 3.12')
sys.path.insert(0,str(pip))
sys.argv=['pip','install','--no-index','--find-links',str(wheels),'--only-binary=:all:','--upgrade','--target',str(here/'addons'),'-r',str(here/'requirements.txt')]
try:
    runpy.run_module('pip',run_name='__main__')
except SystemExit as e:
    if e.code: raise
sys.path.insert(0,str(here/'addons'))
import rasterio, osmium, PIL
(here/'addons'/'defops-gis-runtime.json').write_text(json.dumps(dict(platform='win32' if sys.platform=='win32' else sys.platform,arch='x64' if platform.machine().lower() in ('amd64','x86_64') else 'arm64',python='3.12')),encoding='utf-8')
print('GIS-runtime готов. Перезапустите приложение.')
