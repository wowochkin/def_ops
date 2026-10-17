import json
import wave

import numpy as np
import pytest

from voices import DEFAULT_VOICE, RECORD_TEXT, VoiceStore, check_recording, wer

SR = 16000


def speech(sec: float, sr: int = SR, amp: float = 0.3) -> np.ndarray:
    """Похоже на речь по громкости: тон с медленной огибающей (слоги), без провалов в ноль."""
    t = np.arange(int(sec * sr)) / sr
    return (amp * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t)) * np.sin(2 * np.pi * 180 * t)).astype(np.float32)


def write_wav(path, audio, sr=SR):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def make_seed(d):
    (d / "ref").mkdir(parents=True)
    write_wav(d / "ref" / "zhukov-10s.wav", speech(1.0))
    refs = {"default": "zhukov-14s", "refs": {
        "zhukov-10s": {"file": "ref/zhukov-10s.wav", "text": "Как мы рассчитали."},
        "zhukov-14s": {"file": "ref/zhukov-14s.wav", "text": "Файла нет — посев пропускает."},
    }}
    (d / "refs.json").write_text(json.dumps(refs, ensure_ascii=False), encoding="utf-8")
    return d


def test_seed_and_default_roles(tmp_path):
    s = VoiceStore(tmp_path / "data", make_seed(tmp_path / "seed"))
    ids = [v["id"] for v in s.list()]
    assert ids == ["zhukov-10s"]  # образца без файла нет
    v = s.list()[0]
    assert v["builtin"] is True and v["text"] == "Как мы рассчитали." and v["name"]
    assert s.roles() == {"chief": "zhukov-10s", "umpire": "zhukov-10s"}
    path, text = s.ref("zhukov-10s")
    assert path.exists() and text == "Как мы рассчитали."
    # повторный посев ничего не ломает
    assert [v["id"] for v in VoiceStore(tmp_path / "data", tmp_path / "seed").list()] == ids


def test_chief_voice_by_default_when_seeded(tmp_path):
    seed = make_seed(tmp_path / "seed")
    write_wav(seed / "ref" / "chief-10s.wav", speech(1.0))
    refs = json.loads((seed / "refs.json").read_text(encoding="utf-8"))
    refs["refs"]["chief-10s"] = {"file": "ref/chief-10s.wav", "text": "Замысел состоял в том."}
    (seed / "refs.json").write_text(json.dumps(refs, ensure_ascii=False), encoding="utf-8")
    s = VoiceStore(tmp_path / "data", seed)
    assert next(v for v in s.list() if v["id"] == "chief-10s")["name"] == "Начальник штаба, 10 с"
    assert s.roles() == {"chief": "chief-10s", "umpire": "zhukov-10s"}
    # свой голос у начальника штаба удалён — роль возвращается к своему образцу по умолчанию, не к Жукову
    vid = s.save("Гость", speech(9.0), SR, RECORD_TEXT, "микрофон")
    s.assign("chief", vid)
    s.delete(vid)
    assert s.roles() == {"chief": "chief-10s", "umpire": "zhukov-10s"}


def test_seed_dir_missing_is_tolerated(tmp_path):
    s = VoiceStore(tmp_path / "data", tmp_path / "нет")
    assert s.list() == []
    assert s.roles() == {"chief": DEFAULT_VOICE, "umpire": DEFAULT_VOICE}


