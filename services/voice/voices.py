"""Образцы голоса для синтеза и роли; проверка записи нового голоса с микрофона.

Хранилище: <root>/voices/<id>/{ref.wav, ref.json} (ref.json — имя, текст, источник, дата, встроенный ли),
<root>/roles.json — какой образец у какой роли. Встроенные образцы — копии образцов стенда (refs.json).
Модулю нужен только numpy."""
from __future__ import annotations

import json
import re
import shutil
import time
import wave
from pathlib import Path

import numpy as np

DEFAULT_VOICE = "zhukov-10s"
ROLES = ("chief", "umpire")  # начальник штаба, посредник
# голос роли по умолчанию, если такой образец есть; иначе — DEFAULT_VOICE
ROLE_DEFAULTS = {"chief": "chief-10s", "umpire": DEFAULT_VOICE}

# Текст для записи нового голоса: штабной доклад без цифр, 15–20 с чтения вслух
RECORD_TEXT = ("Докладываю обстановку на утро. Противник за ночь подтянул к переднему краю свежие резервы "
               "и ведёт разведку боем на левом фланге. Наши части удерживают занимаемый рубеж, артиллерия "
               "готова открыть огонь по заявкам пехоты. Связь с соседями устойчивая, подвоз боеприпасов идёт "
               "по плану. Прошу утвердить решение на усиление обороны у переправы.")

# Проверка записи
REC_MIN_S, REC_MAX_S = 8.0, 30.0  # длина после обрезки тишины
REC_TAIL_S = 0.4  # естественная пауза в конце образца
REC_LEAD_S = 0.05  # запас перед началом речи, чтобы не срезать первый звук
REC_PEAK_DB = -30.0  # пик не тише
REC_SNR_DB = 15.0  # сигнал/шум не меньше
REC_WER = 0.15  # доля ошибок по словам не больше


def write_wav(path, audio: np.ndarray, sr: int):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


_TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                     ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "i", "k", "l", "m", "n", "o", "p", "r", "s",
                      "t", "u", "f", "h", "c", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))


def _slug(name: str) -> str:
    s = "".join(_TRANSLIT.get(c, c) for c in name.lower())
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40] or "golos"


# варианты образцов стенда (prepare_ref.sh) — словами для интерфейса
_SEED_VARIANT = {"raw": "без обработки", "dfn": "с шумоподавлением"}


_SEED_SPEAKER = {"zhukov": "Жуков", "chief": "Начальник штаба"}


def _seed_name(vid: str) -> str:
    m = re.fullmatch(r"(zhukov|chief)-(\d+)s(?:-(.+))?", vid)
    if m:
        v = m.group(3)
        return f"{_SEED_SPEAKER[m.group(1)]}, {m.group(2)} с" + (f" ({_SEED_VARIANT.get(v, v)})" if v else "")
    return vid


