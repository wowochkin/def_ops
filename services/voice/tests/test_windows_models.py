"""Windows/CUDA: контракт проверяется без GPU, MLX и загрузки весов из сети."""
import json
import sys
from types import SimpleNamespace

import numpy as np
import pytest
from unittest.mock import Mock
from tests.prompt_helpers import sample_prompt


def test_backend_choice_preserves_mac_and_selects_windows():
    from runtime import select_backend
    assert select_backend("auto", "darwin") == "mlx"
    assert select_backend("auto", "win32") == "torch"
    assert select_backend("mlx", "win32") == "mlx"
    with pytest.raises(ValueError):
        select_backend("other", "win32")


def test_windows_default_does_not_rewrite_saved_engine(tmp_path):
    from runtime import selected_engine
    from engines import EngineStore
    store = EngineStore(tmp_path)
    assert selected_engine(store, "torch") == "qwen3-ru-stress"
    assert selected_engine(store, "mlx") == "qwen3-1.7b"
    store.set("fish-s2-pro")
    with pytest.raises(ValueError, match="fish-s2-pro"):
        selected_engine(store, "torch")
    assert store.get() == "fish-s2-pro"


def test_cli_offline_contract(monkeypatch, tmp_path):
    from server import parse_args
    monkeypatch.setenv("DEFOPS_VOICE_BACKEND", "torch")
    monkeypatch.setenv("DEFOPS_VOICE_OFFLINE", "1")
    monkeypatch.setenv("DEFOPS_VOICE_MODELS", str(tmp_path))
    a = parse_args(["--data", str(tmp_path / "data")])
    assert (a.backend, a.offline, a.models_dir) == ("torch", True, str(tmp_path))


def model_files(tmp_path):
    from windows_assets import REQUIRED_FILES
    for name in REQUIRED_FILES:
        f = tmp_path / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("{}")
    return tmp_path


def test_missing_local_weights_fail_before_model_import(tmp_path):
    from models_torch import TorchModels
    m = TorchModels(models_dir=tmp_path, offline=True)
    with pytest.raises(FileNotFoundError, match="prepare_models.py"):
        m.load()


def fake_torch(monkeypatch, available=True):
    cuda = SimpleNamespace(is_available=lambda: available, is_bf16_supported=lambda: True,
                           empty_cache=lambda: None)
    import torch
    monkeypatch.setattr(torch, 'cuda', cuda)
    monkeypatch.setattr(torch, 'set_num_threads', lambda n: None)
    return torch


def test_cuda_clone_matches_prerecord_full_text_and_icl_repetition_policy(monkeypatch, tmp_path):
    from models_torch import TorchModels
    model_files(tmp_path)
    fake_torch(monkeypatch)
    calls = []
    synth = SimpleNamespace(create_voice_clone_prompt=lambda **kw: sample_prompt(kw['ref_text']),
                            generate_voice_clone=lambda **kw: (calls.append(kw) or [np.ones(48)], 24000))
    loader = SimpleNamespace(from_pretrained=lambda path, **kw: (calls.append((path, kw)) or synth))
    monkeypatch.setitem(sys.modules, "qwen_tts", SimpleNamespace(Qwen3TTSModel=loader))
    m = TorchModels(models_dir=tmp_path, offline=True)
    m._load_tts()
    path, kw = calls[0]
    assert path == str(tmp_path / "qwen3-ru-stress")
    import torch
    assert kw == {"device_map": "cuda:0", "dtype": torch.bfloat16, "attn_implementation": "sdpa", "local_files_only": True}
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"local")
    audio = list(m.tts_stream("Ке́тцин и Торга́у", (ref, "Текст образца")))
    prepared = calls[1]['voice_clone_prompt']
    assert prepared[0].ref_text == 'Текст образца' and prepared[0].ref_code.device.type == 'cpu'
    assert calls[1] == {"text": "Ке́тцин и Торга́у", "language": "Russian", "voice_clone_prompt": prepared, "temperature": 0.2, "subtalker_temperature": 0.2,
                        "non_streaming_mode": True, "repetition_penalty": 1.5}
    assert len(audio) == 1 and audio[0].dtype == np.float32
    assert m.sample_rate == 24000


