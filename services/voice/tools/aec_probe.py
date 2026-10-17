#!/usr/bin/env python3
"""Проверка подавления эха на синтетике (без Mac).

Модель комнаты: голос штаба (опора, 24 кГц — ровно то, что сервис отдаёт в динамики) проходит
задержку, фильтр нижних частот ~4 кГц и реверберацию (экспоненциальный хвост ~0,3 с) и попадает
в микрофон (16 кГц) примерно так же громко, как голос человека; к этому добавляются речь человека
на части отрезков (в том числе одновременно со штабом) и лёгкий шум. Смесь прогоняется через
WebRTC AEC3 из пакета livekit (`rtc.AudioProcessingModule`) кадрами по 10 мс: опора —
`process_reverse_stream` (24 кГц), микрофон — `process_stream` (16 кГц).

Меры (подробно — в aec_probe.md):
  ERLE, дБ          — ослабление эха на отрезках «только штаб» с 5-й секунды (окна 0,25 с, где эхо есть);
  схождение, с      — от начала эха до окна, начиная с которого ERLE держится ≥ 20 дБ;
  восстановление, с — после начала каждой фразы до первого окна с ERLE ≥ 20 дБ (медиана);
  ослабление речи   — на отрезках «оба говорят» и «только человек», по модулю спектра (выше 100 Гц)
                      в ячейках, где человек громче эха с шумом на 6 дБ и больше;
  спектральное SNR  — речь человека к ошибке модуля спектра выхода (и, для сравнения, микрофона);
  эхо при «оба»     — ослабление эха в ячейках, где эхо громче человека на 6 дБ и больше.

Случаи: задержка эха 50/150/300 мс с подсказкой задержки и без, опора 16 кГц, постоянный сдвиг
+30 мс, сдвиг ±20–40 мс на каждый ответ штаба и на каждую фразу, ±5–10 мс на каждую фразу.

Запуск (речь не хранится в репозитории — пути к любым WAV с русской речью):
  python aec_probe.py --ref штаб.wav [--ref ещё.wav] --human человек.wav [--seed 1] [--save-dir каталог]
Код возврата 0 — все случаи прошли пороги, 1 — хотя бы один нет (случаи с джиттером на фразу — нет).

Нужны numpy, scipy, livekit (pip install numpy scipy livekit).
"""

from __future__ import annotations

import argparse
import sys
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import signal

MIC_SR = 16000
REF_SR = 24000
FRAME_MS = 10
ERLE_OK_DB = 20.0
ATTEN_OK_DB = 3.0

# Разметка сцены, секунды: (начало, конец).
CHIEF = [(0.0, 30.0), (37.0, 52.0)]  # штаб говорит
HUMAN = [(15.0, 21.0), (30.5, 36.5), (38.0, 44.0)]  # человек говорит
SCENE_LEN = 54.0
SEGMENTS = [  # (метка, начало, конец) — участки для мер
    ("эхо-1", 0.0, 14.5),
    ("оба-1", 15.0, 21.0),
    ("эхо-2", 22.0, 30.0),
    ("человек", 30.5, 36.5),
    ("оба-2", 38.0, 44.0),
    ("эхо-3", 45.0, 52.0),
]


# ---------------------------------------------------------------- ввод-вывод


def read_wav(path: str, sr: int) -> np.ndarray:
    with wave.open(path, "rb") as w:
        n, ch, sw, rate = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if sw != 2:
        raise SystemExit(f"{path}: нужен 16-битный PCM WAV")
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != sr:
        g = np.gcd(rate, sr)
        x = signal.resample_poly(x, sr // g, rate // g)
    return x


def write_wav(path: Path, x: np.ndarray, sr: int) -> None:
    y = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2) + 1e-20))


