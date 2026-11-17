"""Windows/NVIDIA: тот же ru-stress-cf через qwen-tts, Smart Turn ONNX и ASR на CPU.

Загрузка только из заранее подготовленной папки. Интерфейс Models, включая однопоточный
executor `mlx` (историческое имя), сохранён для сервера; этот модуль MLX не импортирует.
CUDA/Windows и качество BF16 требуют прогона на целевой машине, Mac-тесты этого не подтверждают.
"""
from __future__ import annotations

import gc
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

from audio import SR_IN
from models import Models, WARM_TEXT, validate_temperature, validate_cpu_threads
from torch_profile import TorchProfile
from runtime import TORCH_ENGINE, require_torch_engine
from windows_assets import ASR_NAME, TURN_FILE, validate_files
from prompt_cache import PromptCache, reference_key


class OnnxTurn:
    def __init__(self, path: Path):
        import onnxruntime as ort
        from transformers import WhisperFeatureExtractor

        options = ort.SessionOptions()
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 2
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        self.features = WhisperFeatureExtractor(chunk_length=8)  # конструктор, без from_pretrained/сети

    def predict(self, audio: np.ndarray) -> float:
        audio = np.asarray(audio[-8 * SR_IN:], dtype=np.float32)
        if len(audio) < 8 * SR_IN:
            audio = np.pad(audio, (8 * SR_IN - len(audio), 0))
        features = self.features(audio, sampling_rate=SR_IN, return_tensors="np", padding="max_length",
                                 max_length=8 * SR_IN, truncation=True, do_normalize=True).input_features
        result = self.session.run(None, {"input_features": features.astype(np.float32)})
        return float(result[0].reshape(-1)[0])


