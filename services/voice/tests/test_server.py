"""Протокол сервиса на поддельных моделях (--fake): кадры микрофона и JSON через FastAPI TestClient."""
import json
import struct

import numpy as np
import pytest
from fastapi.testclient import TestClient

from server import build_app
from tests.test_voices import make_seed
from voices import RECORD_TEXT

SR = 16000


def tone(sec: float, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(sec * SR)) / SR
    return (amp * np.sin(2 * np.pi * 200 * t)).astype(np.float32)


def silence(sec: float) -> np.ndarray:
    return np.zeros(int(sec * SR), np.float32)


def send_audio(ws, a: np.ndarray):
    pcm = (np.clip(a, -1, 1) * 32767).astype("<i2")
    for i in range(0, len(pcm), 512):
        ws.send_bytes(pcm[i:i + 512].tobytes())


def recv(ws):
    m = ws.receive()
    if m.get("bytes") is not None:
        return m["bytes"]
    return json.loads(m["text"])


def until(ws, kind: str, seen: list | None = None):
    """Сообщения до первого JSON типа kind; остальные — в seen."""
    while True:
        m = recv(ws)
        if isinstance(m, dict) and m["type"] == kind:
            return m
        if seen is not None:
            seen.append(m)


@pytest.fixture
def make_client(tmp_path):
    def make(script_lines=None):
        args = ["--data", str(tmp_path / "data"), "--seed-refs", str(make_seed(tmp_path / "seed")), "--fake",
                "--end-ms", "400"]
        if script_lines is not None:
            f = tmp_path / "script.txt"
            f.write_text("\n".join(script_lines) + "\n", encoding="utf-8")
            args += ["--fake-script", str(f)]
        return TestClient(build_app(args))
    return make


def connect(c):
    ws = c.websocket_connect("/ws").__enter__()
    ready = until(ws, "ready")
    return ws, ready


def test_health_ready(make_client):
    c = make_client()
    assert c.get("/health").json() == {"state": "ready"}


def test_ws_ready_lists_voices_and_roles(make_client):
    ws, ready = connect(make_client())
    assert ready["loaded"] is True
    assert ready["roles"] == {"chief": "zhukov-10s", "umpire": "zhukov-10s"}
    assert [v["id"] for v in ready["voices"]] == ["zhukov-10s"]
    assert ready["record_text"] == RECORD_TEXT
    s = until(ws, "settings")
    assert s["vad"] == 0.5 and s["end_ms"] == 400
    ws.send_text(json.dumps({"type": "hello", "settings": {"vad": 0.4, "end_ms": 300}}))
    s = until(ws, "settings")
    assert s["vad"] == 0.4 and s["end_ms"] == 300 and s["barge_vad"] == 0.8
    ws.close()


def test_ws_utterance_from_speech(make_client):
    ws, _ = connect(make_client(["Штаб, открой переигровку."]))
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    seen = []
    u = until(ws, "utterance", seen)
    assert u["text"] == "Штаб, открой переигровку."
    assert u["id"] == 1 and "continues" not in u
    assert 0.6 <= u["audio_s"] <= 1.4 and u["stt_ms"] >= 0
    assert {"type": "speech", "state": "start"} in seen and {"type": "speech", "state": "end"} in seen
    assert any(m["type"] == "level" and "busy" in m for m in seen if isinstance(m, dict))
    ws.close()


def test_ws_merge_continues(make_client):
    ws, _ = connect(make_client(["Штаб, дай", "три варианта."]))
    send_audio(ws, np.concatenate([tone(0.6), silence(1.0), tone(0.6), silence(2.0)]))
    u1 = until(ws, "utterance")
    u2 = until(ws, "utterance")
    assert u1["text"] == "Штаб, дай"
    assert u2["continues"] == u1["id"] and u2["id"] != u1["id"]
    assert u2["text"] == "Штаб, дай три варианта."
    ws.close()


def test_ws_no_merge_after_long_pause(make_client):
    ws, _ = connect(make_client(["Штаб, дай", "три варианта."]))
    send_audio(ws, np.concatenate([tone(0.6), silence(3.0), tone(0.6), silence(2.0)]))
    until(ws, "utterance")
    u2 = until(ws, "utterance")
    assert "continues" not in u2 and u2["text"] == "три варианта."
    ws.close()


