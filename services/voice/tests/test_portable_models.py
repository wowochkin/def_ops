"""Офлайн-комплект не использует глобальные веса и не подменяет сохранённый выбор."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from engines import EngineStore
from models import Models
from runtime import selected_engine


def test_portable_default_does_not_replace_saved_engine(tmp_path, monkeypatch):
    monkeypatch.setenv('DEFOPS_VOICE_DEFAULT_ENGINE', 'qwen3-ru-stress')
    store = EngineStore(tmp_path)
    assert selected_engine(store, 'mlx') == 'qwen3-ru-stress'
    store.set('qwen3-1.7b')
    assert selected_engine(store, 'mlx') == 'qwen3-1.7b'
    with pytest.raises(ValueError, match='сохранена модель'):
        Models(selected_engine(store, 'mlx'), models_dir=tmp_path, offline=True)


def test_missing_asr_never_downloads(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, 'gigaam', SimpleNamespace(load_model=lambda *a, **k: calls.append(k)))
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(set_num_threads=lambda n: None))
    monkeypatch.setitem(sys.modules, 'silero_vad', SimpleNamespace(load_silero_vad=lambda: None))
    model = Models('qwen3-ru-stress', models_dir=tmp_path, offline=True)
    with pytest.raises(FileNotFoundError, match='автономных весов'):
        model._load_torch()
    assert calls == []


def test_local_asr_passes_explicit_download_root(tmp_path, monkeypatch):
    root = tmp_path / 'gigaam'; root.mkdir()
    for name in ('v3_e2e_rnnt.ckpt', 'v3_e2e_rnnt_tokenizer.model'):
        (root / name).touch()
    calls = []
    asr = SimpleNamespace(transcribe=lambda path: '')
    monkeypatch.setitem(sys.modules, 'gigaam', SimpleNamespace(load_model=lambda *a, **k: (calls.append(k) or asr)))
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(set_num_threads=lambda n: None))
    monkeypatch.setitem(sys.modules, 'silero_vad', SimpleNamespace(load_silero_vad=lambda: None))
    model = Models('qwen3-ru-stress', models_dir=tmp_path, offline=True)
    monkeypatch.setattr(model, '_silence_wav', lambda: tmp_path / 'silence.wav')
    model._load_torch()
    assert calls == [{'device': 'mps', 'download_root': str(root)}]
    with pytest.raises(ValueError, match='нет модели'):
        model.switch_tts('qwen3-1.7b')
    assert model.engine.id == 'qwen3-ru-stress'


def test_mlx_loads_both_models_by_local_path(tmp_path, monkeypatch):
    root = tmp_path / 'Комплект 1943'
    calls = []
    synth = SimpleNamespace(sample_rate=24000)
    monkeypatch.setitem(sys.modules, 'mlx_audio.tts.utils', SimpleNamespace(load_model=lambda path: (calls.append(('tts', path)) or synth)))
    monkeypatch.setitem(sys.modules, 'mlx_audio.vad', SimpleNamespace(load=lambda path: (calls.append(('turn', path)) or object())))
    monkeypatch.setitem(sys.modules, 'tts_tail', SimpleNamespace(extend_eos=lambda tts, extra: lambda: None))
    model = Models('qwen3-ru-stress', models_dir=root, offline=True)
    model._load_mlx()
    assert calls == [('turn', str(root / 'smart-turn')), ('tts', str(root / 'qwen3-ru-stress'))]
    assert model.supported_engines == ('qwen3-ru-stress',)


def test_windows_preparation_reuses_checked_asr_without_network(tmp_path, monkeypatch):
    import hashlib
    import prepare_models
    cache = tmp_path / 'cache'; cache.mkdir()
    (cache / 'v3_e2e_rnnt.ckpt').write_bytes(b'checkpoint')
    (cache / 'v3_e2e_rnnt_tokenizer.model').write_bytes(b'tokenizer')
    monkeypatch.setattr(prepare_models, 'ASR_MD5', hashlib.md5(b'checkpoint').hexdigest())
    monkeypatch.setattr(prepare_models, 'write_manifest', lambda root: None)
    monkeypatch.setattr(prepare_models, 'download_file', lambda *args: pytest.fail('GigaAM не должен скачиваться'))
    monkeypatch.setitem(sys.modules, 'huggingface_hub', SimpleNamespace(snapshot_download=lambda *a, **k: None,
                                                                     hf_hub_download=lambda *a, **k: None))
    target = tmp_path / 'bundle'
    prepare_models.prepare(target, cache)
    assert (target / 'gigaam/v3_e2e_rnnt.ckpt').read_bytes() == b'checkpoint'
    assert (target / 'gigaam/v3_e2e_rnnt_tokenizer.model').read_bytes() == b'tokenizer'
    (cache / 'v3_e2e_rnnt.ckpt').write_bytes(b'corrupted')
    with pytest.raises(ValueError, match='контрольная сумма'):
        prepare_models.prepare(target, cache)