def active_rms(x: np.ndarray, sr: int) -> float:
    """Среднеквадратичное по 20-мс окнам, где речь есть (не тише −35 дБ от максимума)."""
    n = sr // 50
    e = np.array([np.mean(x[i : i + n] ** 2) for i in range(0, len(x) - n, n)])
    keep = e > e.max() * 10 ** (-35 / 10)
    return float(np.sqrt(e[keep].mean()))


def db(x: float) -> float:
    return 10 * np.log10(max(x, 1e-20))


# ---------------------------------------------------------------- сцена


@dataclass
class Scene:
    ref: np.ndarray  # опора, 24 кГц — то, что подаётся в process_reverse_stream
    echo: np.ndarray  # эхо в микрофоне, 16 кГц
    human: np.ndarray  # чистая речь человека в микрофоне, 16 кГц
    noise: np.ndarray
    mic: np.ndarray
    phrase_offsets_ms: list[float] = field(default_factory=list)
    phrase_starts_s: list[float] = field(default_factory=list)  # когда фраза зазвучала в микрофоне


def room_ir(sr: int, rt_s: float, rng: np.random.Generator) -> np.ndarray:
    """Прямой путь + ранние отражения + экспоненциальный хвост (спад на 60 дБ за rt_s)."""
    n = int(sr * rt_s)
    t = np.arange(n) / sr
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / rt_s)
    tail[: int(0.005 * sr)] = 0  # хвост начинается через ~5 мс после прямого звука
    ir = 0.25 * tail / np.sqrt(np.sum(tail**2))
    ir[0] = 1.0
    for d_ms, a in ((3.1, 0.5), (7.3, -0.35), (11.9, 0.25)):
        ir[int(d_ms * sr / 1000)] += a
    return ir


def tile_to(x: np.ndarray, n: int) -> np.ndarray:
    reps = int(np.ceil(n / len(x)))
    return np.tile(x, reps)[:n]