def audio_header(b: bytes) -> tuple[int, int]:
    assert b[0] == 1
    return struct.unpack("<II", b[1:9])


def test_ws_say_audio_and_done(make_client):
    # say-done — весь звук фразы отправлен (played не ждётся); played от окна снимает «модель говорит»
    ws, _ = connect(make_client(["Штаб, повтори."]))
    ws.send_text(json.dumps({"type": "say", "id": 7, "role": "chief", "text": "Есть."}))
    seen = []
    done = until(ws, "say-done", seen)
    assert done == {"type": "say-done", "id": 7}
    chunks = [m for m in seen if isinstance(m, bytes)]
    assert chunks and all(audio_header(b) == (7, 24000) for b in chunks)
    assert sum(len(b) - 9 for b in chunks) // 2 > 0.2 * 24000
    ws.send_text(json.dumps({"type": "played", "id": 7}))
    # окно доиграло — речь дольше barge_ms уже не перебивание, а обычная реплика
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    seen = []
    u = until(ws, "utterance", seen)
    assert u["text"] == "Штаб, повтори."
    assert not any(isinstance(m, dict) and m["type"] == "barge" for m in seen)
    assert all(m["busy"] is False for m in seen if isinstance(m, dict) and m["type"] == "level")
    ws.close()


def test_ws_say_more_appends_to_phrase(make_client):
    ws, _ = connect(make_client())
    ws.send_text(json.dumps({"type": "say", "id": 3, "role": "umpire", "text": "Докладываю итоги хода. Против", "more": True}))
    ws.send_text(json.dumps({"type": "say", "id": 3, "role": "umpire", "text": "ник отошёл за реку."}))
    seen = []
    until(ws, "say-done", seen)
    chunks = [m for m in seen if isinstance(m, bytes)]
    assert chunks and all(audio_header(b)[0] == 3 for b in chunks)
    # ~15 знаков/с у поддельного синтеза: весь текст озвучен
    total = sum(len(b) - 9 for b in chunks) // 2 / 24000
    assert total > len("Докладываю итоги хода. Противник отошёл за реку.") / 15 * 0.9
    ws.close()


def test_ws_barge_stops_phrase(make_client):
    ws, _ = connect(make_client())
    ws.send_text(json.dumps({"type": "say", "id": 5, "role": "chief", "text": "Докладываю обстановку. " * 6}))
    while not isinstance(recv(ws), bytes):  # звук пошёл
        pass
    send_audio(ws, tone(0.6))
    b = until(ws, "barge")
    assert b["id"] == 5
    # после barge звука оборванной фразы нет: следующая фраза доходит до say-done без кадров id 5
    ws.send_text(json.dumps({"type": "say", "id": 6, "role": "chief", "text": "Есть."}))
    seen = []
    until(ws, "say-done", seen)
    ids = [audio_header(m)[0] for m in seen if isinstance(m, bytes)]
    assert ids and set(ids) == {6}
    ws.close()


def test_ws_speech_does_not_cut_preview(make_client):
    # проба голоса не перебивается звуком в микрофоне: её останавливают только stop, новая проба, отказ, закрытие окна
    ws, _ = connect(make_client(["Штаб, повтори."]))
    ws.send_text(json.dumps({"type": "voice", "op": "preview", "id": 21, "voice_id": "zhukov-10s"}))
    seen = []
    while not isinstance(m := recv(ws), bytes):  # звук пробы пошёл
        seen.append(m)
    seen.append(m)
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))  # речь дольше barge_ms и конец реплики
    until(ws, "utterance", seen)
    assert not any(isinstance(m, dict) and m["type"] == "barge" for m in seen)
    if not any(isinstance(m, dict) and m["type"] == "say-done" for m in seen):
        until(ws, "say-done", seen)
    done = [m for m in seen if isinstance(m, dict) and m["type"] == "say-done"]
    assert done == [{"type": "say-done", "id": 21}]  # весь звук пробы отправлен, не оборван
    # проба ещё звучит у окна (played не пришёл) — её останавливает только stop
    ws.send_text(json.dumps({"type": "stop", "id": 21}))
    assert until(ws, "say-done") == {"type": "say-done", "id": 21, "stopped": True}
    ws.close()


