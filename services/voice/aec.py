"""Подавление эха: голос штаба из динамиков вычитается из микрофона до VAD и распознавания.

WebRTC AEC3 из пакета livekit (`rtc.AudioProcessingModule`) — по проверке на синтетике (tools/aec_probe.md).
Опора — звук, который окно в тот же миг отрисовало на вывод: окно шлёт его вместе с кадром микрофона,
по отсчётам вровень (двухканальный кадр), поэтому опора всегда приходит раньше своего эха и без скачков
привязки. Модуль — один на подключение, на всю сессию; кадры по 10 мс: сначала опора
(`process_reverse_stream`), затем микрофон (`process_stream`). Шумоподавление, АРУ и ФВЧ модуля выключены:
только эхо. Подсказка задержки — 0: AEC3 ищет задержку сам (окно 0–500 мс)."""
from __future__ import annotations

import numpy as np

CHUNK_MS = 10


def available() -> bool:
    """Пакет livekit ставится (setup.sh) — подавление эха возможно."""
    try:
        from livekit import rtc  # noqa: F401
    except Exception:  # noqa: BLE001 — нет пакета или он не грузится на этой машине
        return False
    return True


def _i16(a: np.ndarray) -> bytes:
    return (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes()


class EchoCanceller:
    """process(mic, ref) → микрофон без эха той же длины (float32, −1…1). mic и ref — одной длины, вровень по
    отсчётам: ref — то, что звучало из динамиков в тот же миг. Длина кадра любая: внутри — куски по 10 мс,
    выход отстаёт от входа на 10 мс (и ~8,5 мс — внутри AEC3)."""

    def __init__(self, sr: int = 16000, delay_ms: int = 0):
        from livekit import rtc

        self.rtc, self.sr, self.delay_ms = rtc, sr, delay_ms
        self.n = sr * CHUNK_MS // 1000
        self.apm = rtc.AudioProcessingModule(echo_cancellation=True, noise_suppression=False,
                                             high_pass_filter=False, auto_gain_control=False)
        self.mic = np.zeros(0, np.float32)
        self.ref = np.zeros(0, np.float32)
        self.out = np.zeros(self.n, np.float32)  # запас в кусок: выход любой длины готов сразу

    def _chunk(self, mic: np.ndarray, ref: np.ndarray) -> np.ndarray:
        rtc, n = self.rtc, self.n
        self.apm.process_reverse_stream(rtc.AudioFrame(_i16(ref), self.sr, 1, n))
        self.apm.set_stream_delay_ms(self.delay_ms)
        f = rtc.AudioFrame(_i16(mic), self.sr, 1, n)
        self.apm.process_stream(f)
        return np.frombuffer(f.data, "<i2").astype(np.float32) / 32768

    def process(self, mic: np.ndarray, ref: np.ndarray) -> np.ndarray:
        if len(mic) != len(ref):
            raise ValueError(f"микрофон и опора разной длины: {len(mic)} и {len(ref)}")
        self.mic = np.concatenate([self.mic, np.asarray(mic, np.float32)])
        self.ref = np.concatenate([self.ref, np.asarray(ref, np.float32)])
        k = len(self.mic) // self.n
        if k:
            n = self.n
            done = [self._chunk(self.mic[i * n:(i + 1) * n], self.ref[i * n:(i + 1) * n]) for i in range(k)]
            self.mic, self.ref = self.mic[k * n:], self.ref[k * n:]
            self.out = np.concatenate([self.out, *done])
        res, self.out = self.out[:len(mic)], self.out[len(mic):]
        return res