def build_scene(
    ref_src: np.ndarray,
    human_src: np.ndarray,
    delay_ms: float,
    jitter_ms: tuple[float, float] | None,
    seed: int,
    jitter_per: str = "phrase",
) -> Scene:
    rng = np.random.default_rng(seed)
    n_ref = int(SCENE_LEN * REF_SR)
    n_mic = int(SCENE_LEN * MIC_SR)

    # Опора: штаб говорит фразами по 3–5 с с паузами 0,3 с внутри отрезков CHIEF.
    ref = np.zeros(n_ref)
    phrases: list[tuple[int, np.ndarray, int]] = []  # (начало в отсчётах 24 кГц, фраза, № ответа)
    pos_src = 0
    for blk, (a, b) in enumerate(CHIEF):
        t = a
        while t < b - 0.5:
            dur = min(rng.uniform(3.0, 5.0), b - t)
            n = int(dur * REF_SR)
            src = tile_to(np.roll(ref_src, -pos_src), n)
            pos_src = (pos_src + n) % len(ref_src)
            fade = np.ones(n)
            k = int(0.01 * REF_SR)
            fade[:k] = np.linspace(0, 1, k)
            fade[-k:] = np.linspace(1, 0, k)
            s = int(t * REF_SR)
            ph = src * fade
            ref[s : s + n] += ph
            phrases.append((s, ph, blk))
            t += dur + 0.3
    scale = 0.1 / active_rms(ref, REF_SR)  # уровень воспроизведения ~ −20 дБFS
    ref *= scale

    # Звук из динамика: каждая фраза — со своим сдвигом (джиттер вывода) поверх общей задержки.
    played = np.zeros(n_ref + REF_SR)
    offsets, starts = [], []
    # jitter_per="phrase": сдвиг меняется у каждой фразы; "utterance": один сдвиг на весь ответ штаба.
    jit_rng = np.random.default_rng(seed + 1000)
    blk_off: dict[int, float] = {}
    for s, ph, blk in phrases:
        j = 0.0
        if jitter_ms:
            if jitter_per == "phrase" or blk not in blk_off:
                blk_off[blk] = jit_rng.uniform(*jitter_ms) * jit_rng.choice([-1, 1])
            j = blk_off[blk]
        offsets.append(j)
        d = s + int((delay_ms + j) * REF_SR / 1000)
        d = max(d, 0)
        starts.append(d / REF_SR)
        played[d : d + len(ph)] += ph * scale
    played = played[:n_ref]

    # Акустический путь: 24 → 16 кГц (ЦАП/АЦП), ФНЧ ~4 кГц (динамик ноутбука), комната.
    echo = signal.resample_poly(played, 2, 3)[:n_mic]
    sos = signal.butter(4, 4000, "low", fs=MIC_SR, output="sos")
    echo = signal.sosfilt(sos, echo)
    echo = signal.fftconvolve(echo, room_ir(MIC_SR, 0.3, rng))[:n_mic]

    # Человек: куски записи из разных мест, громкость как у эха.
    human = np.zeros(n_mic)
    hpos = int(rng.uniform(0, max(1, len(human_src) - 30 * MIC_SR)))
    for a, b in HUMAN:
        n = int((b - a) * MIC_SR)
        human[int(a * MIC_SR) : int(a * MIC_SR) + n] = tile_to(np.roll(human_src, -hpos), n)
        hpos = (hpos + n + 3 * MIC_SR) % len(human_src)
    target = 0.1  # активный уровень речи человека в микрофоне, ~ −20 дБFS
    human *= target / active_rms(human, MIC_SR)
    echo *= target / active_rms(echo, MIC_SR)  # эхо примерно так же громко, как человек

    # Лёгкий шум: розоватый, на 45 дБ тише речи.
    w = rng.standard_normal(n_mic)
    noise = signal.lfilter([1], [1, -0.95], w)
    noise *= target * 10 ** (-45 / 20) / rms(noise)

    peak = np.max(np.abs(echo + human + noise))
    if peak > 0.9:  # пики (щелчки, громкие слоги) — уменьшить всю сцену, а не срезать
        k = 0.9 / peak
        echo, human, noise = echo * k, human * k, noise * k
    mic = echo + human + noise
    return Scene(ref=ref, echo=echo, human=human, noise=noise, mic=mic, phrase_offsets_ms=offsets, phrase_starts_s=starts)


# ---------------------------------------------------------------- AEC3 (livekit)


def run_livekit(scene: Scene, stream_delay_ms: int, ref_rate: int = REF_SR) -> np.ndarray:
    from livekit import rtc

    apm = rtc.AudioProcessingModule(
        echo_cancellation=True, noise_suppression=False, high_pass_filter=False, auto_gain_control=False
    )
    ref = scene.ref if ref_rate == REF_SR else signal.resample_poly(scene.ref, 2, 3)
    rn = ref_rate * FRAME_MS // 1000
    mn = MIC_SR * FRAME_MS // 1000
    n_frames = len(scene.mic) // mn
    ref_i16 = np.clip(ref * 32768, -32768, 32767).astype(np.int16)
    mic_i16 = np.clip(scene.mic * 32768, -32768, 32767).astype(np.int16)
    out = np.zeros(n_frames * mn)
    for k in range(n_frames):
        r = ref_i16[k * rn : (k + 1) * rn]
        if len(r) < rn:
            r = np.pad(r, (0, rn - len(r)))
        rf = rtc.AudioFrame(r.tobytes(), ref_rate, 1, rn)
        apm.process_reverse_stream(rf)
        mf = rtc.AudioFrame(mic_i16[k * mn : (k + 1) * mn].tobytes(), MIC_SR, 1, mn)
        apm.set_stream_delay_ms(min(max(stream_delay_ms, 0), 500))  # перед каждым process_stream; вне 0–500 — ошибка
        apm.process_stream(mf)
        out[k * mn : (k + 1) * mn] = np.frombuffer(bytes(mf.data), dtype=np.int16) / 32768.0
    return out


