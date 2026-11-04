import numpy as np

from tts import PiecePlanner, Sentences, fade_tail, lengthen_sentence_pauses, pause_after, sentence_pieces
from tts_tail import extend_eos


def test_sentences_split():
    s = Sentences()
    assert s.push("Привет. Как дела") == ["Привет."]
    assert s.rest() == ["Как дела"]
    assert Sentences().push("Цена 3.5 рубля") == []


def test_planner_first_short_waits_for_next():
    p = PiecePlanner()
    p.push("Принято.")
    assert p.next_piece(100.0, 0.0) is None
    p.push("Двигаемся к фронту.")
    assert p.next_piece(100.0, 0.0) == "Принято. Двигаемся к фронту."


def test_planner_first_short_alone_after_wait():
    p = PiecePlanner()
    p.push("Есть.")
    assert p.next_piece(100.0, 0.0) is None
    assert p.next_piece(100.41, 0.0) == "Есть."


def test_long_first_sentence_starts_early():
    s = Sentences()
    text = "Я штаб первого Белорусского фронта и докладываю обстановку по силам и замыслу на этот час."
    first = s.push(text)
    assert first and len(first[0]) <= 70
    assert " ".join(first + s.rest()).replace("  ", " ") == text


def test_planner_first_long_goes_at_once():
    p = PiecePlanner()
    p.push("Это достаточно длинная первая фраза.")
    assert p.next_piece(100.0, 0.0) == "Это достаточно длинная первая фраза."


def test_planner_groups_rest_by_lead():
    p = PiecePlanner()
    p.push("Это достаточно длинная первая фраза.")
    p.next_piece(100.0, 0.0)
    p.push("Вторая.")
    p.push("Третья.")
    assert p.next_piece(100.0, 105.0) is None
    assert p.next_piece(100.0, 100.5) == "Вторая. Третья."
    assert p.next_piece(100.0, 100.5) is None


def test_planner_max_chars():
    p = PiecePlanner()
    p.push("Это достаточно длинная первая фраза.")
    p.next_piece(100.0, 0.0)
    p.push("а" * 150 + ".")
    assert p.next_piece(100.0, 200.0) is None
    p.push("б" * 150 + ".")
    assert len(p.next_piece(100.0, 200.0)) >= 300


def test_planner_finish_flushes_and_done():
    p = PiecePlanner()
    p.push("Есть.")
    p.finish()
    assert not p.done
    assert p.next_piece(100.0, 500.0) == "Есть."
    assert p.done


def test_pause_after():
    assert pause_after("Да?") == 0.3 and pause_after("Так,") == 0.1 and pause_after("Есть»") == 0.2


def test_sentence_pieces_keep_army_abbreviations():
    assert sentence_pieces("3-я гв. танковая штурмует юг Берлина. 47 А и 4 гв. ТА у Кетцина.") == [
        "3-я гв. танковая штурмует юг Берлина.",
        "47 А и 4 гв. ТА у Кетцина.",
    ]


def test_lengthen_sentence_pauses_to_target():
    sr = 1000
    tone = np.ones(300, np.float32) * 0.2
    audio = np.concatenate([tone, np.zeros(100, np.float32), tone])
    out = lengthen_sentence_pauses(audio, sr, "Первое предложение. Второе предложение.")
    assert len(out) == len(audio) + 700
    assert np.all(out[:300] == 0.2) and np.all(out[-300:] == 0.2)
    assert np.count_nonzero(out[300:-300]) == 0


def test_lengthen_sentence_pauses_leaves_long_gap_and_unbroken_speech():
    sr = 1000
    tone = np.ones(200, np.float32) * 0.2
    long = np.concatenate([tone, np.zeros(900, np.float32), tone])
    assert len(lengthen_sentence_pauses(long, sr, "Первое предложение. Второе предложение.")) == len(long)
    solid = np.ones(2000, np.float32) * 0.2
    text = "3-я гв. танковая штурмует юг Берлина. 47 А и 4 гв. ТА у Кетцина."
    assert len(lengthen_sentence_pauses(solid, sr, text)) == len(solid)
    assert len(lengthen_sentence_pauses(solid, sr, "Одна фраза.")) == len(solid)


def test_fade_tail_only_last_ms():
    a = np.ones(1600, np.float32)
    b = fade_tail(a, 1000, 10)
    assert np.all(b[:1590] == 1.0) and abs(b[-1]) < 1e-6 and b[1595] < 1.0
    assert np.all(fade_tail(a, 1000, 0) == 1.0)


class FakeTTS:
    def __init__(self):
        self.config = type("C", (), {"talker_config": type("T", (), {"codec_eos_token_id": 9})()})()
        self.seq = [[1], [9], [5], [9], [7], [9]]
        self.i = 0

    def _sample_token(self, logits, *a, suppress_tokens=None, **kw):
        if suppress_tokens is not None and 9 in suppress_tokens:
            return np.array([[3]])
        return np.array([[7 if suppress_tokens is None else 9]])


def test_extend_eos_one_frame():
    tts = FakeTTS()
    reset = extend_eos(tts, 1)
    out = [int(tts._sample_token(None, suppress_tokens=[1])[0, 0]) for _ in range(2)]
    assert out == [3, 9]
    reset()
    assert int(tts._sample_token(None, suppress_tokens=[1])[0, 0]) == 3
    extend_eos(tts, 0)
    assert int(tts._sample_token(None, suppress_tokens=[1])[0, 0]) == 9


def test_whole_pieces_first_like_planner_rest_grouped():
    from tts import PIECE_MAX_CHARS, whole_pieces
    assert whole_pieces("Есть. Двигаемся к фронту. Противник отошёл.") == ["Есть. Двигаемся к фронту.", "Противник отошёл."]
    long = " ".join(f"Фраза номер {i} о том, что противник отошёл за реку." for i in range(12))
    ps = whole_pieces(long)
    assert " ".join(ps) == long
    assert len(ps) > 2 and all(len(p) <= PIECE_MAX_CHARS for p in ps[1:])
    assert whole_pieces("  ") == []
    # точка в сокращении армии не режет фразу
    assert whole_pieces("3-я гв. танковая штурмует юг Берлина. 47 А и 4 гв. ТА у Кетцина.") == [
        "3-я гв. танковая штурмует юг Берлина.",
        "47 А и 4 гв. ТА у Кетцина.",
    ]