class VoiceStore:
    def __init__(self, root: Path, seed_dir: Path | None):
        self.root = Path(root)
        self.dir = self.root / "voices"
        self.dir.mkdir(parents=True, exist_ok=True)
        if seed_dir is not None:
            self._seed(Path(seed_dir))

    def _seed(self, seed: Path):
        """Встроенные образцы — из refs.json стенда; образцы без файла (ref/ не в репозитории) пропускаются."""
        try:
            refs = json.loads((seed / "refs.json").read_text(encoding="utf-8"))["refs"]
        except (OSError, ValueError, KeyError):
            return
        for vid, r in refs.items():
            src = seed / r.get("file", "")
            dst = self.dir / vid
            if not src.is_file() or (dst / "ref.json").exists():
                continue
            dst.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst / "ref.wav")
            meta = {"name": r.get("name") or _seed_name(vid), "text": r["text"], "source": r.get("note") or "стенд",
                    "date": _now(), "builtin": True}
            (dst / "ref.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    def _meta(self, vid: str) -> dict | None:
        f = self.dir / vid / "ref.json"
        if not re.fullmatch(r"[\w-]+", vid) or not f.is_file():
            return None
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            return None

    def list(self) -> list[dict]:
        out = []
        for d in sorted(self.dir.iterdir()) if self.dir.exists() else []:
            m = self._meta(d.name)
            if m:
                out.append({"id": d.name, "name": m.get("name", d.name), "text": m.get("text", ""),
                            "source": m.get("source", ""), "builtin": bool(m.get("builtin")), "date": m.get("date", "")})
        # встроенные — первыми, свои — по дате записи
        return sorted(out, key=lambda v: (not v["builtin"], v["date"] if not v["builtin"] else "", v["id"]))

    def _roles_file(self) -> Path:
        return self.root / "roles.json"

    def roles(self) -> dict[str, str]:
        try:
            saved = json.loads(self._roles_file().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        return {r: saved[r] if isinstance(saved.get(r), str) and self._meta(saved[r]) else self._default(r)
                for r in ROLES}

    def _default(self, role: str) -> str:
        vid = ROLE_DEFAULTS.get(role, DEFAULT_VOICE)
        return vid if self._meta(vid) else DEFAULT_VOICE

    def _write_roles(self, roles: dict[str, str]):
        self._roles_file().write_text(json.dumps(roles, ensure_ascii=False, indent=1), encoding="utf-8")

    def assign(self, role: str, voice_id: str):
        if role not in ROLES:
            raise ValueError(f"нет такой роли: {role}")
        if not self._meta(voice_id):
            raise ValueError(f"нет такого образца: {voice_id}")
        roles = self.roles()
        roles[role] = voice_id
        self._write_roles(roles)

    def save(self, name: str, audio: np.ndarray, sr: int, text: str, source: str) -> str:
        name = re.sub(r"\s+", " ", name).strip()[:60]
        if not name:
            raise ValueError("нужно имя голоса")
        base = _slug(name)
        vid, n = base, 1
        while (self.dir / vid).exists():
            n += 1
            vid = f"{base}-{n}"
        d = self.dir / vid
        d.mkdir(parents=True)
        write_wav(d / "ref.wav", audio, sr)
        meta = {"name": name, "text": text, "source": source, "date": _now(), "builtin": False}
        (d / "ref.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        return vid

    def delete(self, voice_id: str):
        m = self._meta(voice_id)
        if not m:
            raise ValueError(f"нет такого образца: {voice_id}")
        if m.get("builtin"):
            raise ValueError("встроенный образец не удаляется")
        roles = self.roles()
        shutil.rmtree(self.dir / voice_id)
        self._write_roles({r: self._default(r) if v == voice_id else v for r, v in roles.items()})

    def ref(self, voice_id: str) -> tuple[Path, str]:
        m = self._meta(voice_id)
        if not m:
            raise KeyError(voice_id)
        return self.dir / voice_id / "ref.wav", m.get("text", "")


# ---------------------------------------------------------------- проверка записи


def _words(s: str) -> list[str]:
    s = s.lower().replace("ё", "е")
    return re.findall(r"\w+", s)


def wer(expected: str, heard: str) -> float:
    """Доля ошибок по словам (замены, пропуски, вставки) — нижний регистр, ё→е, без знаков."""
    a, b = _words(expected), _words(heard)
    if not a:
        return 0.0 if not b else 1.0
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1] / len(a)


def _db(x: float) -> float:
    return 20 * np.log10(max(x, 1e-6))


def _windows(a: np.ndarray, sr: int) -> tuple[int, np.ndarray]:
    win = max(1, int(0.02 * sr))
    n = len(a) // win
    return win, (np.sqrt(np.mean(a[: n * win].reshape(n, win) ** 2, axis=1)) if n else np.zeros(0))


def trim_silence(audio: np.ndarray, sr: int) -> np.ndarray:
    """Запись без тишины по краям: речь — окна по 20 мс не тише 35 дБ от самого громкого; 0,05 с запаса перед
    речью, 0,4 с естественной паузы в конце. Пустая запись — пустой массив."""
    a = np.asarray(audio, np.float32).reshape(-1)
    win, rms = _windows(a, sr)
    if not len(rms) or float(np.max(rms)) <= 0:
        return np.zeros(0, np.float32)
    voiced = np.nonzero(rms >= float(np.max(rms)) * 10 ** (-35 / 20))[0]
    start = max(0, voiced[0] * win - int(REC_LEAD_S * sr))
    end = (voiced[-1] + 1) * win
    tail = a[end: end + int(REC_TAIL_S * sr)]
    return np.concatenate([a[start:end], tail, np.zeros(int(REC_TAIL_S * sr) - len(tail), np.float32)])


def check_recording(audio: np.ndarray, sr: int, expected: str, heard: str) -> dict:
    """Проверка записи образца: обрезка тишины по краям (trim_silence), громкость, сигнал/шум, длина,
    распознанное против текста. {ok, reasons, audio, …}: причины — коротко, для «перечитайте»."""
    a = np.asarray(audio, np.float32).reshape(-1)
    win, rms = _windows(a, sr)
    n = len(rms)
    peak = float(np.max(np.abs(a))) if len(a) else 0.0
    reasons = []
    info = {"peak_db": round(_db(peak), 1)}
    if n == 0 or peak < 10 ** (REC_PEAK_DB / 20):
        reasons.append(f"тихо: пик {_db(peak):.0f} дБ, нужно не ниже {REC_PEAK_DB:.0f} дБ — говорите ближе к микрофону")
        return {"ok": False, "reasons": reasons, "audio": np.zeros(0, np.float32), "audio_s": 0.0, **info}
    out = trim_silence(a, sr)
    dur = len(out) / sr
    info["audio_s"] = round(dur, 2)
    # сигнал/шум: громкая часть (90-й процентиль окон) против фона (10-й) по всей записи
    snr = _db(float(np.percentile(rms, 90))) - _db(float(np.percentile(rms, 10)))
    info["snr_db"] = round(snr, 1)
    if snr < REC_SNR_DB:
        reasons.append(f"шум: сигнал/шум {snr:.0f} дБ, нужно от {REC_SNR_DB:.0f} дБ — запишите в тихом месте")
    if dur < REC_MIN_S:
        reasons.append(f"коротко: {dur:.1f} с, нужно {REC_MIN_S:.0f}–{REC_MAX_S:.0f} с — прочитайте весь текст")
    elif dur > REC_MAX_S:
        reasons.append(f"длинно: {dur:.1f} с, нужно {REC_MIN_S:.0f}–{REC_MAX_S:.0f} с")
    w = wer(expected, heard)
    info["wer"] = round(w, 2)
    if w > REC_WER:
        reasons.append(f"текст: распознано не то, что написано (ошибок по словам {w:.0%}, допустимо до {REC_WER:.0%}) "
                       "— перечитайте текст")
    return {"ok": not reasons, "reasons": reasons, "audio": out, **info}