def test_cuda_absence_is_error_not_silent_cpu_or_other_model(monkeypatch, tmp_path):
    from models_torch import TorchModels
    model_files(tmp_path)
    fake_torch(monkeypatch, available=False)
    m = TorchModels(models_dir=tmp_path)
    with pytest.raises(RuntimeError, match="CUDA"):
        m._load_tts()


def test_qwen_stays_loaded_between_phrases_and_voice_samples(monkeypatch, tmp_path):
    from models_torch import TorchModels
    model_files(tmp_path)
    torch = fake_torch(monkeypatch)
    torch.cuda.empty_cache = Mock()
    synth = SimpleNamespace(create_voice_clone_prompt=lambda **kw: sample_prompt(kw['ref_text']),
                            generate_voice_clone=Mock(return_value=([np.ones(48)], 24000)))
    loader = Mock(return_value=synth)
    monkeypatch.setitem(sys.modules, "qwen_tts", SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=loader)))
    m = TorchModels(models_dir=tmp_path, offline=True)
    m._load_tts()
    first, second = tmp_path / "zhukov.wav", tmp_path / "konev.wav"
    first.write_bytes(b"zhukov")
    second.write_bytes(b"konev")
    list(m.tts_stream("Первое решение выполнено.", (first, "Образец Жукова")))
    m.switch_tts("qwen3-ru-stress")
    list(m.tts_stream("Второе решение выполнено.", (second, "Образец Конева")))
    assert m.tts is synth
    assert loader.call_count == 1
    assert synth.generate_voice_clone.call_count == 2
    torch.cuda.empty_cache.assert_not_called()


def test_unsupported_engine_does_not_unload_running_model(tmp_path):
    from models_torch import TorchModels
    m = TorchModels(models_dir=tmp_path)
    running = object()
    m.tts = running
    with pytest.raises(ValueError, match="fish-s2-pro"):
        m.switch_tts("fish-s2-pro")
    assert m.tts is running and m.engine.id == "qwen3-ru-stress"


def test_smart_turn_uses_cpu_and_keeps_last_eight_seconds(monkeypatch, tmp_path):
    from models_torch import OnnxTurn
    calls = []
    onnx = SimpleNamespace(SessionOptions=lambda: SimpleNamespace(),
                           ExecutionMode=SimpleNamespace(ORT_SEQUENTIAL=0),
                           GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL=99))
    def session(path, **kw):
        calls.append((path, kw))
        return SimpleNamespace(run=lambda _, x: (calls.append(x) or [np.array([[0.8]])]))
    onnx.InferenceSession = session
    def extractor(**kw):
        assert kw == {"chunk_length": 8}
        def extract(a, **options):
            calls.append((a.copy(), options))
            return SimpleNamespace(input_features=np.zeros((1, 80, 800)))
        return extract
    monkeypatch.setitem(sys.modules, "onnxruntime", onnx)
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(WhisperFeatureExtractor=extractor))
    model = tmp_path / "turn.onnx"
    model.write_bytes(b"local")
    turn = OnnxTurn(model)
    assert calls[0][1]["providers"] == ["CPUExecutionProvider"]
    assert turn.predict(np.arange(16000 * 10, dtype=np.float32)) == pytest.approx(0.8)
    assert np.array_equal(calls[1][0], np.arange(16000 * 2, 16000 * 10, dtype=np.float32))
    turn.predict(np.ones(16000, np.float32))
    assert np.array_equal(calls[3][0], np.r_[np.zeros(16000 * 7), np.ones(16000)])


def test_offline_manifest_rejects_missing_and_changed_files(tmp_path):
    from windows_assets import write_manifest, verify_manifest
    model_files(tmp_path)
    write_manifest(tmp_path)
    assert verify_manifest(tmp_path)["engine"] == "qwen3-ru-stress"
    (tmp_path / "gigaam/v3_e2e_rnnt.ckpt").write_bytes(b"changed")
    with pytest.raises(ValueError, match="gigaam"):
        verify_manifest(tmp_path)