# ---------------------------------------------------------------- меры
#
# Выход AEC3 сдвинут на ~8 мс и по фазе не совпадает с входом даже без эха (проверено: без опоры
# энергия и спектр речи сохраняются с точностью 0,1–0,5 дБ, а SI-SDR — лишь 3–10 дБ). Поэтому речь
# человека оценивается по модулю спектра (STFT 32 мс), а не по форме волны: распознавателю важен спектр.


def sl(a: float, b: float) -> slice:
    return slice(int(a * MIC_SR), int(b * MIC_SR))


def erle_windows(scene: Scene, out: np.ndarray, a: float, b: float, win: float = 0.25):
    """ERLE по окнам, где эхо заметно (не тише −25 дБ от активного уровня эха)."""
    n = int(win * MIC_SR)
    ref_lvl = active_rms(scene.echo, MIC_SR) ** 2
    res = []
    for s in range(int(a * MIC_SR), int(b * MIC_SR) - n + 1, n):
        e = np.mean(scene.echo[s : s + n] ** 2)
        if e < ref_lvl * 10 ** (-25 / 10):
            continue
        m = np.mean(scene.mic[s : s + n] ** 2)
        o = np.mean(out[s : s + n] ** 2)
        res.append((s / MIC_SR, db(m) - db(o), m, o))
    return res


def erle(scene: Scene, out: np.ndarray, a: float, b: float) -> float:
    w = erle_windows(scene, out, a, b)
    return db(sum(x[2] for x in w)) - db(sum(x[3] for x in w))


def convergence_s(scene: Scene, out: np.ndarray) -> float:
    """От начала эха до окна, начиная с которого ≥ 80 % окон первого отрезка держат 20 дБ."""
    w = erle_windows(scene, out, 0.0, 14.5)
    onset = w[0][0] if w else 0.0
    for i in range(len(w)):
        tail = [x[1] >= ERLE_OK_DB for x in w[i:]]
        if tail[0] and np.mean(tail) >= 0.8:
            return w[i][0] - onset
    return float("nan")


SPEECH_LO_HZ = 100  # ниже — не речь; AEC3 сам срезает этот диапазон (встроенный ФВЧ ~80–100 Гц)


def spec(x: np.ndarray) -> np.ndarray:
    f, _, z = signal.stft(x, fs=MIC_SR, nperseg=512, noverlap=256)
    return np.abs(z[f >= SPEECH_LO_HZ]) ** 2


def human_measures(scene: Scene, out: np.ndarray, a: float, b: float) -> tuple[float, float, float, float]:
    """(ослабление речи, дБ; спектральное SNR выхода, дБ; то же для микрофона, дБ; ослабление эха, дБ).

    Все меры — в полосе речи от 100 Гц. Ослабление — по ячейкам «время × частота», где человек громче эха с шумом на 6 дБ и больше:
    10·lg(Σ|H|² / Σ|Y|²). Спектральное SNR — 10·lg(Σ|H|² / Σ(|Y| − |H|)²) по всем ячейкам:
    в ошибку входят и остаток эха, и искажение речи. Ослабление эха при двойном разговоре —
    10·lg(Σ|X|² / Σ|Y|²) по ячейкам, где эхо громче человека на 6 дБ и больше (X — микрофон).
    """
    s = sl(a, b)
    H = spec(scene.human[s])
    D = spec(scene.mic[s] - scene.human[s])
    Y = spec(out[s])
    X = spec(scene.mic[s])
    dom = (H > 4 * D) & (H > H.max() * 1e-5)
    atten = db(H[dom].sum()) - db(Y[dom].sum())
    edom = (D > 4 * H) & (D > D.max() * 1e-5)
    echo_sup = db(X[edom].sum()) - db(Y[edom].sum()) if edom.any() else float("nan")

    def msnr(Z: np.ndarray) -> float:
        return db(H.sum()) - db(((np.sqrt(Z) - np.sqrt(H)) ** 2).sum())

    return atten, msnr(Y), msnr(X), echo_sup


