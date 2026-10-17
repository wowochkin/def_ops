"""Звуковая логика без моделей и сети: калибровка порогов, слушатель (речь, перебивание, конец реплики),
склейка реплик. Перенос со стенда scripts/voice-bench/talk_server.py без изменения найденных значений."""
from __future__ import annotations

from typing import Awaitable, Callable

import numpy as np

SR_IN = 16000
FRAME = 512  # Silero: 32 мс на 16 кГц
FRAME_MS = 32
TURN_RECHECK_MS = 96  # три кадра
MERGE_GAP_S = 2.0  # новая речь не позже этого после конца прежней…
MERGE_PLAYED_S = 1.5  # …и ответ не звучит или звучит меньше этого — реплики склеиваются


def calibrate(d: dict, end_ms: int) -> tuple[dict, dict]:
    """Пороги по замерам уверенности VAD (0–1) на четырёх шагах: noise — тишина, speech — голос человека,
    echo — голос модели из динамиков (человек молчит), over — модель говорит, человек её перебивает.

    Порог в тишине — посередине между фоном (98-й процентиль) и тихой частью речи (25-й). Порог перебивания —
    выше эха (98-й процентиль + 0,08) и ниже речи поверх модели (30-й процентиль − 0,05), ближе к эху; если
    эхо громче речи поверх модели — посередине и совет надеть наушники. Длительность перебивания — самый
    длинный всплеск эха выше порога + 150 мс (250–900 мс)."""
    q = lambda xs, p: float(np.percentile(xs, p))
    clip = lambda x, lo, hi: round(float(min(hi, max(lo, x))), 2)
    warn = []
    noise_hi = q(d["noise"], 98)
    sp = [x for x in d["speech"] if x > noise_hi + 0.05]
    if len(sp) < 15:
        raise ValueError("речь не услышана — говорите громче или ближе к микрофону и повторите калибровку")
    speech_lo = q(sp, 25)
    vad = clip((noise_hi + speech_lo) / 2, 0.15, 0.85)
    echo = d.get("echo") or [0.0]
    echo_hi = q(echo, 98)
    over = [x for x in d.get("over") or [] if x > echo_hi + 0.05]
    over_lo = q(over, 30) if len(over) >= 10 else None
    if over_lo is None:
        warn.append("Не удалось услышать, как вы перебиваете штаб, — перебивание настроено приблизительно. "
                    "Повторите калибровку и на последнем шаге говорите громче.")
    lo, hi = max(vad, echo_hi + 0.08), (over_lo - 0.05) if over_lo is not None else 0.95
    if lo <= hi:
        barge = clip(lo + (hi - lo) * 0.3, 0.1, 0.95)
    else:
        barge = clip((echo_hi + (over_lo if over_lo is not None else 0.95)) / 2, 0.1, 0.95)
        warn.append("Голос штаба из динамиков почти так же громок, как ваш, — наденьте наушники, иначе штаб будет "
                    "перебивать сам себя или не услышит, как вы его перебиваете.")
    run = best = 0
    for x in echo:
        run = run + 1 if x >= barge else 0
        best = max(best, run)
    barge_ms = int(clip(max(250, best * 32 + 150), 250, 900))
    # замеры — для человека в окне калибровки: простые слова
    stats = {"тишина в комнате": round(noise_hi, 2), "ваш голос": round(speech_lo, 2),
             "голос штаба в микрофоне": round(echo_hi, 2),
             "ваш голос поверх штаба": round(over_lo, 2) if over_lo is not None else None,
             "самый долгий отзвук штаба, мс": best * 32}
    return {"vad": vad, "barge_vad": barge, "barge_ms": barge_ms, "end_ms": end_ms}, {"stats": stats, "warn": warn}


def should_merge(prev_end: float, speech_start: float, reply_audio_start: float | None) -> bool:
    """Склеить новую речь с прежней репликой: пауза не больше MERGE_GAP_S, а ответ ещё не звучит
    (reply_audio_start is None) или звучит меньше MERGE_PLAYED_S."""
    if speech_start - prev_end > MERGE_GAP_S:
        return False
    return reply_audio_start is None or speech_start - reply_audio_start < MERGE_PLAYED_S


class Listener:
    """Кадры микрофона (по FRAME отсчётов, 16 кГц) → события. Логика Session.on_frame/end_turn стенда.
    vad(frame) → уверенность речи 0–1, turn(audio) → вероятность законченной фразы (Smart Turn)."""

    def __init__(self, cfg: dict, vad: Callable[[np.ndarray], Awaitable[float]],
                 turn: Callable[[np.ndarray], Awaitable[float]], *,
                 max_silence_ms: int = 1500, turn_threshold: float = 0.5, min_speech_ms: int = 200):
        self.cfg, self.vad, self.turn = cfg, vad, turn
        self.max_silence_ms, self.turn_threshold, self.min_speech_ms = max_silence_ms, turn_threshold, min_speech_ms
        self.frames = 0
        self.reset()

    def reset(self):
        self.audio = np.zeros(0, np.float32)  # реплика: от начала речи (с запасом)
        self.pre = np.zeros(0, np.float32)  # последние 300 мс до начала речи
        self.in_speech = False
        self.barged = False
        self.speech_ms = self.silence_ms = 0.0
        self.turn_next = 0.0  # тишина (мс), с которой снова спросить Smart Turn

    async def feed(self, frame: np.ndarray, busy: bool) -> list[tuple]:
        c = self.cfg
        ev: list[tuple] = []
        p = float(await self.vad(frame))
        speech = p >= (c["barge_vad"] if busy else c["vad"])
        self.frames += 1
        if self.frames % 3 == 0:  # индикатор: ~10 раз в секунду
            ev.append(("level", round(p, 2)))
        if not self.in_speech:
            self.pre = np.concatenate([self.pre, frame])[-int(0.3 * SR_IN):]
            if speech:
                self.in_speech, self.speech_ms, self.silence_ms, self.turn_next = True, float(FRAME_MS), 0.0, 0.0
                self.barged = False
                self.audio = np.concatenate([self.pre, frame])
                ev.append(("speech_start",))
            return ev
        self.audio = np.concatenate([self.audio, frame])
        if speech:
            self.speech_ms += FRAME_MS
            self.silence_ms = 0
            self.turn_next = 0.0
            # перебивание: человек говорит дольше порога, пока модель отвечает
            if busy and not self.barged and self.speech_ms >= c["barge_ms"]:
                self.barged = True
                ev.append(("barge",))
            return ev
        self.silence_ms += FRAME_MS
        if self.speech_ms < self.min_speech_ms and self.silence_ms >= 300:  # щелчок, кашель
            self.in_speech = False
            ev.append(("speech_end",))
            return ev
        # конец реплики: после паузы end_ms спрашиваем Smart Turn и, пока он считает фразу незаконченной,
        # переспрашиваем каждые ~0,1 с (иначе при короткой паузе ответ ждал бы max_silence_ms)
        if self.silence_ms >= max(c["end_ms"], self.turn_next):
            self.turn_next = self.silence_ms + TURN_RECHECK_MS
            prob = float(await self.turn(self.audio))
            if prob >= self.turn_threshold:
                ev += self._end_turn(prob)
                return ev
        if self.silence_ms >= self.max_silence_ms:
            ev += self._end_turn(None)
        return ev

    def _end_turn(self, prob: float | None) -> list[tuple]:
        self.in_speech = False
        audio = self.audio[: len(self.audio) - int(self.silence_ms / 1000 * SR_IN) + int(0.2 * SR_IN)]
        return [("speech_end",), ("utterance", audio, prob)]
