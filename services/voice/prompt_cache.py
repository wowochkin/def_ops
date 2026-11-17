"""Готовые ICL-образцы Qwen: только CPU-тензоры, атомарный safetensors без pickle."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import struct
import threading
import uuid


@dataclass
class PreparedVoice:
    ref_code: object
    ref_spk_embedding: object
    x_vector_only_mode: bool = False
    icl_mode: bool = True
    ref_text: str = ''


def reference_key(path: Path, text: str, identity: str) -> str:
    h = hashlib.sha256()
    h.update(json.dumps([1, identity, text], ensure_ascii=False, separators=(',', ':')).encode())
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()


def _tensors(items, text):
    import torch
    if not isinstance(items, list) or len(items) != 1:
        raise ValueError('ожидается один ICL-образец Qwen')
    item = items[0]
    if item.x_vector_only_mode is not False or item.icl_mode is not True or item.ref_text != text:
        raise ValueError('неожиданный режим подготовленного образца Qwen')
    code, embed = item.ref_code, item.ref_spk_embedding
    if not isinstance(code, torch.Tensor) or not isinstance(embed, torch.Tensor):
        raise ValueError('образец Qwen должен содержать тензоры')
    code, embed = code.detach().cpu().contiguous().clone(), embed.detach().cpu().contiguous().clone()
    if code.ndim != 2 or not code.numel() or code.dtype not in (torch.int64, torch.int32) or (code < 0).any():
        raise ValueError('неверные аудиокоды образца')
    if embed.ndim != 1 or not embed.numel() or embed.dtype not in (torch.bfloat16, torch.float16, torch.float32) or not torch.isfinite(embed).all():
        raise ValueError('неверный speaker embedding образца')
    return {'code': code, 'embedding': embed}


def _digest(tensors):
    import torch
    h = hashlib.sha256()
    for name, tensor in sorted(tensors.items()):
        h.update(json.dumps([name, str(tensor.dtype), list(tensor.shape)], separators=(',', ':')).encode())
        h.update(tensor.view(torch.uint8).numpy().tobytes())
    return h.hexdigest()


def _items(tensors, text):
    return [PreparedVoice(tensors['code'], tensors['embedding'], ref_text=text)]


class PromptCache:
    def __init__(self):
        self._entries = {}
        self._epochs = {}
        self._lock = threading.RLock()
        self._counts = {'created': 0, 'memory_hits': 0, 'disk_hits': 0}

    @staticmethod
    def _file(path):
        return path.with_name(path.name + '.qwen-prompt.safetensors')

    def _read(self, path, key, text):
        from safetensors.torch import load
        file = self._file(path)
        if not file.exists(): return None
        try:
            if file.is_symlink() or file.stat().st_size > 16 * 1024 * 1024:
                raise ValueError('недопустимый файл кэша')
            blob = file.read_bytes()
            header_size = struct.unpack('<Q', blob[:8])[0]
            if header_size > len(blob) - 8: raise ValueError('неполный заголовок кэша')
            meta = json.loads(blob[8:8 + header_size])['__metadata__']
            if meta.get('format') != '1' or meta.get('key') != key or meta.get('text') != text: return None
            tensors = load(blob)  # bytes, не mmap: файл можно заменить/удалить и в Windows
            if set(tensors) != {'code', 'embedding'} or _digest(tensors) != meta['data_sha256']:
                raise ValueError('контрольная сумма кэша не совпала')
            return _items(_tensors(_items(tensors, text), text), text)
        except Exception as error:
            print('[voice-prompt-cache] файл будет пересоздан: ' + str(error), flush=True)
            return None

    def _write(self, path, key, text, tensors):
        from safetensors.torch import save
        file = self._file(path)
        temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            blob = save(tensors, metadata={'format': '1', 'key': key, 'text': text, 'data_sha256': _digest(tensors)})
            with temporary.open('xb') as out:
                out.write(blob); out.flush(); os.fsync(out.fileno())
            os.replace(temporary, file)
        except Exception as error:
            print('[voice-prompt-cache] запись на диск недоступна; CPU-кэш сохранён: ' + str(error), flush=True)
        finally:
            try: temporary.unlink(missing_ok=True)
            except OSError: pass

    def get(self, path, text, identity, create):
        path = Path(path).resolve()
        with self._lock:
            epoch = self._epochs.get(path, 0)
        key = reference_key(path, text, identity)
        with self._lock:
            valid = self._epochs.get(path, 0) == epoch
            cached = self._entries.get(path) if valid else None
            if cached is not None and cached[0] == key:
                self._counts['memory_hits'] += 1
                return cached[1]
            cached = self._read(path, key, text) if valid else None
            if cached is not None:
                self._entries[path] = (key, cached)
                self._counts['disk_hits'] += 1
                print('[voice-prompt-cache] disk hit', flush=True)
                return cached
        # Долгая CUDA-подготовка вне lock: удаление образца не блокирует asyncio/UI.
        tensors = _tensors(create(), text)
        prepared = _items(tensors, text)
        with self._lock:
            self._counts['created'] += 1
            try: unchanged = reference_key(path, text, identity) == key
            except OSError: unchanged = False
            if self._epochs.get(path, 0) == epoch and unchanged:
                self._entries[path] = (key, prepared)
                self._write(path, key, text, tensors)
        print('[voice-prompt-cache] prepared on CPU', flush=True)
        return prepared

    def forget(self, path):
        path = Path(path).resolve()
        with self._lock:
            self._epochs[path] = self._epochs.get(path, 0) + 1
            self._entries.pop(path, None)
            try: self._file(path).unlink(missing_ok=True)
            except OSError as error: print('[voice-prompt-cache] не удалось удалить кэш: ' + str(error), flush=True)

    def info(self):
        with self._lock:
            return dict(self._counts, voices=len(self._entries), device='cpu')