def lag_samples(clean: np.ndarray, y: np.ndarray, max_lag: int = 400) -> int:
    c = signal.correlate(y, clean, mode="full", method="fft")
    mid = len(clean) - 1
    seg = c[mid - max_lag : mid + max_lag + 1]
    return int(np.argmax(seg) - max_lag)


@dataclass
class Result:
    name: str
    erle: dict[str, float]
    share: float  # доля окон с эхом после 5-й секунды, где ERLE ≥ 20 дБ
    conv: float
    atten: dict[str, float]
    snr: dict[str, float]
    snr_mic: dict[str, float]
    dt_echo: dict[str, float]  # ослабление эха при двойном разговоре, дБ
    recover: float  # медиана: от начала фразы до первого окна с ERLE ≥ 20 дБ, с


def measure(name: str, scene: Scene, out: np.ndarray, lag: int) -> Result:
    if lag > 0:
        out = np.concatenate([out[lag:], np.zeros(lag)])
    er, at, sn, snm, de = {}, {}, {}, {}, {}
    wins = []
    for label, a, b in SEGMENTS:
        if label.startswith("эхо"):
            a2 = max(a, 5.0)  # после схождения
            er[label] = erle(scene, out, a2, b)
            wins += erle_windows(scene, out, a2, b)
        else:
            at[label], sn[label], snm[label], de[label] = human_measures(scene, out, a, b)
    share = float(np.mean([w[1] >= ERLE_OK_DB for w in wins]))
    rec = []
    for t0 in scene.phrase_starts_s:
        if t0 < 5.0 or not any(a <= t0 and t0 + 1.0 <= b for lb, a, b in SEGMENTS if lb.startswith("эхо")):
            continue
        w = erle_windows(scene, out, t0, t0 + 3.0)
        ok = [x[0] for x in w if x[1] >= ERLE_OK_DB]
        rec.append((ok[0] - t0) if ok else 3.0)
    recover = float(np.median(rec)) if rec else float("nan")
    return Result(name, er, share, convergence_s(scene, out), at, sn, snm, de, recover)


def verdict(r: Result) -> bool:
    return min(r.erle.values()) >= ERLE_OK_DB and max(r.atten.values()) <= ATTEN_OK_DB


def fmt_s(x: float) -> str:
    return "нет" if np.isnan(x) else f"{max(x, 0.0):.2f}"


def print_table(results: list[Result]) -> None:
    cols = [
        ("случай", 40),
        ("ERLE эхо-1/2/3, дБ", 20),
        ("≥20 дБ", 7),
        ("сход., с", 8),
        ("восст., с", 9),
        ("ослабл. оба-1/оба-2/чел., дБ", 28),
        ("спектр. SNR выход (микрофон), дБ", 36),
        ("эхо при «оба», дБ", 17),
    ]
    print(" ".join(f"{c:<{w}}" if i == 0 else f"{c:>{w}}" for i, (c, w) in enumerate(cols)) + "  итог")
    print("-" * (sum(w for _, w in cols) + len(cols) + 10))
    for r in results:
        e = "/".join(f"{r.erle[k]:.1f}" for k in ("эхо-1", "эхо-2", "эхо-3"))
        a = "/".join(f"{r.atten[k]:+.1f}" for k in ("оба-1", "оба-2", "человек"))
        s = "/".join(f"{r.snr[k]:.1f}" for k in ("оба-1", "оба-2", "человек"))
        sm = "/".join(f"{r.snr_mic[k]:.1f}" for k in ("оба-1", "оба-2", "человек"))
        de = "/".join(f"{r.dt_echo[k]:.1f}" for k in ("оба-1", "оба-2"))
        vals = [r.name, e, f"{r.share * 100:.0f}%", fmt_s(r.conv), fmt_s(r.recover), a, f"{s} ({sm})", de]
        print(
            " ".join(f"{v:<{w}}" if i == 0 else f"{v:>{w}}" for i, (v, (_, w)) in enumerate(zip(vals, cols)))
            + f"  {'годится' if verdict(r) else 'НЕ годится'}"
        )


