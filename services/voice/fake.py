"""Поддельные модели (--fake): тот же интерфейс, что models.Models, без MLX и torch — для тестов и сквозной
проверки приложения без Mac. Речь — громкость кадра, конец реплики — сразу, распознавание — строки из файла
по очереди (длиннее 25 с — ошибка, как у GigaAM; строка «{эхо}» — «распознан» текст, который поддельный синтез
говорил последним: эхо штаба из динамиков), синтез — тон длиной ~15 знаков в секунду (без образца
или с удалённым файлом образца — ошибка, как у настоящего)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterator

import numpy as np

DEFAULT_TEXT = "штаб, открой переигровку"
ECHO = "{эхо}"  # строка сценария: распознано то, что синтез говорил последним (эхо из динамиков)
CHARS_PER_S = 15
ASR_MAX_S = 25  # как у GigaAM: transcribe длиннее не берёт (ValueError)
CHUNK_S = 0.32  # как streaming_interval настоящего синтеза


class FakeModels:
    sample_rate = 24000

    def __init__(self, script: Path | None = None):
        self.mlx = ThreadPoolExecutor(1, thread_name_prefix="mlx")
        self.torch = ThreadPoolExecutor(1, thread_name_prefix="torch")
        self.script: list[str] = []
        if script is not None:
            self.script = [s.strip() for s in Path(script).read_text(encoding="utf-8").splitlines() if s.strip()]
        self.vad_resets = 0
        self.transcribed = 0  # сколько раз распознавали (и куски по ходу речи)
        self.last_tts = ""
        self.forgotten: list[Path] = []

    def load(self, warm_ref=None):
        pass

    def vad_prob(self, frame: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(np.square(frame)))) if len(frame) else 0.0
        return round(min(1.0, rms * 10), 3)

    def vad_reset(self):
        self.vad_resets += 1

    def turn_complete(self, audio: np.ndarray) -> float:
        return 1.0

    def transcribe(self, audio: np.ndarray) -> str:
        if len(audio) > ASR_MAX_S * 16000:
            raise ValueError("Too long wav file, use 'transcribe_longform' method.")
        self.transcribed += 1
        text = self.script.pop(0) if self.script else DEFAULT_TEXT
        return self.last_tts if text == ECHO else text

    def forget_ref(self, path: Path):
        self.forgotten.append(Path(path))

    def tts_stream(self, text: str, ref) -> Iterator[np.ndarray]:
        # как настоящий синтез: без образца или с удалённым файлом образца — ошибка
        if ref is None:
            raise RuntimeError("нет образца голоса — запишите голос в окне «Голоса»")
        if not Path(ref[0]).is_file():
            raise FileNotFoundError(2, "No such file or directory", str(ref[0]))
        self.last_tts = text
        sr = self.sample_rate
        n = int(max(0.3, len(text) / CHARS_PER_S) * sr)
        t = np.arange(n) / sr
        a = (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        step = int(CHUNK_S * sr)
        for i in range(0, n, step):
            yield a[i:i + step]