class TorchModels(Models):
    supported_engines = (TORCH_ENGINE,)
    supports_cpu_threads = True

    def __init__(self, tts: str = TORCH_ENGINE, asr: str = ASR_NAME, eos_extra: int = 1,
                 repo: str | None = None, *, models_dir: Path, offline: bool = True, profile: TorchProfile | None = None):
        require_torch_engine(tts)
        if asr != ASR_NAME:
            raise ValueError(f"комплект Windows содержит распознавание {ASR_NAME}, запрошено {asr}")
        if repo is not None:
            raise ValueError("для Torch укажите --models-dir с комплектом qwen3-ru-stress; --tts не подменяет веса")
        addon_override = os.environ.get("DEFOPS_VOICE_GPU_ADDONS", "").strip()
        addon = Path(addon_override).resolve() if addon_override else Path(models_dir).resolve().parents[1] / "addons" / "voice-gpu"
        if addon.is_dir():
            if str(addon) in sys.path:
                sys.path.remove(str(addon))
            sys.path.insert(0, str(addon))
        self.profile = profile or TorchProfile()
        self.tts = None
        self.phase = "unloaded"
        self.tts_cpu_threads = 2
        self._warm_key = None
        self.models_dir, self.offline = Path(models_dir).resolve(), offline
        if offline:
            # До импортов transformers/huggingface_hub: AutoProcessor внутри qwen-tts не передаёт local_files_only.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
        super().__init__(tts, asr, eos_extra, repo, models_dir=self.models_dir, offline=offline)
        self._prompt_cache = PromptCache()

    def load(self, warm_ref=None):
        validate_files(self.models_dir)
        super().load(None if self.profile.managed else warm_ref)

    def _load_torch(self):
        import gigaam
        import torch
        from silero_vad import load_silero_vad

        validate_files(self.models_dir)  # GigaAM иначе сам пытается скачивать отсутствующий ckpt/tokenizer.
        torch.set_num_threads(2)
        self.vad = load_silero_vad()  # веса поставляются в wheel silero-vad
        self.asr = gigaam.load_model(self.asr_name, device="cpu", fp16_encoder=False, use_flash=False,
                                    download_root=str(self.models_dir / "gigaam"))

    def _load_mlx(self):
        self.turn = OnnxTurn(self.models_dir / "smart-turn" / TURN_FILE)
        if not self.profile.managed:
            self._load_tts()

    def _load_tts(self):
        import torch

        require_torch_engine(self.engine.id)
        validate_files(self.models_dir)
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA недоступна: нужен NVIDIA-драйвер и PyTorch с CUDA; перехода на другую модель нет")
        if not torch.cuda.is_bf16_supported():
            raise RuntimeError("CUDA-устройство не поддерживает BF16, требуемый комплектом qwen3-ru-stress")
        from qwen_tts import Qwen3TTSModel

        kwargs = dict(device_map="cuda:0", dtype=torch.bfloat16,
                      attn_implementation=self.profile.attention, local_files_only=True)
        if self.profile.quantization != "bf16":
            from transformers import BitsAndBytesConfig
            options = {"llm_int8_skip_modules": ["speaker_encoder", "speech_tokenizer", "code_predictor", "lm_head",
                                                "encoder", "decoder"]}
            if self.profile.quantization == "nf4":
                options.update(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                               bnb_4bit_compute_dtype=torch.bfloat16)
            else:
                options["load_in_8bit"] = True
            kwargs["quantization_config"] = BitsAndBytesConfig(**options)
        self.tts = Qwen3TTSModel.from_pretrained(str(self.models_dir / TORCH_ENGINE), **kwargs)
        self.phase = "ready"
        self.sample_rate = 24000
        self.eos_reset = lambda: None  # MLX extend_eos нельзя применять к Torch generation API.

    def _prompt_identity(self):
        from windows_assets import TTS_FILES, TTS_REPO, TTS_REVISION
        root = self.models_dir / TORCH_ENGINE
        files = {}
        for name in TTS_FILES:
            path = root / name
            stat = path.stat()
            # Весовые файлы уже закреплены манифестом комплекта. Их stat обнаруживает
            # локальную замену без повторного чтения гигабайтов при каждом unload/load.
            files[name] = ([stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns] if path.suffix == '.safetensors'
                           else hashlib.sha256(path.read_bytes()).hexdigest())
        manifest = self.models_dir / 'manifest.json'
        libraries = {}
        for name in ('qwen-tts', 'torch', 'transformers', 'librosa'):
            try: libraries[name] = version(name)
            except PackageNotFoundError: libraries[name] = 'unavailable'
        return hashlib.sha256(json.dumps({'format': 1, 'repo': TTS_REPO, 'revision': TTS_REVISION,
            'files': files, 'manifest': hashlib.sha256(manifest.read_bytes()).hexdigest() if manifest.is_file() else None,
            'profile': vars(self.profile), 'libraries': libraries}, sort_keys=True).encode()).hexdigest()

    def _ref_key(self, ref):
        path, text = ref
        return (str(Path(path).resolve()), reference_key(path, text, self._prompt_identity()))

    def load_tts_resource(self, ref=None):
        try:
            if self.tts is None:
                self.phase = "loading"
                self._load_tts()
            if ref is not None:
                key = self._ref_key(ref)
                if self._warm_key != key:
                    self.phase = "warming"
                    list(self.tts_stream(WARM_TEXT, ref))
                    self._warm_key = key
            self.phase = "ready"
        except Exception:
            self.phase = "error"
            raise

    def unload_tts_resource(self):
        self.phase = "unloading"
        self.tts = None
        self._warm_key = None
        self._free()
        self.phase = "unloaded"

    def forget_ref(self, path: Path):
        self._prompt_cache.forget(path)
        if self._warm_key is not None and self._warm_key[0] == str(Path(path).resolve()):
            self._warm_key = None
        super().forget_ref(path)

    def switch_tts(self, eid: str):
        require_torch_engine(eid)  # отклоняем до выгрузки работающей модели
        if eid != self.engine.id:
            super().switch_tts(eid)

    @staticmethod
    def _free():
        import torch
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def turn_complete(self, audio: np.ndarray) -> float:
        return self.turn.predict(audio)

    def tts_stream(self, text: str, ref, *, temperature: float | None = None, cpu_threads: int | None = None):
        yield self._synthesize(text, ref, temperature=temperature, cpu_threads=cpu_threads)[0]

    def tts_batch(self, texts: list[str], ref, *, temperature: float | None = None, cpu_threads: int | None = None) -> list[np.ndarray]:
        if not isinstance(texts, list) or not all(isinstance(t, str) and t.strip() for t in texts):
            raise ValueError("пакет должен содержать непустые тексты")
        validate_temperature(temperature)
        validate_cpu_threads(cpu_threads)
        if not texts:
            return []
        return self._synthesize(texts, ref, temperature=temperature, cpu_threads=cpu_threads)

    def set_tts_cpu_threads(self, threads: int):
        # Вызывается в единственной нити TTS до prefill/кодека. Inter-op пул не меняем.
        import torch
        validate_cpu_threads(threads)
        torch.set_num_threads(threads)
        self.tts_cpu_threads = threads

    def _synthesize(self, text: str | list[str], ref, *, temperature: float | None, cpu_threads: int | None):
        temperature = validate_temperature(temperature)
        validate_cpu_threads(cpu_threads)
        self.set_tts_cpu_threads(2 if cpu_threads is None else cpu_threads)
        if ref is None:
            raise RuntimeError("нет образца голоса — запишите голос в окне «Голоса»")
        path, ref_text = ref
        if not Path(path).is_file() or not ref_text.strip():
            raise ValueError("для клонирования нужны локальный ref.wav и его расшифровка")
        if self.tts is None:
            self.load_tts_resource()
        prompt = self._prompt_cache.get(path, ref_text, self._prompt_identity(),
            lambda: self.tts.create_voice_clone_prompt(ref_audio=str(path), ref_text=ref_text))
        temperature = self.engine.kwargs["temperature"] if temperature is None else temperature
        sampling = {"do_sample": False, "subtalker_dosample": False} if temperature == 0 else {}
        # MLX использует одно значение для talker и code predictor; Torch именует их раздельно.
        started = time.monotonic()
        chars = sum(len(t) for t in text) if isinstance(text, list) else len(text)
        batch_size = len(text) if isinstance(text, list) else 1
        self.synthesis_state = {"stage": "generating", "chars": chars, "batch_size": batch_size, "cpu_threads": self.tts_cpu_threads, "started_monotonic": started}
        print(f"[tts-start] chars={chars} batch_size={batch_size} cpu_threads={self.tts_cpu_threads}", flush=True)
        try:
            # Как в работающем MLX ICL: весь текст в prefill и усиленная защита от повторов.
            # Дефолты Torch (пошаговая подача текста, penalty=1.05) этому не эквивалентны:
            # с длинным образцом генерация может продолжать аудиокоды вместо завершения фразы.
            wavs, sr = self.tts.generate_voice_clone(text=text, language="Russian", voice_clone_prompt=prompt, temperature=temperature,
                                                    subtalker_temperature=temperature,
                                                    non_streaming_mode=True, repetition_penalty=1.5, **sampling)
        except Exception as e:
            self.synthesis_state = {"stage": "error", "error": str(e), "elapsed_s": round(time.monotonic() - started, 2)}
            print(f"[tts-error] {type(e).__name__}: {e}", flush=True)
            raise
        self.synthesis_state = {"stage": "generated", "elapsed_s": round(time.monotonic() - started, 2)}
        print(f"[tts-generated] seconds={time.monotonic() - started:.2f}", flush=True)
        if int(sr) != self.sample_rate:
            raise RuntimeError(f"неожиданная частота qwen3-ru-stress: {sr}, ожидалось {self.sample_rate}")
        if len(wavs) != (len(text) if isinstance(text, list) else 1):
            raise RuntimeError("модель вернула неожиданное число фраз")
        return [np.asarray(wav, dtype=np.float32).reshape(-1) for wav in wavs]

    def runtime_info(self):
        return {"backend": "torch", "engine": self.engine.id, "device": "cuda:0", "asr_device": "cpu",
                "offline": self.offline, "managed": self.profile.managed, "resident": self.tts is not None,
                "phase": self.phase, "quantization": self.profile.quantization, "attention": self.profile.attention, "cpu_threads": self.tts_cpu_threads,
                "prompt_cache": self._prompt_cache.info()}