# ---------------------------------------------------------------- main


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ref", action="append", required=True, help="WAV с речью штаба (можно несколько)")
    p.add_argument("--human", required=True, help="WAV с речью человека (другой голос)")
    p.add_argument("--delays", default="50,150,300", help="задержки эха, мс")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--save-dir", help="сохранить микрофон/выход каждого случая в WAV (только для прослушивания)")
    args = p.parse_args()

    ref_src = np.concatenate([read_wav(f, REF_SR) for f in args.ref])
    human_src = read_wav(args.human, MIC_SR)
    # Гул ниже 100 Гц (бывает в записях) — не речь: убрать, чтобы громкость человека считалась по речи.
    human_src = signal.sosfiltfilt(signal.butter(4, SPEECH_LO_HZ, "high", fs=MIC_SR, output="sos"), human_src)
    delays = [int(x) for x in args.delays.split(",")]
    mid = delays[len(delays) // 2]

    # (название, задержка, джиттер, на что джиттер, подсказка задержки, частота опоры)
    cases = []
    for d in delays:
        cases.append((f"{d} мс, подсказка {d}", d, None, "phrase", d, REF_SR))
        cases.append((f"{d} мс, подсказка 0", d, None, "phrase", 0, REF_SR))
    cases.append((f"{mid} мс, опора 16 кГц", mid, None, "phrase", mid, MIC_SR))
    cases.append((f"{mid}+30 мс постоянно, подсказка {mid}", mid + 30, None, "phrase", mid, REF_SR))
    for d in delays:
        cases.append((f"{d} мс ±20–40 на ответ", d, (20.0, 40.0), "utterance", d, REF_SR))
    for d in delays:
        cases.append((f"{d} мс ±20–40 на каждую фразу", d, (20.0, 40.0), "phrase", d, REF_SR))
    cases.append((f"{mid} мс ±5–10 на каждую фразу", mid, (5.0, 10.0), "phrase", mid, REF_SR))

    results = []
    for name, d, jit, per, hint, rr in cases:
        sc = build_scene(ref_src, human_src, d, jit, args.seed, per)
        out = run_livekit(sc, hint, rr)
        lag = lag_samples(sc.human[sl(30.5, 36.5)], out[sl(30.5, 36.5)])
        results.append(measure(name, sc, out, lag))
        if args.save_dir:
            dd = Path(args.save_dir)
            dd.mkdir(parents=True, exist_ok=True)
            tag = f"d{d}-{per if jit else 'fix'}-h{hint}-r{rr // 1000}"
            write_wav(dd / f"{tag}-mic.wav", sc.mic, MIC_SR)
            write_wav(dd / f"{tag}-out.wav", out, MIC_SR)
        print(f"  готово: {name} (сдвиг выхода {lag} отсч.)", file=sys.stderr)
    print()
    print(f"Пороги: ERLE ≥ {ERLE_OK_DB:.0f} дБ после схождения; речь человека ослаблена не больше {ATTEN_OK_DB:.0f} дБ.")
    print("ERLE и «≥20 дБ» (доля окон 0,25 с) — с 5-й секунды; «сход.» — от начала эха до устойчивых 20 дБ")
    print("(«нет» — устойчивых 20 дБ на первом отрезке так и не было).")
    print("«восст.» — медиана по фразам: от начала фразы до первого окна с ERLE ≥ 20 дБ (шаг 0,25 с).")
    print("Ослабление «+» — речь тише, «−» — громче. Спектральное SNR в скобках — микрофон до обработки.")
    print("«эхо при «оба»» — насколько ослаблено эхо в тех ячейках спектра, где оно громче человека.")
    print()
    print_table(results)
    return 0 if all(verdict(r) for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
