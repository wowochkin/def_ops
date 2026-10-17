import asyncio

import numpy as np
import pytest

from audio import FRAME, Listener, calibrate, is_stop_phrase, should_merge


def synth(seed=0):
    r = np.random.default_rng(seed)
    return {
        "noise": list(r.uniform(0.0, 0.1, 120)),
        "speech": list(r.uniform(0.7, 1.0, 120)),
        "echo": list(r.uniform(0.1, 0.3, 120)),
        "over": list(r.uniform(0.75, 1.0, 120)),
    }


def test_calibrate_normal_room():
    cfg, rep = calibrate(synth(), 20)
    assert 0.3 < cfg["vad"] < 0.6
    assert 0.43 < cfg["barge_vad"] < 0.65
    assert cfg["end_ms"] == 20
    assert rep["warn"] == []


def test_calibrate_loud_echo_word_mode():
    """Динамики слышно громко — перебивание словом; совета про наушники нет, вместо него — про «Стоп»."""
    d = synth()
    d["echo"] = list(np.random.default_rng(1).uniform(0.7, 0.9, 120))
    d["over"] = list(np.random.default_rng(2).uniform(0.8, 0.95, 120))
    cfg, rep = calibrate(d, 20)
    assert cfg["barge_mode"] == "word"
    assert not any("наушник" in w for w in rep["warn"])
    assert "Динамики слышно громко — чтобы перебить штаб, скажите «Стоп»." in rep["warn"]


def test_calibrate_quiet_echo_voice_mode():
    cfg, _ = calibrate(synth(), 20)
    assert cfg["barge_mode"] == "voice"


def test_calibrate_report_in_plain_words():
    """Предупреждения и замеры видит человек в окне калибровки — без технических слов."""
    d = synth()
    d["echo"] = list(np.random.default_rng(1).uniform(0.7, 0.9, 120))
    d["over"] = []
    _, rep = calibrate(d, 20)
    assert len(rep["warn"]) == 2
    for text in [*rep["warn"], *rep["stats"]]:
        for word in ("порог", "модел", "эхо", "эха", "VAD"):
            assert word not in text, (word, text)


def test_calibrate_no_speech_raises():
    d = synth()
    d["speech"] = [0.05] * 120
    with pytest.raises(ValueError):
        calibrate(d, 20)


CFG = {"vad": 0.5, "barge_vad": 0.7, "barge_ms": 256, "end_ms": 20}
F = np.zeros(FRAME, np.float32)


def run(frames, turn_probs, busy=False, **kw):
    """frames: список уверенностей VAD на кадр; turn_probs — ответы Smart Turn по очереди (последний повторяется)."""
    it = iter(frames)
    calls = {"turn": 0}

    async def vad(_f):
        return next(it)

    async def turn(_a):
        i = min(calls["turn"], len(turn_probs) - 1)
        calls["turn"] += 1
        return turn_probs[i]

    async def go():
        ls = Listener(dict(CFG), vad, turn, **kw)
        ev = []
        for _ in frames:
            ev += await ls.feed(F, busy)
        return ev

    return asyncio.run(go()), calls


def kinds(ev):
    return [e[0] for e in ev if e[0] != "level"]


def test_listener_utterance_after_pause():
    speech = [0.9] * 19  # ~0,6 с
    # пауза 1 кадр (32 мс >= end_ms 20) → спрос; потом через 3 кадра; потом через 3
    sil = [0.0] * 7
    ev, calls = run(speech + sil, [0.2, 0.2, 0.9])
    utt = [e for e in ev if e[0] == "utterance"]
    assert len(utt) == 1 and utt[0][2] == 0.9
    assert calls["turn"] == 3
    assert kinds(ev)[:1] == ["speech_start"]


def test_listener_max_silence_ends_without_turn():
    ev, _ = run([0.9] * 10 + [0.0] * 60, [0.1])
    utt = [e for e in ev if e[0] == "utterance"]
    assert len(utt) == 1 and utt[0][2] is None


def test_listener_barge_only_when_busy():
    ev, _ = run([0.9] * 20, [0.1], busy=True)
    assert kinds(ev).count("barge") == 1
    ev, _ = run([0.9] * 20, [0.1], busy=False)
    assert "barge" not in kinds(ev)


