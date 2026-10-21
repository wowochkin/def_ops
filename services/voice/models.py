"""Настоящие модели (Mac на Apple Silicon): Silero VAD и GigaAM v3 e2e (PyTorch), Smart Turn v3 и Qwen3-TTS 1.7B
(MLX). Загрузка и вызовы — как на стенде scripts/voice-bench/talk_server.py.

Вся работа MLX (Smart Turn, синтез) — в одной нити `mlx`: потоки MLX привязаны к нити, на которой созданы.
Распознавание — в нити `torch`. VAD — в нити asyncio (≈1 мс на кадр), чтобы слушать и во время синтеза.
MLX и torch импортируются только в загрузчиках и вызовах — модуль импортируется и без них."""
from __future__ import annotations

import os
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


class Models:
    def __init__(self, tts: str = DEFAULT_ENGINE, asr: str = ASR_MODEL, eos_extra: int = 1, repo: str | None = None):
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

        torch.set_num_threads(2)
        self.vad = load_silero_vad()
        try:
            self.asr = gigaam.load_model(self.asr_name, device="mps")
            self._asr_file(self._silence_wav())  # на mps бывает сбой на первом же файле — тогда процессор
        except Exception:
            self.asr = gigaam.load_model(self.asr_name, device="cpu")

    def _silence_wav(self) -> Path:
        f = self._tmp / f"voice-warm-{os.getpid()}.wav"
        write_wav(f, np.zeros(SR_IN, np.float32), SR_IN)
        return f

    def _load_mlx(self):
        from mlx_audio.vad import load as load_vad

        self.turn = load_vad(TURN_MODEL)
        self._load_tts()

    def _load_tts(self):  # в нити mlx
        from mlx_audio.tts.utils import load_model

        from tts_tail import extend_eos

        errors = []
        for repo in ((self.repo_override,) if self.repo_override else self.engine.repos):
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

    def tts_stream(self, text: str, ref: tuple[Path, str] | None) -> Iterator[np.ndarray]:  # в нити mlx
        """Потоковый синтез с клонированием голоса образца ref = (ref.wav, его текст). Перед каждым синтезом
        сбрасывается счётчик договаривания (extend_eos). Отмена — перестать читать итератор."""
        if ref is None:
            raise RuntimeError("нет образца голоса — запишите голос в окне «Голоса»")
        path, ref_text = ref
        ref_audio = self._ref_audio(path)
        self.eos_reset()
        e = self.engine
        kw = dict(e.kwargs)
        if e.ref_text:
            kw["ref_text"] = ref_text
        if e.stream:
            kw["stream"] = True
        else:
            kw.pop("streaming_interval", None)
        for r in self.tts.generate(text=text, ref_audio=ref_audio, verbose=False, **kw):
            yield np.asarray(r.audio, dtype=np.float32).reshape(-1)