def test_ws_calibration_flow(make_client):
    ws, _ = connect(make_client())
    steps = [("noise", silence(1.0)), ("speech", tone(1.0)), ("echo", None), ("over", None)]
    for step, a in steps:
        ws.send_text(json.dumps({"type": "calib", "step": step, "sec": 1}))
        rec = until(ws, "calib_rec")
        assert rec["step"] == step
        if a is None:  # шаги с голосом модели: тестовая фраза, кадры — сколько она звучит
            a = silence(rec["sec"]) if step == "echo" else tone(rec["sec"])
        send_audio(ws, np.concatenate([a, silence(0.2)]))
        st = until(ws, "calib_step")
        assert st["step"] == step and st["frames"] > 0
    ws.send_text(json.dumps({"type": "calib", "step": "finish"}))
    r = until(ws, "calib_result")
    assert "error" not in r, r
    assert set(r["cfg"]) == {"vad", "barge_vad", "barge_ms", "end_ms", "barge_mode"}
    s = until(ws, "settings")
    assert s["vad"] == r["cfg"]["vad"]
    ws.close()


def test_ws_record_voice_flow(make_client):
    ws, ready = connect(make_client([RECORD_TEXT]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-start"}))
    assert until(ws, "voice_recording")["text"] == RECORD_TEXT
    send_audio(ws, np.concatenate([silence(1.0), tone(9.0), silence(1.0)]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-stop"}))
    seen = []
    chk = until(ws, "voice_check", seen)
    assert chk["ok"] is True, chk["reasons"]
    assert chk["reasons"] == [] and abs(chk["audio_s"] - 9.4) < 0.15
    assert not any(isinstance(m, dict) and m["type"] in ("utterance", "speech") for m in seen)  # разговор стоял
    ws.send_text(json.dumps({"type": "voice", "op": "preview", "id": 11}))
    seen = []
    until(ws, "say-done", seen)
    assert any(isinstance(m, bytes) and audio_header(m)[0] == 11 for m in seen)
    ws.send_text(json.dumps({"type": "voice", "op": "save", "name": "Гость"}))
    vid = until(ws, "voice_saved")["id"]
    lst = until(ws, "voice_list")
    assert vid in [v["id"] for v in lst["voices"]]
    ws.send_text(json.dumps({"type": "voice", "op": "assign", "role": "chief", "voice_id": vid}))
    assert until(ws, "voice_list")["roles"]["chief"] == vid
    ws.send_text(json.dumps({"type": "voice", "op": "delete", "voice_id": vid}))
    lst = until(ws, "voice_list")
    assert lst["roles"]["chief"] == "zhukov-10s" and vid not in [v["id"] for v in lst["voices"]]
    ws.close()


def test_ws_record_rejected_reports_reasons(make_client):
    ws, _ = connect(make_client(["что-то совсем другое"]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-start"}))
    until(ws, "voice_recording")
    send_audio(ws, np.concatenate([silence(0.5), tone(3.0), silence(0.5)]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-stop"}))
    chk = until(ws, "voice_check")
    assert chk["ok"] is False and any("коротк" in r for r in chk["reasons"]) and any("текст" in r for r in chk["reasons"])
    ws.send_text(json.dumps({"type": "voice", "op": "save", "name": "Гость"}))
    assert "проверк" in until(ws, "error")["text"]
    ws.close()


def test_ws_stop_unfinished_phrase(make_client):
    ws, _ = connect(make_client())
    ws.send_text(json.dumps({"type": "say", "id": 9, "role": "chief", "text": "Докладываю. Противник", "more": True}))
    ws.send_text(json.dumps({"type": "stop", "id": 9}))
    assert until(ws, "say-done") == {"type": "say-done", "id": 9, "stopped": True}
    ws.send_text(json.dumps({"type": "say", "id": 10, "role": "повар", "text": "Есть."}))
    assert "роли" in until(ws, "error")["text"]
    ws.close()


def record(ws, script_ok=True):
    ws.send_text(json.dumps({"type": "voice", "op": "record-start"}))
    until(ws, "voice_recording")
    send_audio(ws, np.concatenate([silence(1.0), tone(9.0), silence(1.0)]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-stop"}))
    return until(ws, "voice_check")


def wavs(root):
    return sorted(str(p.relative_to(root)) for p in root.rglob("*.wav"))


def test_recording_leaves_no_files(make_client, tmp_path):
    data = tmp_path / "data"
    c = make_client([RECORD_TEXT] * 4)
    ws, _ = connect(c)
    assert record(ws)["ok"] is True
    assert any("pending" in w for w in wavs(data))  # проверенная запись — до сохранения, для пробы
    ws.send_text(json.dumps({"type": "voice", "op": "save", "name": "Гость"}))
    vid = until(ws, "voice_saved")["id"]
    assert wavs(data) == sorted(["voices/zhukov-10s/ref.wav", f"voices/{vid}/ref.wav"])
    ws.send_text(json.dumps({"type": "voice", "op": "delete", "voice_id": vid}))
    until(ws, "voice_list")
    assert wavs(data) == ["voices/zhukov-10s/ref.wav"] and not (data / "voices" / vid).exists()
    # новая запись поверх проверенной и отказ от записи стирают её
    assert record(ws)["ok"] is True
    ws.send_text(json.dumps({"type": "voice", "op": "record-start"}))
    until(ws, "voice_recording")
    assert wavs(data) == ["voices/zhukov-10s/ref.wav"]
    ws.send_text(json.dumps({"type": "voice", "op": "discard"}))
    until(ws, "voice_discarded")
    assert record(ws)["ok"] is True
    ws.send_text(json.dumps({"type": "voice", "op": "discard"}))
    until(ws, "voice_discarded")
    assert wavs(data) == ["voices/zhukov-10s/ref.wav"]
    # закрытие окна стирает непрошедшую в образцы запись
    assert record(ws)["ok"] is True
    ws.close()
    c.close()
    assert wavs(data) == ["voices/zhukov-10s/ref.wav"]


def test_preview_requires_id(make_client):
    ws, _ = connect(make_client())
    ws.send_text(json.dumps({"type": "voice", "op": "preview", "voice_id": "zhukov-10s"}))
    assert "id" in until(ws, "error")["text"]
    ws.send_text(json.dumps({"type": "voice", "op": "preview", "voice_id": "zhukov-10s", "id": 0}))
    assert "id" in until(ws, "error")["text"]
    ws.close()


def test_store_oserror_reported_session_continues(make_client):
    c = make_client([RECORD_TEXT])
    ws, _ = connect(c)
    assert record(ws)["ok"] is True

    def full(*a, **k):
        raise OSError(28, "No space left on device")

    c.app.state.service.store.save = full
    ws.send_text(json.dumps({"type": "voice", "op": "save", "name": "Гость"}))
    err = until(ws, "error")["text"]
    assert "диск" in err or "файл" in err
    ws.send_text(json.dumps({"type": "voice", "op": "list"}))
    assert until(ws, "voice_list")["roles"]["chief"] == "zhukov-10s"
    ws.close()


class _Asr:
    def __init__(self):
        self.paths = []

    def transcribe(self, path):
        from pathlib import Path
        assert Path(path).is_file()
        self.paths.append(path)
        return "текст"


def test_models_transcribe_removes_temp_file():
    from pathlib import Path

    from models import Models

    m = Models()
    m.asr = _Asr()
    assert m.transcribe(tone(1.0)) == "текст"
    assert m.asr.paths and not Path(m.asr.paths[0]).exists()
    m._refs = {("/x/voices/a/ref.wav", 1): 1, ("/x/voices/b/ref.wav", 2): 2}
    m.forget_ref(Path("/x/voices/a/ref.wav"))
    assert list(m._refs) == [("/x/voices/b/ref.wav", 2)]


# ---------------------------------------------------------------- итоговое ревью ступени 1


def test_echo_only_right_after_speech(make_client, monkeypatch):
    """Эхо — только пока штаб говорит или вскоре после конца звука: пример, предложенный штабом, человек
    может повторить через пару секунд — это обычная реплика."""
    import time

    import fake
    monkeypatch.setattr(fake, "CHARS_PER_S", 1000)  # фраза звучит 0,3 с
    ws, _ = connect(make_client(["штаб, открой переигровку"]))
    ws.send_text(json.dumps({"type": "say", "id": 1, "role": "chief", "text": "Скажите: «штаб, открой переигровку»."}))
    until(ws, "say-done")
    ws.send_text(json.dumps({"type": "played", "id": 1}))
    time.sleep(2.5)
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    seen = []
    u = until(ws, "utterance", seen)
    assert u["text"] == "штаб, открой переигровку"
    assert not any(isinstance(m, dict) and m["type"] == "echo" for m in seen)
    ws.close()


def test_echo_while_speaking(make_client):
    # микрофон поймал голос штаба, пока тот говорит, — эхо, не реплика
    text = "Докладываю обстановку: противник отошёл за реку, наши части заняли переправу."
    ws, _ = connect(make_client([text]))
    ws.send_text(json.dumps({"type": "say", "id": 2, "role": "chief", "text": text}))
    while not isinstance(recv(ws), bytes):
        pass
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    seen = []
    e = until(ws, "echo", seen)
    assert e["text"] == text
    assert not any(isinstance(m, dict) and m["type"] == "utterance" for m in seen)
    ws.close()


def test_echo_compares_only_last_phrase(make_client, monkeypatch):
    import fake
    monkeypatch.setattr(fake, "CHARS_PER_S", 1000)
    ws, _ = connect(make_client(["штаб, открой переигровку"]))
    ws.send_text(json.dumps({"type": "say", "id": 1, "role": "chief", "text": "Скажите: штаб, открой переигровку."}))
    until(ws, "say-done")
    ws.send_text(json.dumps({"type": "played", "id": 1}))
    ws.send_text(json.dumps({"type": "say", "id": 2, "role": "chief", "text": "Есть."}))
    until(ws, "say-done")
    ws.send_text(json.dumps({"type": "played", "id": 2}))
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    seen = []
    u = until(ws, "utterance", seen)
    assert u["text"] == "штаб, открой переигровку"
    ws.close()


def test_long_recording_checked_in_russian(make_client):
    # запись длиннее 25 с: распознавание кусками, проверка — по-русски, а не ошибка «use transcribe_longform»
    ws, _ = connect(make_client([RECORD_TEXT] * 4))
    ws.send_text(json.dumps({"type": "voice", "op": "record-start"}))
    until(ws, "voice_recording")
    send_audio(ws, np.concatenate([silence(1.0), tone(27.0), silence(1.0)]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-stop"}))
    seen = []
    chk = until(ws, "voice_check", seen)
    assert not any(isinstance(m, dict) and m["type"] == "error" for m in seen), seen
    assert chk["heard"] and not any("длинн" in r or "коротк" in r for r in chk["reasons"])
    ws.close()


def test_long_utterance_transcribed(make_client):
    ws, _ = connect(make_client(["раз", "два"]))
    send_audio(ws, np.concatenate([tone(30.0), silence(2.0)]))
    seen = []
    u = until(ws, "utterance", seen)
    assert u["text"] == "раз два"
    assert not any(isinstance(m, dict) and m["type"] == "error" for m in seen)
    ws.close()


def test_recording_silence_trimmed_before_asr(make_client):
    # тишина по краям не мешает: 10 с тишины + 20 с речи + 10 с тишины распознаются одним куском
    ws, _ = connect(make_client([RECORD_TEXT, "лишнее"]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-start"}))
    until(ws, "voice_recording")
    send_audio(ws, np.concatenate([silence(10.0), tone(20.0), silence(10.0)]))
    ws.send_text(json.dumps({"type": "voice", "op": "record-stop"}))
    chk = until(ws, "voice_check")
    assert chk["heard"] == RECORD_TEXT and chk["ok"] is True, chk
    ws.close()


def test_calibration_without_voice_sample(make_client, tmp_path):
    """Нет образца голоса — шаг калибровки с голосом штаба отвечает понятной ошибкой, сессия продолжается."""
    ws, _ = connect(make_client())
    import shutil
    shutil.rmtree(tmp_path / "data" / "voices" / "zhukov-10s")
    ws.send_text(json.dumps({"type": "calib", "step": "echo"}))
    err = until(ws, "error")["text"]
    assert "нет образца голоса" in err and "Голоса" in err
    ws.send_text(json.dumps({"type": "voice", "op": "list"}))
    assert until(ws, "voice_list")["voices"] == []
    ws.close()


def test_unexpected_error_keeps_session(make_client):
    c = make_client()
    ws, _ = connect(c)

    def boom():
        raise RuntimeError("сбой")

    c.app.state.service.store.list = boom
    ws.send_text(json.dumps({"type": "voice", "op": "list"}))
    assert "сбой" in until(ws, "error")["text"]
    ws.send_text(json.dumps({"type": "say", "id": 4, "role": "chief", "text": "Есть."}))
    assert until(ws, "say-done")["id"] == 4
    ws.close()


def test_discard_forgets_pending_sound(make_client, tmp_path):
    c = make_client([RECORD_TEXT])
    ws, _ = connect(c)
    assert record(ws)["ok"] is True
    ws.send_text(json.dumps({"type": "voice", "op": "discard"}))
    until(ws, "voice_discarded")
    forgotten = c.app.state.service.models.forgotten
    assert forgotten and all(p.name.startswith("pending-") for p in forgotten)
    ws.close()


def test_service_stop_stops_sent_phrase(make_client):
    # калибровка останавливает и фразу, звук которой уже весь отправлен: окно гасит её, played не нужен
    ws, _ = connect(make_client())
    ws.send_text(json.dumps({"type": "say", "id": 7, "role": "chief", "text": "Есть."}))
    assert until(ws, "say-done") == {"type": "say-done", "id": 7}
    ws.send_text(json.dumps({"type": "calib", "step": "noise", "sec": 1}))
    seen = []
    until(ws, "calib_rec", seen)
    assert {"type": "say-done", "id": 7, "stopped": True} in seen
    ws.close()


def test_preview_then_discard_no_synth_error(make_client):
    # «Прослушать пробу» и сразу «Не сохранять»: проба обрывается молча, без «синтез: [Errno 2]…»
    ws, _ = connect(make_client([RECORD_TEXT]))
    assert record(ws)["ok"] is True
    ws.send_text(json.dumps({"type": "voice", "op": "preview", "id": 12}))
    while not isinstance(recv(ws), bytes):
        pass
    ws.send_text(json.dumps({"type": "voice", "op": "discard"}))
    seen = []
    until(ws, "voice_discarded", seen)
    import time
    time.sleep(1.5)
    ws.send_text(json.dumps({"type": "voice", "op": "list"}))
    until(ws, "voice_list", seen)
    assert not any(isinstance(m, dict) and m["type"] == "error" for m in seen), [m for m in seen if isinstance(m, dict)]
    assert {"type": "say-done", "id": 12, "stopped": True} in seen
    ws.close()


# ---------------------------------------------------------------- перебивание словом

CHIEF_LONG = "Докладываю обстановку. " * 6


def word_mode(ws):
    assert until(ws, "settings")["barge_mode"] == "voice"  # при подключении
    ws.send_text(json.dumps({"type": "settings", "barge_mode": "word"}))
    assert until(ws, "settings")["barge_mode"] == "word"


def chief_speaks(ws, text=CHIEF_LONG, jid=5):
    ws.send_text(json.dumps({"type": "say", "id": jid, "role": "chief", "text": text}))
    while not isinstance(recv(ws), bytes):  # звук пошёл
        pass


def test_barge_mode_setting(make_client):
    ws, _ = connect(make_client())
    assert until(ws, "settings")["barge_mode"] == "voice"
    ws.send_text(json.dumps({"type": "hello", "settings": {"barge_mode": "word"}}))
    assert until(ws, "settings")["barge_mode"] == "word"
    ws.send_text(json.dumps({"type": "settings", "barge_mode": "громко"}))  # чужое значение не принимается
    assert until(ws, "settings")["barge_mode"] == "word"
    ws.send_text(json.dumps({"type": "settings", "barge_mode": "voice"}))
    assert until(ws, "settings")["barge_mode"] == "voice"
    ws.close()


def test_word_mode_stop_barges_before_end_of_utterance(make_client):
    """«Стоп» во время фразы штаба: кусок речи распознаётся по мере речи — штаб обрывается, не дожидаясь конца реплики;
    дальше реплика обрабатывается как обычно («Стоп, открой карты»)."""
    ws, _ = connect(make_client(["стоп, открой карты"] * 10))
    word_mode(ws)
    chief_speaks(ws)
    send_audio(ws, tone(0.6))  # 0,6 с речи без паузы: конца реплики ещё нет
    seen = []
    b = until(ws, "barge", seen)
    assert b["id"] == 5
    assert not any(isinstance(m, dict) and m["type"] == "utterance" for m in seen)
    send_audio(ws, np.concatenate([tone(0.3), silence(2.0)]))
    seen = []
    u = until(ws, "utterance", seen)
    assert u["text"] == "стоп, открой карты"
    assert not any(isinstance(m, dict) and m["type"] in ("echo", "barge") for m in seen)
    ws.close()


def flush(ws, seen):
    """Всё присланное раньше обработано: сервис ответил на settings."""
    ws.send_text(json.dumps({"type": "settings"}))
    until(ws, "settings", seen)


def test_word_mode_echo_with_stop_word_does_not_barge(make_client):
    """Эхо фразы штаба, в которой есть «хватит», — не перебивание и не реплика."""
    c = make_client(["{эхо}"] * 20)
    ws, _ = connect(c)
    word_mode(ws)
    chief_speaks(ws, "Хватит ждать наступаем на рассвете всеми силами армии и фронта.")  # одним куском синтеза
    send_audio(ws, np.concatenate([tone(1.0), silence(2.0)]))
    seen = []
    until(ws, "speech", seen)
    until(ws, "speech", seen)  # конец речи
    flush(ws, seen)
    assert not any(isinstance(m, dict) and m["type"] in ("barge", "utterance") for m in seen)
    assert c.app.state.service.models.transcribed >= 2  # куски распознавались и во время речи
    ws.close()


def test_word_mode_stop_inside_echo_barges(make_client):
    """В кусок попали эхо штаба и «стоп» человека — штаб обрывается."""
    ws, _ = connect(make_client(["{эхо} стоп"] * 20))
    word_mode(ws)
    chief_speaks(ws, "Докладываю обстановку на участке армии без изменений.")
    send_audio(ws, tone(0.6))
    assert until(ws, "barge")["id"] == 5
    ws.close()


def test_word_mode_chunk_window_is_short(make_client):
    """По ходу речи распознаётся хвост куска (не длиннее ~2 с), а не весь кусок от начала."""
    c = make_client(["доложите потери за сутки"] * 200)
    m = c.app.state.service.models
    lens = []
    orig = m.transcribe
    m.transcribe = lambda a: (lens.append(len(a) / SR), orig(a))[1]
    ws, _ = connect(c)
    word_mode(ws)
    chief_speaks(ws, "Докладываю обстановку. " * 20)
    send_audio(ws, tone(4.0))
    ws.send_text(json.dumps({"type": "settings"}))
    until(ws, "settings")
    assert len(lens) >= 3 and max(lens) <= 2.0, lens
    ws.close()


def test_word_mode_other_speech_dropped_while_chief_speaks(make_client):
    """Речь без стоп-слова, пока штаб говорит, — не реплика (её не отличить от эха): штаб договаривает; потом —
    слушаю как обычно."""
    c = make_client(["доложите потери за сутки"] * 20)
    ws, _ = connect(c)
    word_mode(ws)
    chief_speaks(ws)
    send_audio(ws, np.concatenate([tone(1.0), silence(2.0)]))
    seen = []
    until(ws, "speech", seen)
    until(ws, "speech", seen)
    flush(ws, seen)
    assert not any(isinstance(m, dict) and m["type"] in ("barge", "utterance", "echo") for m in seen)
    assert c.app.state.service.models.transcribed >= 2
    # штаб говорит дальше: его можно перебить словом
    c.app.state.service.models.script[:0] = ["стоп"] * 5
    send_audio(ws, tone(0.6))
    assert until(ws, "barge")["id"] == 5
    send_audio(ws, silence(3.0))  # пауза длиннее склейки реплик
    until(ws, "utterance")
    # штаб замолчал — обычная речь снова реплика
    c.app.state.service.models.script[:0] = ["доложите потери за сутки"]
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    assert until(ws, "utterance")["text"] == "доложите потери за сутки"
    ws.close()


def test_word_mode_preview_not_barged(make_client):
    ws, _ = connect(make_client(["стоп"] * 10))
    word_mode(ws)
    ws.send_text(json.dumps({"type": "voice", "op": "preview", "id": 21, "voice_id": "zhukov-10s"}))
    seen = []
    while not isinstance(m := recv(ws), bytes):
        seen.append(m)
    send_audio(ws, np.concatenate([tone(0.6), silence(2.0)]))
    until(ws, "utterance", seen)
    assert not any(isinstance(m, dict) and m["type"] == "barge" for m in seen)
    ws.close()