def test_check_command_never_prepares_or_imports_huggingface(monkeypatch, tmp_path, capsys):
    import prepare_models
    from windows_assets import write_manifest
    model_files(tmp_path)
    write_manifest(tmp_path)
    monkeypatch.setattr(prepare_models, "prepare", lambda _: pytest.fail("check attempted download"))
    monkeypatch.setitem(sys.modules, "huggingface_hub", None)
    assert prepare_models.main(["--check", "--models-dir", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True
    (tmp_path / "qwen3-ru-stress/model.safetensors").unlink()
    assert prepare_models.main(["--check", "--models-dir", str(tmp_path)]) == 1


def test_asr_uses_only_cpu_and_prepared_cache(monkeypatch, tmp_path):
    from models_torch import TorchModels
    model_files(tmp_path)
    fake_torch(monkeypatch)
    calls = []
    monkeypatch.setitem(sys.modules, "gigaam", SimpleNamespace(load_model=lambda *a, **kw: calls.append((a, kw))))
    monkeypatch.setitem(sys.modules, "silero_vad", SimpleNamespace(load_silero_vad=lambda: object()))
    m = TorchModels(models_dir=tmp_path)
    m._load_torch()
    assert calls == [(("v3_e2e_rnnt",), {"device": "cpu", "fp16_encoder": False, "use_flash": False,
                                        "download_root": str(tmp_path / "gigaam")})]


def test_offline_environment_is_set_before_imports(monkeypatch, tmp_path):
    from models_torch import TorchModels
    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"):
        monkeypatch.delenv(name, raising=False)
    TorchModels(models_dir=tmp_path, offline=True)
    import os
    assert os.environ["HF_HUB_OFFLINE"] == os.environ["TRANSFORMERS_OFFLINE"] == "1"


def test_managed_startup_skips_tts_and_warm(monkeypatch, tmp_path):
    from models_torch import TorchModels
    from torch_profile import TorchProfile
    model_files(tmp_path)
    m = TorchModels(models_dir=tmp_path, profile=TorchProfile(managed=True))
    m._load_torch = Mock()
    m._load_mlx = Mock()
    m.tts_stream = Mock(side_effect=AssertionError('unexpected warm'))
    m.load((tmp_path / 'ref.wav', 'sample'))
    m._load_mlx.assert_called_once()
    m.tts_stream.assert_not_called()


def test_resident_nf4_startup_finishes_warmup_and_reuses_weights(monkeypatch, tmp_path):
    from models import WARM_TEXT
    from models_torch import TorchModels
    from torch_profile import TorchProfile
    model_files(tmp_path)
    fake_torch(monkeypatch)
    events = []
    synth = SimpleNamespace(
        create_voice_clone_prompt=lambda **kw: sample_prompt(kw['ref_text']),
        generate_voice_clone=lambda **kw: (events.append(kw['text']) or [np.ones(48)], 24000))
    def load(path, **kw):
        assert kw['quantization_config']['load_in_4bit'] is True
        events.append('загрузка NF4')
        return synth
    monkeypatch.setitem(sys.modules, 'qwen_tts', SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=load)))
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(BitsAndBytesConfig=lambda **kw: kw))
    monkeypatch.setattr('models_torch.OnnxTurn', lambda _: object())
    m = TorchModels(models_dir=tmp_path, profile=TorchProfile(False, 'nf4', 'sdpa'))
    m._load_torch = lambda: None  # отдельные CPU-модели распознавания не нужны для этого контракта
    ref = tmp_path / 'ref.wav'; ref.write_bytes(b'voice')
    try:
        m.load((ref, 'Образец'))
        assert events == ['загрузка NF4', WARM_TEXT]
        assert m.runtime_info()['resident'] and not m.runtime_info()['managed']
        for text in ('Первый комментарий.', 'Второй комментарий.', 'Третий комментарий.'):
            assert len(list(m.tts_stream(text, (ref, 'Образец')))) == 1
        assert events.count('загрузка NF4') == events.count(WARM_TEXT) == 1
        assert m.tts is synth
    finally:
        m.mlx.shutdown(); m.torch.shutdown()


