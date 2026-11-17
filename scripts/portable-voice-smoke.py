#!/usr/bin/env python3
"""Реальный автономный smoke: запускать Python из runtime с --runtime/--service/--reference/--output.
Отключает любые исходящие соединения Python; проверяет VAD, Smart Turn, синтез и распознавание.
GPU/MLX загружаются только по явному запуску этого скрипта; работающий стенд не затрагивается.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--runtime', type=Path, required=True)
p.add_argument('--service', type=Path, required=True)
p.add_argument('--reference', type=Path, required=True)
p.add_argument('--reference-text', required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_DATASETS_OFFLINE='1',
    PYTHONDONTWRITEBYTECODE='1', HF_HOME=str(a.output/'cache/hf'), XDG_CACHE_HOME=str(a.output/'cache'),
    NUMBA_CACHE_DIR=str(a.output/'cache/numba'), TORCH_HOME=str(a.output/'cache/torch'))

def blocked(*args, **kwargs):
    raise RuntimeError('Smoke запрещает сеть: ' + repr(args))
socket.socket.connect = blocked
socket.create_connection = blocked
socket.getaddrinfo = blocked
sys.path.insert(0, str(a.service.resolve()))
import numpy as np
from voices import write_wav
from aec import EchoCanceller
aec = EchoCanceller()
frame = np.zeros(512, np.float32)
assert np.isfinite(aec.process(frame, frame)).all()
from runtime import select_backend
if select_backend() == 'torch':
    from models_torch import TorchModels as Models
else:
    from models import Models
started = time.monotonic()
m = Models('qwen3-ru-stress', models_dir=a.runtime.resolve()/'models/voice', offline=True)
m.load()
vad = m.vad_prob(np.zeros(512, np.float32))
turn = m.mlx.submit(m.turn_complete, np.zeros(16000, np.float32)).result()
text = 'Проверка свя́зи. Штаб гото́в к рабо́те.'
chunks = m.mlx.submit(lambda: list(m.tts_stream(text, (a.reference.resolve(), a.reference_text)))).result()
audio = np.concatenate(chunks)
assert len(audio) > m.sample_rate and np.isfinite(audio).all() and float(np.max(np.abs(audio))) > .001
wav = a.output/'synthesis.wav'; write_wav(wav, audio, m.sample_rate)
recognized = m.torch.submit(m._asr_file, wav).result()
assert recognized.strip(), 'Распознавание вернуло пустую строку'
result = {'ok': True, 'network': 'python-sockets-blocked', 'runtime': str(a.runtime.resolve()),
          'python': sys.executable, 'seconds': len(audio)/m.sample_rate, 'elapsed_seconds': round(time.monotonic()-started, 2),
          'aec_native': True, 'vad_silence': vad, 'turn_silence': turn, 'recognized': recognized, 'audio': str(wav.resolve())}
(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2), encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
m.mlx.shutdown(); m.torch.shutdown()
