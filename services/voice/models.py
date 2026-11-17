"""Настоящие модели (Mac на Apple Silicon): Silero VAD и GigaAM v3 e2e (PyTorch), Smart Turn v3 и Qwen3-TTS 1.7B
(MLX). Загрузка и вызовы — как на стенде scripts/voice-bench/talk_server.py.

Вся работа MLX (Smart Turn, синтез) — в одной нити `mlx`: потоки MLX привязаны к нити, на которой созданы.
Распознавание — в нити `torch`. VAD — в нити asyncio (≈1 мс на кадр), чтобы слушать и во время синтеза.
MLX и torch импортируются только в загрузчиках и вызовах — модуль импортируется и без них."""
from __future__ import annotations

import os
import math
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterator

import numpy as np

from audio import SR_IN
from engines import DEFAULT_ENGINE, Engine, engine as engine_by_id
from voices import write_wav

TURN_MODEL = "mlx-community/smart-turn-v3"
ASR_MODEL = "v3_e2e_rnnt"  # с пунктуацией и заглавными
WARM_TEXT = "Слушаю вас."


def validate_temperature(value: float | None) -> float | None:
    """Параметр запроса; никогда не изменяет общие настройки модели."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("температура должна быть числом от 0 до 1")
    return float(value)


def validate_cpu_threads(value: int | None) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value not in (1, 2, 4, 8):
        raise ValueError("число потоков CPU должно быть 1, 2, 4 или 8")
    return value


class Models:
    supports_cpu_threads = False

    def __init__(self, tts: str = DEFAULT_ENGINE, asr: str = ASR_MODEL, eos_extra: int = 1, repo: str | None = None,
                 *, models_dir: Path | None = None, offline: bool = False):
        self.models_dir = Path(models_dir) if models_dir else None
        self.offline = offline
        if offline:
            os.environ["HF_HUB_OFFLINE"] = os.environ["TRANSFORMERS_OFFLINE"] = "1"
        if self.models_dir:
            self.supported_engines = ("qwen3-ru-stress",)
            if tts not in self.supported_engines:
                raise ValueError(f"Автономный комплект содержит qwen3-ru-stress; сохранена модель {tts}. Выберите её явно.")
        self.engine: Engine = engine_by_id(tts)
        self.repo_override = repo  # --tts: свои веса вместо первого доступного варианта модели
        self.asr_name, self.eos_extra = asr, eos_extra
        self.mlx = ThreadPoolExecutor(1, thread_name_prefix="mlx")  # всё MLX — в одной нити
        self.torch = ThreadPoolExecutor(1, thread_name_prefix="torch")
        self.sample_rate = 24000  # уточняется по загруженному синтезу
        self._refs: dict[tuple[str, int], np.ndarray] = {}  # образец голоса → звук для синтеза
        self._tmp = Path(tempfile.gettempdir())

    def load(self, warm_ref: tuple[Path, str] | None = None):
        """Загрузка 20–40 с (первый раз — дольше: модели скачиваются). warm_ref — образец для прогрева синтеза."""
        print("загрузка: VAD, распознавание…", flush=True)
        self.torch.submit(self._load_torch).result()
        print("загрузка: Smart Turn, синтез…", flush=True)
        self.mlx.submit(self._load_mlx).result()
        if warm_ref is not None:
            print("прогрев синтеза…", flush=True)
            self.mlx.submit(lambda: list(self.tts_stream(WARM_TEXT, warm_ref))).result()

    def _load_torch(self):
        import gigaam
        import torch
        from silero_vad import load_silero_vad

        root = self.models_dir / "gigaam" if self.models_dir else Path.home() / ".cache" / "gigaam"
        if self.offline or self.models_dir:
            for name in (f"{self.asr_name}.ckpt", f"{self.asr_name}_tokenizer.model"):
                if not (root / name).is_file():
                    raise FileNotFoundError(f"Нет автономных весов распознавания: {root / name}")
        torch.set_num_threads(2)
        self.vad = load_silero_vad()
        try:
            self.asr = gigaam.load_model(self.asr_name, device="mps", download_root=str(root))
            self._asr_file(self._silence_wav())  # на mps бывает сбой на первом же файле — тогда процессор
        except Exception:
            self.asr = gigaam.load_model(self.asr_name, device="cpu", download_root=str(root))

    def _silence_wav(self) -> Path:
        f = self._tmp / f"voice-warm-{os.getpid()}.wav"
        write_wav(f, np.zeros(SR_IN, np.float32), SR_IN)
        return f

    def _load_mlx(self):
        from mlx_audio.vad import load as load_vad

        self.turn = load_vad(str(self.models_dir / "smart-turn") if self.models_dir else TURN_MODEL)
        self._load_tts()

    def _load_tts(self):  # в нити mlx
        from mlx_audio.tts.utils import load_model

        from tts_tail import extend_eos

        errors = []
        repos = (str(self.models_dir / self.engine.id),) if self.models_dir else self.engine.repos
        for repo in ((self.repo_override,) if self.repo_override else repos):
            try:
                tts = load_model(repo)
                break
            except Exception as e:  # noqa: BLE001 — следующий вариант весов
                errors.append(f"{repo}: {e}")
        else:
            raise RuntimeError("модель озвучки не загрузилась: " + " | ".join(errors))
        self.tts = tts
        self.sample_rate = int(getattr(tts, "sample_rate", 24000))
        self._refs = {}  # образцы разбираются под частоту модели
        self.eos_reset = extend_eos(tts, self.eos_extra) if self.engine.eos_patch else (lambda: None)

    def switch_tts(self, eid: str):
        """Другая модель озвучки (в нити mlx): прежняя выгружается. Не загрузилась — прежняя возвращается, ошибка выходит."""
        if self.models_dir and eid not in self.supported_engines:
            raise ValueError(f"В автономном комплекте нет модели {eid}")
        old = self.engine
        self.engine = engine_by_id(eid)
        self.tts = None
        self._free()
        try:
            self._load_tts()
        except Exception:
            self.engine = old
            self._load_tts()
            raise

    @staticmethod
    def _free():
        import gc

        gc.collect()
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:  # noqa: BLE001 — очистка кэша не обязательна
            pass

    # ------------------------------------------------------------ вызовы

    def vad_prob(self, frame: np.ndarray) -> float:  # в нити asyncio
        import torch

        return float(self.vad(torch.from_numpy(frame), SR_IN).item())

    def vad_reset(self):
        self.vad.reset_states()

    def turn_complete(self, audio: np.ndarray) -> float:  # в нити mlx
        return float(self.turn.predict_endpoint(audio[-8 * SR_IN:], sample_rate=SR_IN).probability)

    def _asr_file(self, path) -> str:
        return str(self.asr.transcribe(str(path)))

    def transcribe(self, audio: np.ndarray) -> str:  # в нити torch
        f = self._tmp / f"voice-turn-{os.getpid()}.wav"
        try:
            write_wav(f, audio, SR_IN)
            return self._asr_file(f)
        finally:  # реплика и запись голоса не остаются на диске
            f.unlink(missing_ok=True)

    def forget_ref(self, path: Path):
        """Образец удалён — его звук не держится и в памяти."""
        self._refs = {k: v for k, v in self._refs.items() if k[0] != str(path)}

    def _ref_audio(self, path: Path):  # в нити mlx; образец грузится один раз (новая запись — новый mtime)
        from mlx_audio.utils import load_audio

        key = (str(path), Path(path).stat().st_mtime_ns)
        if key not in self._refs:
            self._refs = {k: v for k, v in self._refs.items() if k[0] != key[0]}
            self._refs[key] = load_audio(str(path), sample_rate=self.sample_rate)
        return self._refs[key]

    def tts_stream(self, text: str, ref: tuple[Path, str] | None, *, temperature: float | None = None, cpu_threads: int | None = None) -> Iterator[np.ndarray]:  # в нити mlx
        """Потоковый синтез с клонированием голоса образца ref = (ref.wav, его текст). Перед каждым синтезом
        сбрасывается счётчик договаривания (extend_eos). Отмена — перестать читать итератор."""
        temperature = validate_temperature(temperature)
        if validate_cpu_threads(cpu_threads) is not None:
            raise ValueError("настройка потоков CPU TTS доступна в PyTorch/Windows")
        if ref is None:
            raise RuntimeError("нет образца голоса — запишите голос в окне «Голоса»")
        path, ref_text = ref
        ref_audio = self._ref_audio(path)
        self.eos_reset()
        e = self.engine
        kw = dict(e.kwargs)
        if temperature is not None:
            kw["temperature"] = temperature  # MLX Qwen: 0 выбирает argmax в обоих sampler.
        if e.ref_text:
            kw["ref_text"] = ref_text
        if e.stream:
            kw["stream"] = True
        else:
            kw.pop("streaming_interval", None)
        for r in self.tts.generate(text=text, ref_audio=ref_audio, verbose=False, **kw):
            yield np.asarray(r.audio, dtype=np.float32).reshape(-1)

    def tts_batch(self, texts: list[str], ref, *, temperature: float | None = None, cpu_threads: int | None = None) -> list[np.ndarray]:
        """Совместимый последовательный fallback Mac; настоящий CUDA batch — в TorchModels."""
        temperature = validate_temperature(temperature)
        validate_cpu_threads(cpu_threads)
        options = {} if temperature is None else {"temperature": temperature}
        if cpu_threads is not None:
            options["cpu_threads"] = cpu_threads
        return [np.concatenate([np.zeros(0, np.float32), *self.tts_stream(text, ref, **options)]) for text in texts]