def test_nf4_and_prompt_cache_and_unload(monkeypatch, tmp_path):
    from models_torch import TorchModels
    from torch_profile import TorchProfile
    model_files(tmp_path)
    fake_torch(monkeypatch)
    configs = []
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(BitsAndBytesConfig=lambda **kw: configs.append(kw) or kw))
    synth = SimpleNamespace(create_voice_clone_prompt=Mock(side_effect=lambda **kw: sample_prompt(kw['ref_text'])),
                            generate_voice_clone=Mock(return_value=([np.ones(48)], 24000)))
    loader = Mock(return_value=synth)
    monkeypatch.setitem(sys.modules, 'qwen_tts', SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=loader)))
    m = TorchModels(models_dir=tmp_path, profile=TorchProfile(True, 'nf4', 'sdpa'))
    ref = tmp_path / 'ref.wav'
    ref.write_bytes(b'voice')
    m.load_tts_resource((ref, 'text'))
    list(m.tts_stream('next', (ref, 'text')))
    assert synth.create_voice_clone_prompt.call_count == 1
    assert synth.generate_voice_clone.call_args.kwargs['voice_clone_prompt'][0].ref_text == 'text'
    assert configs[0]['load_in_4bit'] and configs[0]['bnb_4bit_quant_type'] == 'nf4'
    patterns = configs[0]['llm_int8_skip_modules']
    for name in ('speaker_encoder.layers.0.linear', 'talker.code_predictor.layers.0.linear',
                 'speech_tokenizer.encoder.linear', 'talker.lm_head'):
        assert any(key + "." in name or key == name or name.split(".")[-1] == key for key in patterns)
    m.unload_tts_resource()
    assert m.tts is None and m.runtime_info()['prompt_cache']['voices'] == 1


def test_resource_error_is_visible_without_fallback(monkeypatch, tmp_path):
    from models_torch import TorchModels
    from torch_profile import TorchProfile
    model_files(tmp_path)
    fake_torch(monkeypatch)
    monkeypatch.setitem(sys.modules, 'qwen_tts', SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=Mock())))
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(BitsAndBytesConfig=Mock(side_effect=RuntimeError('bitsandbytes unavailable'))))
    m = TorchModels(models_dir=tmp_path, profile=TorchProfile(True, 'nf4', 'sdpa'))
    with pytest.raises(RuntimeError, match='bitsandbytes unavailable'):
        m.load_tts_resource()
    assert m.tts is None and m.phase == 'error'


def test_prompt_invalidates_for_changed_text_and_unload(monkeypatch, tmp_path):
    from models_torch import TorchModels
    from torch_profile import TorchProfile
    model_files(tmp_path)
    fake_torch(monkeypatch)
    synth = SimpleNamespace(create_voice_clone_prompt=Mock(side_effect=lambda **kw: sample_prompt(kw['ref_text'])),
                            generate_voice_clone=Mock(return_value=([np.ones(8)], 24000)))
    monkeypatch.setitem(sys.modules, 'qwen_tts', SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=Mock(return_value=synth))))
    m = TorchModels(models_dir=tmp_path, profile=TorchProfile(True))
    ref = tmp_path / 'ref.wav'
    ref.write_bytes(b'a')
    m.load_tts_resource((ref, 'a'))
    m.load_tts_resource((ref, 'a'))
    assert synth.create_voice_clone_prompt.call_count == 1
    list(m.tts_stream('text', (ref, 'b')))
    assert synth.create_voice_clone_prompt.call_count == 2
    m.unload_tts_resource()
    m.load_tts_resource((ref, 'b'))
    assert synth.create_voice_clone_prompt.call_count == 2


def test_addons_added_before_loading_dependencies(monkeypatch, tmp_path):
    from models_torch import TorchModels
    root = tmp_path / 'models' / 'voice'
    addon = tmp_path / 'addons' / 'voice-gpu'
    addon.mkdir(parents=True)
    monkeypatch.setattr(sys, 'path', list(sys.path))
    TorchModels(models_dir=root)
    assert sys.path[0] == str(addon)