def test_save_assign_delete(tmp_path):
    s = VoiceStore(tmp_path / "data", make_seed(tmp_path / "seed"))
    vid = s.save("Гость Иванов", speech(9.0), SR, RECORD_TEXT, "микрофон")
    v = next(x for x in s.list() if x["id"] == vid)
    assert v["name"] == "Гость Иванов" and v["builtin"] is False and v["source"] == "микрофон"
    path, text = s.ref(vid)
    assert path.exists() and text == RECORD_TEXT
    s.assign("chief", vid)
    assert s.roles() == {"chief": vid, "umpire": "zhukov-10s"}
    # роли переживают перезапуск
    assert VoiceStore(tmp_path / "data", None).roles()["chief"] == vid
    vid2 = s.save("Гость Иванов", speech(9.0), SR, RECORD_TEXT, "микрофон")
    assert vid2 != vid
    s.delete(vid)
    assert s.roles()["chief"] == "zhukov-10s"
    assert not path.exists()
    assert vid not in [x["id"] for x in s.list()]
    with pytest.raises(ValueError):
        s.assign("chief", "нет-такого")
    with pytest.raises(ValueError):
        s.assign("повар", vid2)


def test_delete_builtin_refused(tmp_path):
    s = VoiceStore(tmp_path / "data", make_seed(tmp_path / "seed"))
    with pytest.raises(ValueError):
        s.delete("zhukov-10s")
    assert "zhukov-10s" in [v["id"] for v in s.list()]


def test_record_text_is_long_enough_without_digits():
    words = RECORD_TEXT.split()
    assert 40 <= len(words) <= 60  # 15–20 с чтения вслух
    assert not any(c.isdigit() for c in RECORD_TEXT)


def test_wer_normalizes_case_yo_and_punctuation():
    assert wer("Ещё раз, всё!", "еще раз все") == 0.0
    assert wer("один два три четыре", "один два три") == 0.25


def test_check_recording_silence():
    r = check_recording(np.zeros(12 * SR, np.float32), SR, RECORD_TEXT, RECORD_TEXT)
    assert r["ok"] is False
    assert any("тихо" in x for x in r["reasons"])


def test_check_recording_noise():
    rng = np.random.default_rng(0)
    a = np.concatenate([np.zeros(SR, np.float32), speech(12.0), np.zeros(2 * SR, np.float32)])
    rms = float(np.sqrt(np.mean(speech(12.0) ** 2)))
    a = a + (rng.standard_normal(len(a)) * rms * 10 ** (-10 / 20)).astype(np.float32)
    r = check_recording(a, SR, RECORD_TEXT, RECORD_TEXT)
    assert r["ok"] is False
    assert any("шум" in x for x in r["reasons"])


def test_check_recording_wrong_text():
    a = np.concatenate([np.zeros(SR, np.float32), speech(12.0), np.zeros(2 * SR, np.float32)])
    r = check_recording(a, SR, RECORD_TEXT, "совсем другие слова про погоду и рыбалку на озере")
    assert r["ok"] is False
    assert any("текст" in x for x in r["reasons"])


def test_check_recording_too_short():
    a = np.concatenate([np.zeros(SR, np.float32), speech(4.0), np.zeros(SR, np.float32)])
    r = check_recording(a, SR, RECORD_TEXT, RECORD_TEXT)
    assert r["ok"] is False
    assert any("коротк" in x for x in r["reasons"])


def test_check_recording_ok_trims_and_keeps_pause():
    a = np.concatenate([np.zeros(SR, np.float32), speech(12.0), np.zeros(2 * SR, np.float32)])
    r = check_recording(a, SR, RECORD_TEXT, RECORD_TEXT.lower())
    assert r["ok"] is True, r["reasons"]
    assert r["reasons"] == []
    assert abs(len(r["audio"]) / SR - 12.4) < 0.1
    # конец — тишина (естественная пауза), начало — уже речь
    assert np.max(np.abs(r["audio"][-int(0.3 * SR):])) < 1e-3
    assert np.max(np.abs(r["audio"][: int(0.1 * SR)])) > 0.05


def test_seed_names_in_russian():
    from voices import _seed_name
    assert _seed_name("zhukov-10s") == "Жуков, 10 с"
    assert _seed_name("zhukov-14s-raw") == "Жуков, 14 с (без обработки)"
    assert _seed_name("zhukov-14s-dfn") == "Жуков, 14 с (с шумоподавлением)"
