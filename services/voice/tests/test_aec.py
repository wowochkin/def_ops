"""Подавление эха: синтетика проверки Task 4 (опора — звук штаба, эхо — он же через задержку, фильтр и реверберацию
комнаты, человек — другой «голос») через EchoCanceller и через сессию --fake с двухканальными кадрами окна."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

import aec
from server import MIC_REF, aec_enabled, build_app, parse_mic
from tests.test_server import recv, until
from tests.test_voices import make_seed

SR = 16000
needs_aec = pytest.mark.skipif(not aec.available(), reason="нет пакета livekit (подавление эха) — проверка пропущена")


def voice(sec: float, f0: float, seed: int, amp: float = 0.3) -> np.ndarray:
    """«Речь»: слоги случайной длины (тон плавает от слога к слогу, гармоники), паузы между словами, шумовые
    «согласные» в начале слогов. Слишком ровный тон AEC3 учит хуже живой речи — так ближе к ней."""
    rng = np.random.default_rng(seed)
    n = int(sec * SR)
    f, env, hiss = np.zeros(n), np.zeros(n), np.zeros(n)
    i = 0
    while i < n:
        m = min(n - i, int(rng.uniform(0.12, 0.3) * SR))
        f[i:i + m] = f0 * rng.uniform(0.8, 1.3) * np.linspace(1, rng.uniform(0.85, 1.15), m)
        env[i:i + m] = np.sin(np.pi * np.arange(m) / m) ** 0.5
        hiss[i:i + min(m, int(0.04 * SR))] = rng.uniform(0.2, 0.8)
        i += m + int((rng.uniform(0, 0.15) if rng.random() < 0.7 else rng.uniform(0.2, 0.4)) * SR)
    ph = 2 * np.pi * np.cumsum(f) / SR
    v = sum(np.sin(h * ph + rng.uniform(0, 6)) / h for h in range(1, 12)) * env + rng.standard_normal(n) * hiss
    return (amp * v / np.sqrt(np.mean(v ** 2)) / 2.5).astype(np.float32)


def room(ref: np.ndarray, delay_ms: float = 150, seed: int = 7) -> np.ndarray:
    """Путь «динамик → микрофон»: задержка, фильтр нижних частот ~4 кГц, ранние отражения и хвост RT60 0,3 с."""
    rng = np.random.default_rng(seed)
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / 0.3) * 0.08
    ir[0] += 0.8
    for ms, g in ((7, 0.4), (13, -0.3), (21, 0.2)):
        ir[int(ms * SR / 1000)] += g
    k = np.arange(-32, 33)
    lp = np.sinc(2 * 4000 / SR * k) * np.hamming(len(k))
    ir = np.convolve(ir, lp / lp.sum())
    d = int(delay_ms * SR / 1000)
    out = np.convolve(np.concatenate([np.zeros(d), ref]), ir)[: len(ref)]
    return (out * np.sqrt(np.mean(ref ** 2)) / np.sqrt(np.mean(out ** 2) + 1e-12)).astype(np.float32)


def rms_db(a: np.ndarray) -> float:
    return 10 * np.log10(np.mean(np.square(a, dtype=np.float64)) + 1e-12)


def run(ec, mic: np.ndarray, ref: np.ndarray, frame: int = 512) -> np.ndarray:
    return np.concatenate([ec.process(mic[i:i + frame], ref[i:i + frame]) for i in range(0, len(mic), frame)])


def fake_vad(a: np.ndarray) -> np.ndarray:
    """Уверенность «речи» по кадрам 512 — как у поддельных моделей (громкость кадра × 10)."""
    k = len(a) // 512
    return np.minimum(1.0, np.sqrt(np.mean(a[: k * 512].reshape(k, 512) ** 2, axis=1)) * 10)


# ------------------------------------------------------------ EchoCanceller


@needs_aec
def test_echo_falls_below_vad_threshold_speech_survives():
    chief = voice(8, 120, 1)
    echo = room(chief)
    human = voice(8, 190, 11)
    noise = (np.random.default_rng(3).standard_normal(len(chief)) * 1e-3).astype(np.float32)
    ec = aec.EchoCanceller()
    # 0–4 с — только эхо штаба; 4–8 с — штаб и человек одновременно
    mic = echo + noise
    mic[4 * SR:] += human[4 * SR:]
    out = run(ec, mic, chief)
    assert out.dtype == np.float32 and len(out) == len(mic)
    s = slice(SR, 4 * SR)  # с секунды: модуль привязался к опоре (на живой речи — сразу, на синтетике — не всегда)
    erle = rms_db(mic[s]) - rms_db(out[s])
    assert erle >= 20, f"эхо ослаблено на {erle:.1f} дБ"
    assert fake_vad(out[s]).max() < 0.5  # ниже порога речи в тишине…
    assert np.mean(fake_vad(mic[s]) > 0.5) > 0.6  # …а без подавления эхо — «речь»
    # двойной разговор: речь человека приглушается (в проверке Task 4 — на 2–5 дБ), но остаётся куда громче
    # остатка эха
    d = slice(4 * SR + SR // 2, 8 * SR)
    loss = rms_db(human[d]) - rms_db(out[d])
    assert loss < 8, f"речь поверх штаба потеряла {loss:.1f} дБ"
    assert rms_db(out[d]) - rms_db(out[s]) > 15


@needs_aec
def test_speech_without_chief_kept():
    """Штаб молчит (опора — нули): речь человека почти не меняется по громкости."""
    human = voice(4, 190, 2)
    ec = aec.EchoCanceller()
    out = run(ec, human, np.zeros_like(human))
    loss = rms_db(human[SR:]) - rms_db(out[SR:])
    assert abs(loss) < 1, f"речь изменилась на {loss:.1f} дБ"


@needs_aec
def test_any_frame_length_same_length_out():
    ec = aec.EchoCanceller()
    a = voice(1, 150, 4)
    outs = [ec.process(a[i:i + n], np.zeros(n, np.float32)) for i, n in ((0, 100), (100, 512), (612, 7), (619, 381))]
    assert [len(o) for o in outs] == [100, 512, 7, 381]


def test_aec_enabled_choice():
    assert aec_enabled(None, True) is True and aec_enabled(None, False) is False
    assert aec_enabled("off", True) is False
    assert aec_enabled("on", True) is True
    with pytest.raises(SystemExit):
        aec_enabled("on", False)  # подавление эха просили, а пакета нет — понятная ошибка при запуске


def test_parse_mic_frames():
    mic = (np.arange(512) - 256).astype("<i2")
    ref = (np.arange(512) * 3 - 700).astype("<i2")
    m, r = parse_mic(mic.tobytes())
    assert r is None and np.allclose(m * 32768, mic)
    m, r = parse_mic(bytes([MIC_REF]) + mic.tobytes() + ref.tobytes())
    assert np.allclose(m * 32768, mic) and np.allclose(r * 32768, ref)
    with pytest.raises(ValueError):
        parse_mic(bytes([MIC_REF]) + mic.tobytes() + ref[:-1].tobytes())  # каналы разной длины


# ------------------------------------------------------------ сессия --fake


def stereo(mic: np.ndarray, ref: np.ndarray) -> list[bytes]:
    q = lambda a: (np.clip(a, -1, 1) * 32767).astype("<i2")
    m, r = q(mic), q(ref)
    return [bytes([MIC_REF]) + m[i:i + 512].tobytes() + r[i:i + 512].tobytes() for i in range(0, len(m), 512)]


@pytest.fixture
def client(tmp_path):
    def make(*extra, script=None):
        args = ["--data", str(tmp_path / "data"), "--seed-refs", str(make_seed(tmp_path / "seed")), "--fake",
                "--end-ms", "400", *extra]
        if script is not None:
            f = tmp_path / "script.txt"
            f.write_text("\n".join(script) + "\n", encoding="utf-8")
            args += ["--fake-script", str(f)]
        return TestClient(build_app(args))
    return make


def session(c):
    ws = c.websocket_connect("/ws").__enter__()
    ready = until(ws, "ready")
    until(ws, "settings")
    return ws, ready


def drain(ws, kinds=("speech", "utterance", "barge")) -> list[dict]:
    """Сообщения до ответа на `settings` (он приходит после всех кадров, отправленных раньше)."""
    ws.send_text(json.dumps({"type": "settings"}))
    seen = []
    while True:
        m = recv(ws)
        if isinstance(m, dict) and m["type"] == "settings":
            return seen
        if isinstance(m, dict) and m["type"] in kinds:
            seen.append(m)


@needs_aec
def test_session_echo_not_speech_human_is(client):
    ws, ready = session(client())
    assert ready["aec"] is True
    chief = voice(6, 120, 1)
    echo = room(chief)
    for b in stereo(echo[: 4 * SR], chief[: 4 * SR]):  # 4 с — только эхо штаба из динамиков
        ws.send_bytes(b)
    assert drain(ws) == []  # эхо после подавления — не речь
    human = np.concatenate([voice(1, 190, 2), np.zeros(SR, np.float32)])
    for b in stereo(echo[4 * SR:] + human, chief[4 * SR:]):  # человек заговорил поверх штаба
        ws.send_bytes(b)
    seen = drain(ws)
    assert {"type": "speech", "state": "start"} in seen
    ws.close()


def test_session_aec_off_echo_heard(client):
    """--aec off: двухканальный кадр — берётся только микрофон, эхо слышно как речь (как раньше)."""
    ws, ready = session(client("--aec", "off"))
    assert ready["aec"] is False
    chief = voice(2, 120, 1)
    for b in stereo(room(chief), chief):
        ws.send_bytes(b)
    assert {"type": "speech", "state": "start"} in drain(ws)
    ws.close()


def test_session_aec_off_uses_mic_channel_as_is(client):
    c = client("--aec", "off")
    ws, _ = session(c)
    m = c.app.state.service.models
    mic = voice(1, 150, 5, amp=0.05)  # тише: уверенность «речи» не упирается в 1
    for b in stereo(mic, voice(1, 120, 1)):
        ws.send_bytes(b)
    drain(ws)
    q = (np.clip(mic, -1, 1) * 32767).astype("<i2").astype(np.float32) / 32768
    assert np.allclose(list(m.vad_log)[-31:], fake_vad(q)[:31], atol=1e-3)
    ws.close()


def test_session_mono_frames_unchanged(client):
    """Кадры без опоры (окно без подавления эха) идут как раньше — и при включённом подавлении."""
    c = client()
    ws, _ = session(c)
    m = c.app.state.service.models
    mic = voice(1, 150, 5, amp=0.05)
    pcm = (np.clip(mic, -1, 1) * 32767).astype("<i2")
    for i in range(0, len(pcm), 512):
        ws.send_bytes(pcm[i:i + 512].tobytes())
    drain(ws)
    assert np.allclose(list(m.vad_log)[-31:], fake_vad(pcm.astype(np.float32) / 32768)[:31], atol=1e-3)
    ws.close()


def calibrate_over_speakers(ws, louder_db: float = 0) -> dict:
    """Калибровка, где эхо штаба в микрофоне так же громко, как голос человека (louder_db — человек громче на
    столько); опора — в кадрах окна."""
    chief = voice(12, 120, 1)
    echo = room(chief)
    human = voice(12, 190, 11, amp=0.3 * 10 ** (louder_db / 20))
    z = np.zeros(len(chief), np.float32)
    for step in ("noise", "speech", "echo", "over"):
        ws.send_text(json.dumps({"type": "calib", "step": step, "sec": 2}))
        n = int((until(ws, "calib_rec")["sec"] + 0.2) * SR)
        mic, ref = {"noise": (z, z), "speech": (human, z), "echo": (echo, chief), "over": (echo + human, chief)}[step]
        for b in stereo(mic[:n], ref[:n]):
            ws.send_bytes(b)
        until(ws, "calib_step")
    ws.send_text(json.dumps({"type": "calib", "step": "finish"}))
    return until(ws, "calib_result")


ECHO_STAT = "голос штаба в микрофоне"


@needs_aec
def test_calibration_hears_echo_after_aec(client):
    """Калибровка меряет эхо после подавления: оно тише порога речи. Перебивает человек громче динамиков — режим
    «голосом» (без подавления эха при тех же динамиках — «словом», см. ниже)."""
    ws, _ = session(client())
    r = calibrate_over_speakers(ws)
    assert r["stats"][ECHO_STAT] < 0.3 < r["cfg"]["vad"], r
    r = calibrate_over_speakers(ws, louder_db=6)
    assert r["cfg"]["barge_mode"] == "voice", r
    ws.close()


def test_calibration_without_aec_word_mode(client):
    ws, _ = session(client("--aec", "off"))
    r = calibrate_over_speakers(ws)
    assert r["stats"][ECHO_STAT] > 0.9, r
    r = calibrate_over_speakers(ws, louder_db=6)
    assert r["cfg"]["barge_mode"] == "word", r
    ws.close()


# ------------------------------------------------------------ перебивание словом при подавлении эха

CHIEF_STOPWORDS = "Хватит ждать, стоп машина на переправе, наступаем на рассвете всеми силами армии и фронта."


def word_session(c, chief_text: str):
    """Сессия в режиме «словом», штаб говорит (played не приходит — говорит до конца проверки)."""
    ws, ready = session(c)
    assert ready["aec"] is True
    ws.send_text(json.dumps({"type": "settings", "barge_mode": "word"}))
    assert until(ws, "settings")["barge_mode"] == "word"
    ws.send_text(json.dumps({"type": "say", "id": 5, "role": "chief", "text": chief_text}))
    while not isinstance(recv(ws), bytes):  # звук пошёл
        pass
    return ws


@needs_aec
def test_word_mode_aec_echo_with_stop_words_does_not_barge(client):
    """Подавление эха не мешает режиму «словом»: эхо фразы штаба (в ней «хватит» и «стоп») — не перебивание и не
    реплика, ни после подавления, ни если что-то из него всё же распозналось бы."""
    c = client(script=["{эхо}"] * 50)
    ws = word_session(c, CHIEF_STOPWORDS)
    chief = voice(6, 120, 1)
    for b in stereo(room(chief), chief):
        ws.send_bytes(b)
    seen = drain(ws, ("barge", "utterance", "echo"))
    assert seen == []
    ws.close()


@needs_aec
def test_word_mode_aec_stop_over_chief_barges(client):
    """Человек говорит «стоп» поверх штаба: речь проходит подавление эха, кусок распознаётся — штаб обрывается."""
    c = client(script=["стоп"] * 50)
    ws = word_session(c, CHIEF_STOPWORDS)
    chief = voice(6, 120, 1)
    echo = room(chief)
    for b in stereo(echo[: 3 * SR], chief[: 3 * SR]):  # сначала только эхо: подавление привязалось к опоре
        ws.send_bytes(b)
    assert drain(ws, ("barge", "utterance")) == []
    human = np.concatenate([voice(1.2, 190, 11), np.zeros(int(1.8 * SR), np.float32)])
    for b in stereo(echo[3 * SR:] + human, chief[3 * SR:]):
        ws.send_bytes(b)
    seen = drain(ws, ("barge", "utterance"))
    assert {"type": "barge", "id": 5} in seen, seen
    ws.close()