def test_addons_override_does_not_use_active_directory(monkeypatch, tmp_path):
    from models_torch import TorchModels
    active = tmp_path / 'addons' / 'voice-gpu'
    active.mkdir(parents=True)
    staging = tmp_path / 'staging'
    staging.mkdir()
    monkeypatch.setenv('DEFOPS_VOICE_GPU_ADDONS', str(staging))
    monkeypatch.setattr(sys, 'path', list(sys.path))
    TorchModels(models_dir=tmp_path / 'models' / 'voice')
    assert sys.path[0] == str(staging) and str(active) not in sys.path


@pytest.mark.parametrize("quantization", ["nf4", "int8"])
def test_pinned_wheel_tokenizer_receives_unconverted_codec_roots(monkeypatch, tmp_path, quantization):
    """Исполняем реальные методы двух загрузчиков qwen-tts 0.1.1, без CUDA."""
    import ast
    import zipfile
    from pathlib import Path
    from models_torch import TorchModels
    from torch_profile import TorchProfile

    wheel = Path(__file__).resolve().parents[3] / 'release/windows-preparation/inputs/wheels/qwen_tts-0.1.1-py3-none-any.whl'
    if not wheel.exists():
        pytest.skip('нет закреплённого qwen-tts wheel')
    def method_source(path, classname):
        with zipfile.ZipFile(wheel) as z:
            tree = ast.parse(z.read(path))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == classname)
        method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'from_pretrained')
        return method

    config = tmp_path / 'generation_config.json'
    config.write_text('{}')
    (tmp_path / 'speech_tokenizer').mkdir()
    (tmp_path / 'speech_tokenizer' / 'config.json').write_text('{}')
    seen = []
    registry = SimpleNamespace(register=lambda *a: None)
    def auto_load(path, **kw):
        seen.append((path, kw))
        return SimpleNamespace(config=object(), device='cuda:0')
    fake_auto = SimpleNamespace(register=lambda *a: None, from_pretrained=auto_load)
    env = {'__builtins__': __builtins__, 'os': __import__('os'), 'json': json,
           'cached_file': lambda root, name, **kw: str(tmp_path / name),
           'AutoConfig': registry, 'AutoModel': fake_auto,
           'AutoFeatureExtractor': SimpleNamespace(from_pretrained=lambda _: object()),
           'Qwen3TTSTokenizerV1Config': object, 'Qwen3TTSTokenizerV1Model': object,
           'Qwen3TTSTokenizerV2Config': object, 'Qwen3TTSTokenizerV2Model': object}
    tokenizer_method = method_source('qwen_tts/inference/qwen3_tts_tokenizer.py', 'Qwen3TTSTokenizer')
    tokenizer_method.returns = None
    tokenizer_class = ast.ClassDef(name='Qwen3TTSTokenizer', bases=[], keywords=[],
                                  body=[tokenizer_method], decorator_list=[])
    exec(compile(ast.fix_missing_locations(ast.Module(body=[tokenizer_class], type_ignores=[])), '<wheel tokenizer>', 'exec'), env)
    class Base:
        @classmethod
        def from_pretrained(cls, path, *args, **kw):
            seen.append((path, kw))
            return SimpleNamespace(load_speech_tokenizer=lambda _: None, load_generate_config=lambda _: None)
    env['Base'] = Base
    core_method = method_source('qwen_tts/core/models/modeling_qwen3_tts.py', 'Qwen3TTSForConditionalGeneration')
    core_class = ast.ClassDef(name='Core', bases=[ast.Name(id='Base', ctx=ast.Load())], keywords=[],
                              body=[core_method], decorator_list=[])
    exec(compile(ast.fix_missing_locations(ast.Module(body=[core_class], type_ignores=[])), '<wheel core>', 'exec'), env)
    fake_torch(monkeypatch)
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(BitsAndBytesConfig=lambda **kw: SimpleNamespace(**kw)))
    monkeypatch.setitem(sys.modules, 'qwen_tts', SimpleNamespace(Qwen3TTSModel=env['Core']))
    model_files(tmp_path)
    m = TorchModels(models_dir=tmp_path, profile=TorchProfile(True, quantization, 'sdpa'))
    m._load_tts()
    assert len(seen) == 2
    codec_kwargs = seen[1][1]
    import torch
    assert codec_kwargs['dtype'] == torch.bfloat16
    skip = codec_kwargs['quantization_config'].llm_int8_skip_modules
    for path, classname in (
        ('qwen_tts/core/tokenizer_12hz/modeling_qwen3_tts_tokenizer_v2.py', 'Qwen3TTSTokenizerV2Model'),
        ('qwen_tts/core/tokenizer_25hz/modeling_qwen3_tts_tokenizer_v1.py', 'Qwen3TTSTokenizerV1Model'),
    ):
        with zipfile.ZipFile(wheel) as z:
            tree = ast.parse(z.read(path))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == classname)
        init = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '__init__')
        roots = {n.targets[0].attr for n in init.body if isinstance(n, ast.Assign)
                 and len(n.targets) == 1 and isinstance(n.targets[0], ast.Attribute)
                 and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Attribute)
                 and n.value.func.attr == '_from_config'}
        assert roots == {'encoder', 'decoder'}
        assert roots <= set(skip)

    # Реальный рекурсивный преобразователь из закреплённого Transformers: проверяем
    # не только имена, но и саму замену Linear, включая вложенный quantizer.
    from contextlib import nullcontext
    from inspect import signature
    transformers_wheel = wheel.with_name('transformers-4.57.3-py3-none-any.whl')
    if not transformers_wheel.exists():
        pytest.skip('нет закреплённого transformers wheel')
    with zipfile.ZipFile(transformers_wheel) as z:
        tree = ast.parse(z.read('transformers/integrations/bitsandbytes.py'))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_replace_with_bnb_linear')
    class Node:
        def __init__(self, **children): self._modules = children
        def named_children(self): return list(self._modules.items())
        def children(self): return list(self._modules.values())
        def requires_grad_(self, value): return self
    class Linear(Node):
        def __init__(self):
            super().__init__()
            self.in_features = self.out_features = 4
            self.bias = None
    class Quantized(Node):
        def __init__(self, *args, **kwargs): super().__init__()
    class Conv: pass
    cfg = codec_kwargs['quantization_config']
    cfg.quantization_method = lambda: 'llm_int8' if quantization == 'int8' else 'fp4'
    cfg.llm_int8_has_fp16_weight = False
    cfg.llm_int8_threshold = 6.0
    converter_env = {'nn': SimpleNamespace(Linear=Linear), 'Conv1D': Conv,
                     'init_empty_weights': nullcontext, 'signature': signature,
                     'bnb': SimpleNamespace(nn=SimpleNamespace(Linear4bit=Quantized, Linear8bitLt=Quantized))}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), '<wheel transformers>', 'exec'), converter_env)
    codec = Node(encoder=Node(linear=Linear(), quantizer=Node(linear=Linear())),
                 decoder=Node(linear=Linear(), quantizer=Node(linear=Linear())))
    convert = converter_env['_replace_with_bnb_linear']
    convert(codec, modules_to_not_convert=skip, quantization_config=cfg)
    for root in ('encoder', 'decoder'):
        assert isinstance(codec._modules[root]._modules['linear'], Linear)
        assert isinstance(codec._modules[root]._modules['quantizer']._modules['linear'], Linear)
    talker = Node(talker=Node(model=Node(layers=Node(linear=Linear()))))
    convert(talker, modules_to_not_convert=skip, quantization_config=cfg)
    assert isinstance(talker._modules['talker']._modules['model']._modules['layers']._modules['linear'], Quantized)


def test_addons_override_takes_priority_when_already_on_path(monkeypatch, tmp_path):
    from models_torch import TorchModels
    active = tmp_path / 'addons' / 'voice-gpu'
    staging = tmp_path / 'staging'
    active.mkdir(parents=True)
    staging.mkdir()
    monkeypatch.setenv('DEFOPS_VOICE_GPU_ADDONS', str(staging))
    monkeypatch.setattr(sys, 'path', [str(active), str(staging), *sys.path])
    TorchModels(models_dir=tmp_path / 'models' / 'voice')
    assert sys.path[0] == str(staging)