def test_listener_word_mode_no_barge_by_loudness():
    """Перебивание словом: громкая речь, пока штаб говорит, сама штаб не обрывает — решает распознанное слово."""
    it = iter([0.9] * 20)

    async def vad(_f):
        return next(it)

    async def turn(_a):
        return 0.1

    async def go():
        ls = Listener(dict(CFG, barge_mode="word"), vad, turn)
        ev = []
        for _ in range(20):
            ev += await ls.feed(F, True)
        return ev, ls

    ev, ls = asyncio.run(go())
    assert "barge" not in kinds(ev)
    # кусок от начала речи (без запаса до неё): 20 кадров
    assert ls.chunk_s() == pytest.approx(20 * FRAME / 16000)


def test_listener_click_is_dropped():
    ev, _ = run([0.9] * 2 + [0.0] * 12, [0.1])
    assert "utterance" not in kinds(ev) and "speech_end" in kinds(ev)


def test_should_merge():
    assert should_merge(10.0, 11.5, None) and should_merge(10.0, 11.5, 10.5)
    assert not should_merge(10.0, 12.5, None) and not should_merge(10.0, 11.9, 10.2)


CHIEF = "Хватит ждать, наступаем на рассвете. Артиллерия готова, пехота на исходных."


def test_stop_phrase_words():
    for t in ("Стоп", "стоп, открой карты", "Подождите!", "подожди", "Ну хватит", "Отставить.", "тихо", "Штаб, открой карты",
              "штаб доложи", "Стоп-стоп"):
        assert is_stop_phrase(t, CHIEF), t


def test_stop_phrase_other_speech():
    for t in ("", "доложите потери за сутки", "передайте в штаб армии", "открой карты", "стопка бумаги"):
        assert not is_stop_phrase(t, CHIEF), t


def test_stop_phrase_echo_of_chief():
    """Стоп-слово вместе с соседними словами фразы штаба в том же порядке — его эхо из динамиков."""
    for t in ("хватит ждать", "Хватит ждать наступаем", "хватит ждат наступаем на рассвете", "артиллерия готова пехота",
              "на рассвете хватит ждать"):
        assert not is_stop_phrase(t, CHIEF), t
    # штаб молчит или говорит другое — стоп-слово останавливает
    assert is_stop_phrase("хватит ждать", "")
    assert is_stop_phrase("Стоп, подождите", CHIEF)


def test_stop_phrase_bare_word_always_stops():
    """Одно стоп-слово без соседних слов штаба — просьба человека, даже если такое слово есть во фразе штаба."""
    assert is_stop_phrase("Хватит", CHIEF)
    assert is_stop_phrase("стоп", "Стоп-кран сорван, поезд стоит на перегоне.")


def test_stop_phrase_mixed_with_echo():
    """В кусок попало и эхо штаба, и «стоп» человека — каждое стоп-слово судится само по себе."""
    chief = "Докладываю обстановку. " * 6
    assert is_stop_phrase("докладываю обстановку стоп", chief)
    assert is_stop_phrase("обстановку докладываю обстановку подождите", chief)
    # обращение — в начале новой речи, после эха
    assert is_stop_phrase("докладываю обстановку штаб открой карты", chief)
    assert not is_stop_phrase("докладываю обстановку передайте в штаб армии", chief)


HELP = "Можно сказать: «штаб, открой переигровку», «штаб, калибровка», «штаб, голоса», «штаб, что я могу сказать»."


def test_stop_phrase_address_during_help_list():
    """Штаб перечисляет фразы с «штаб, …»: обращение человека его обрывает, эхо самого перечня — нет."""
    assert is_stop_phrase("штаб открой карты", HELP)
    assert is_stop_phrase("Штаб, доложи обстановку", HELP)
    for t in ("штаб открой переигровку", "штаб калибровка штаб голоса", "сказать штаб открой переигровку"):
        assert not is_stop_phrase(t, HELP), t


def test_stop_words_shared_with_window():
    # один список стоп-слов на сервис и разборщик реплик окна (apps/editor/src/voice/dispatch.ts)
    import json
    from pathlib import Path

    import audio

    shared = json.loads((Path(audio.__file__).parent / "stop_words.json").read_text(encoding="utf-8"))["stop"]
    assert audio.STOP_WORDS == set(shared)
    assert {"стоп", "подождите", "подожди", "хватит", "отставить", "тихо"} <= audio.STOP_WORDS
    for w in shared:
        assert audio.is_stop_phrase(w.capitalize() + ".", "Докладываю обстановку на участке армии.")
