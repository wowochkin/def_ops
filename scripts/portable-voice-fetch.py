#!/usr/bin/env python3
"""Сборочная загрузка закреплённых wheels macOS 14 (не запуск конечного пользователя).
python scripts/portable-voice-fetch.py --output release/staging/voice-sources
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import ssl
import urllib.request

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args()
lock=json.loads(Path(__file__).with_name('portable-voice-sources.json').read_text())
a.output.mkdir(parents=True,exist_ok=True)
try:
 import certifi
 context=ssl.create_default_context(cafile=certifi.where())
except ImportError:
 context=ssl.create_default_context()
for item in lock['files']:
 target=a.output/item['name']
 if target.is_file():
  with target.open('rb') as f:
   if hashlib.file_digest(f,'sha256').hexdigest()==item['sha256']:continue
 tmp=target.with_suffix('.part')
 with urllib.request.urlopen(item['url'],context=context,timeout=120) as src,tmp.open('wb') as dst:shutil.copyfileobj(src,dst)
 with tmp.open('rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
 if actual!=item['sha256']:raise RuntimeError('SHA256 не совпал: '+item['name'])
 tmp.replace(target)
print(json.dumps({'ok':True,'files':len(lock['files'])}))
