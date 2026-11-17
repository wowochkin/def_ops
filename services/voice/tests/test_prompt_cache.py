"""Подготовленные голоса переживают выгрузку модели и перезапуск без повторного кодирования."""
import gc
import os
import threading
import weakref
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
import torch

from models_torch import TorchModels
from tests.test_windows_models import model_files


@dataclass
class Prompt:
    ref_code: object
    ref_spk_embedding: object
    x_vector_only_mode: bool = False
    icl_mode: bool = True
    ref_text: str = 'Образец'


def prompt(text='Образец'):
    return [Prompt(torch.arange(32, dtype=torch.int64).reshape(2, 16),
                   torch.tensor([0.25, -0.5, 1.0], dtype=torch.bfloat16), ref_text=text)]


def model(tmp_path, calls):
    root = tmp_path / 'models'
    m = TorchModels(models_dir=root if root.exists() else model_files(root))
    class Synth:
        def create_voice_clone_prompt(self, **kw):
            calls.append(kw)
            return prompt(kw['ref_text'])
        def generate_voice_clone(self, **kw):
            p = kw['voice_clone_prompt'][0]
            assert p.ref_code.device.type == p.ref_spk_embedding.device.type == 'cpu'
            assert p.ref_code.tolist() == [list(range(16)), list(range(16, 32))]
            assert p.ref_spk_embedding.dtype == torch.bfloat16
            assert p.ref_spk_embedding.float().tolist() == [0.25, -0.5, 1.0]
            return [np.ones(16)], 24000
    m._load_tts = lambda: setattr(m, 'tts', Synth())
    return m


def test_three_voices_reused_after_unload_and_new_service(tmp_path):
    calls = []
    m = model(tmp_path, calls)
    refs = []
    for name in ('chief', 'zhukov', 'konev'):
        path = tmp_path / name / 'ref.wav'; path.parent.mkdir(); path.write_bytes(name.encode())
        refs.append((path, 'Текст ' + name))
    for ref in refs:
        m.load_tts_resource(ref)
    original = weakref.ref(m.tts)
    m.unload_tts_resource(); gc.collect()
    assert m.tts is None and original() is None
    for ref in reversed(refs):
        m.load_tts_resource(ref)
    assert len(calls) == 3, 'каждый из трёх голосов должен кодироваться ровно один раз'
    m.unload_tts_resource()
    restarted_calls = []
    restarted = model(tmp_path, restarted_calls)
    for ref in refs:
        restarted.load_tts_resource(ref)
    assert restarted_calls == [], 'после перезапуска образцы должны читаться с диска'


def test_changed_audio_same_stat_and_changed_text_rebuild_only_that_voice(tmp_path):
    calls = []; m = model(tmp_path, calls)
    path = tmp_path / 'ref.wav'; path.write_bytes(b'one')
    m.load_tts_resource((path, 'Текст'))
    stamp = path.stat(); path.write_bytes(b'two'); os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    m.load_tts_resource((path, 'Текст'))
    m.load_tts_resource((path, 'Другой текст'))
    assert [c['ref_text'] for c in calls] == ['Текст', 'Текст', 'Другой текст']


def test_cpu_cache_disk_corruption_identity_change_and_unwritable_disk(tmp_path, monkeypatch):
    from prompt_cache import PromptCache
    path = tmp_path / 'ref.wav'; path.write_bytes(b'voice')
    calls = []
    def create(): calls.append(1); return prompt()
    cache = PromptCache()
    first = cache.get(path, 'Образец', 'model-v1', create)
    assert first[0].ref_spk_embedding.dtype == torch.bfloat16
    assert len(calls) == 1
    assert PromptCache().get(path, 'Образец', 'model-v1', create)[0].ref_code.tolist() == [list(range(16)), list(range(16,32))]
    assert len(calls) == 1
    stored = list(tmp_path.glob('*.safetensors')); assert len(stored) == 1
    blob = bytearray(stored[0].read_bytes()); blob[-1] ^= 1; stored[0].write_bytes(blob)
    PromptCache().get(path, 'Образец', 'model-v1', create)
    assert len(calls) == 2
    PromptCache().get(path, 'Образец', 'model-v2', create)
    assert len(calls) == 3
    monkeypatch.setattr(os, 'replace', lambda *a: (_ for _ in ()).throw(PermissionError('read-only')))
    cache = PromptCache()
    cache.get(path, 'Образец', 'model-v3', create)
    cache.get(path, 'Образец', 'model-v3', create)
    assert len(calls) == 4, 'отказ диска не должен мешать CPU-кэшу и синтезу'


def test_forget_during_preparation_does_not_resurrect_cache(tmp_path):
    from prompt_cache import PromptCache
    path = tmp_path / 'ref.wav'; path.write_bytes(b'voice')
    cache = PromptCache(); started = threading.Event(); resume = threading.Event(); result = []
    def create(): started.set(); assert resume.wait(5); return prompt()
    thread = threading.Thread(target=lambda: result.append(cache.get(path, 'Образец', 'v1', create)))
    thread.start()
    try:
        assert started.wait(3)
        cache.forget(path)
    finally:
        resume.set(); thread.join(5)
    assert not thread.is_alive() and result
    assert not list(tmp_path.glob('*.safetensors'))
    calls = []
    cache.get(path, 'Образец', 'v1', lambda: calls.append(1) or prompt())
    assert calls == [1]
    cache.forget(path)
    assert not list(tmp_path.glob('*.safetensors'))


def test_changed_weight_identity_invalidates_disk_prompt(tmp_path):
    calls = []; m = model(tmp_path, calls)
    path = tmp_path / 'ref.wav'; path.write_bytes(b'voice')
    m.load_tts_resource((path, 'Текст')); m.unload_tts_resource()
    weight = tmp_path / 'models/qwen3-ru-stress/model.safetensors'
    weight.write_bytes(b'new-weights')
    m.load_tts_resource((path, 'Текст'))
    assert len(calls) == 2


@pytest.mark.skipif(not torch.backends.mps.is_available(), reason='нет MPS для проверки переноса GPU→CPU')
def test_cache_does_not_keep_original_gpu_tensor_alive(tmp_path):
    from prompt_cache import PromptCache
    path = tmp_path / 'ref.wav'; path.write_bytes(b'voice')
    gpu_refs = []
    def create():
        p = Prompt(torch.zeros((2,16), dtype=torch.int64, device='mps'), torch.ones(4, device='mps'))
        gpu_refs.append(weakref.ref(p.ref_spk_embedding))
        return [p]
    cached = PromptCache().get(path, 'Образец', 'model-v1', create)
    gc.collect()
    assert cached[0].ref_code.device.type == cached[0].ref_spk_embedding.device.type == 'cpu'
    assert gpu_refs[0]() is None


def test_forget_between_source_hash_and_cache_lock_does_not_resurrect(tmp_path,monkeypatch):
    import prompt_cache
    path=tmp_path/'ref.wav';path.write_bytes(b'voice')
    cache=prompt_cache.PromptCache();original=prompt_cache.reference_key;calls=[]
    def key(*args):
        value=original(*args)
        if not calls:calls.append(1);cache.forget(path)
        return value
    monkeypatch.setattr(prompt_cache,'reference_key',key)
    cache.get(path,'Образец','v1',prompt)
    assert cache.info()['voices']==0
    assert not list(tmp_path.glob('*.safetensors'))
