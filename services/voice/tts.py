"""Куски синтеза без моделей: резка потока на фразы, группировка фраз в куски, паузы и затухание.
Перенос со стенда scripts/voice-bench/talk_server.py без изменения найденных значений."""
from __future__ import annotations

import re

import numpy as np

PIECE_LEAD_S = 1.0  # синтез следующего куска — когда звука в запасе меньше этого
PIECE_MAX_CHARS = 300  # кусок не длиннее (2–3 предложения)
SHORT_CHARS = 30  # первая фраза короче — ждём следующую и синтезируем вместе
SHORT_WAIT_S = 0.4  # но не дольше
# тестовая фраза модели на шагах калибровки «эхо» и «перебивание»
CALIB_PHRASE = ("Докладываю обстановку. Восьмая гвардейская армия ведёт бой за вторую полосу обороны у Зелова, "
                "противник контратакует резервами из глубины.")
PAUSE_AFTER = {".": 0.2, "…": 0.25, "!": 0.3, "?": 0.3, ",": 0.1, ";": 0.15, ":": 0.15}  # пауза между кусками, с


class Sentences:
    """Режет поток токенов на фразы для синтеза: по концу предложения или переносу строки; первую — короче
    (по запятой после 50 знаков), чтобы голос начинался раньше."""

    def __init__(self):
        self.buf, self.first = "", True

    def push(self, piece: str) -> list[str]:
        self.buf += piece
        out = []
        while True:
            # конец предложения — знак и пробел после него (иначе «3.5» и «20.04» резались бы); перенос строки
            m = re.search(r"[.!?…]+[»\")]?\s+|\n+", self.buf)
            if not m and self.first and len(self.buf) > 50:
                m = re.search(r",\s+", self.buf[30:])
                if m:
                    cut = 30 + m.end()
                    out.append(self.buf[:cut])
                    self.buf, self.first = self.buf[cut:], False
                    continue
            if not m:
                break
            out.append(self.buf[:m.end()])
            self.buf, self.first = self.buf[m.end():], False
        return [s for s in (x.strip() for x in out) if re.search(r"\w", s)]

    def rest(self) -> list[str]:
        s, self.buf = self.buf.strip(), ""
        return [s] if re.search(r"\w", s) else []


class PiecePlanner:
    """Какими кусками озвучивать ответ. Первая фраза — сразу (начало без задержки), но короче SHORT_CHARS
    синтез произносит отдельно плохо — ждём следующую (не дольше SHORT_WAIT_S) и берём вместе. Дальше —
    одним куском: когда звука в запасе меньше PIECE_LEAD_S, текста набралось PIECE_MAX_CHARS или ответ кончился."""

    def __init__(self):
        self.pending: list[str] = []
        self.first = True
        self.finished = False
        self.t_first: float | None = None

    def push(self, sentence: str):
        self.pending.append(sentence)

    def finish(self):
        self.finished = True

    @property
    def done(self) -> bool:
        return self.finished and not self.pending

    def next_piece(self, now: float, play_until: float) -> str | None:
        p = self.pending
        if not p:
            return None
        if self.first:
            self.t_first = now if self.t_first is None else self.t_first
            ready = (self.finished or len(p) > 1 or len(p[0]) >= SHORT_CHARS
                     or now - self.t_first >= SHORT_WAIT_S)
            if not ready:
                return None
            k = 2 if len(p[0]) < SHORT_CHARS and len(p) > 1 else 1
            piece, self.pending, self.first = " ".join(p[:k]), p[k:], False
            return piece
        if self.finished or len(" ".join(p)) >= PIECE_MAX_CHARS or play_until - now < PIECE_LEAD_S:
            piece, self.pending = " ".join(p), []
            return piece
        return None


def whole_pieces(text: str) -> list[str]:
    """Куски заготовки (`prepare`): фраза известна целиком, синтез идёт заранее. Первый кусок — как у PiecePlanner
    (короткая первая фраза — вместе со следующей), дальше фразы набираются в куски не длиннее PIECE_MAX_CHARS:
    каждый кусок — отдельная работа нити синтеза, между ними успевают живые фразы и конец реплики (Smart Turn)."""
    s = Sentences()
    sents = s.push(text) + s.rest()
    if not sents:
        return []
    k = 2 if len(sents[0]) < SHORT_CHARS and len(sents) > 1 else 1
    out = [" ".join(sents[:k])]
    for x in sents[k:]:
        if len(out) > 1 and len(out[-1]) + 1 + len(x) <= PIECE_MAX_CHARS:
            out[-1] += " " + x
        else:
            out.append(x)
    return out


def pause_after(text: str) -> float:
    """Пауза после куска по знаку в конце (закрывающие кавычки и скобки не считаются)."""
    return PAUSE_AFTER.get(text.rstrip("»\")) ")[-1:], PAUSE_AFTER["."])


def fade_tail(a: np.ndarray, sr: int, ms: int) -> np.ndarray:
    """Синтез обрывает последний звук резко — плавно гасим последние ms миллисекунд (полукосинус)."""
    n = min(len(a), int(ms / 1000 * sr))
    if n <= 0:
        return a
    out = a.copy()
    out[-n:] = out[-n:] * (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(a.dtype)
    return out
