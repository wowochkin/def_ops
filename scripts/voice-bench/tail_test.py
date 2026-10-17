"""Почему синтез «проглатывает» конец фразы: одни и те же короткие фразы в нескольких вариантах синтеза.

Варианты: как было и с договариванием 1, 2, 3 кадров (по 80 мс) после «конца» (tts_tail.py; в talk_server —
--eos-extra). Прошлые прогоны: поток, штраф за повторы, многоточие не влияют, хвост « ^.» в тексте даёт бормотание.
Для каждого — out/tail/<вариант>.wav (фразы
через паузу; слушать подряд) и таблица: уровень последних 30 мс относительно громкой части фразы (дБ). Обрыв на
звуке — около −10 дБ и выше; естественное затухание — −30 дБ и ниже.
  .venv-tts/bin/python tail_test.py [--takes 2]"""
import argparse
import json
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
PHRASES = ["Вперёд.", "За Родину.", "Принято.", "Ждём указаний Ставки.", "Двигаемся к следующему участку фронта."]


def tail_db(a: np.ndarray, sr: int) -> float:
    f = int(0.03 * sr)
    frames = [a[i:i + f] for i in range(0, len(a) - f + 1, f)]
    rms = np.array([np.sqrt(np.mean(x ** 2)) + 1e-9 for x in frames])
    # конец — последний кадр, где ещё есть хоть что-то выше тишины (синтез мог добавить тишину после слова)
    loud = np.percentile(rms, 90)
    alive = np.nonzero(rms > loud * 10 ** (-45 / 20))[0]
    last = rms[alive[-1]] if len(alive) else rms[-1]
    return round(20 * np.log10(last / loud), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tts", default="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")
    ap.add_argument("--ref")
    ap.add_argument("--takes", type=int, default=2, help="дублей каждой фразы (синтез случаен)")
    args = ap.parse_args()
    from mlx_audio.tts.utils import load_model
    from mlx_audio.utils import load_audio

    refs = json.loads((HERE / "refs.json").read_text(encoding="utf-8"))
    ref = refs["refs"][args.ref or refs["default"]]
    tts = load_model(args.tts)
    sr = int(tts.sample_rate)
    ref_audio = load_audio(str(HERE / ref["file"]), sample_rate=sr)
    common = dict(ref_audio=ref_audio, ref_text=ref["text"], max_tokens=300)

    def run(gen):
        return np.concatenate([np.asarray(r.audio, np.float32).reshape(-1) for r in gen])

    from tts_tail import extend_eos

    stream = dict(lang_code="russian", stream=True, streaming_interval=0.32, **common)

    def extra(n):  # договаривание n кадров (по 80 мс) после «конца»
        def f(t):
            extend_eos(tts, n)()
            return run(tts.generate(text=t, **stream))
        return f

    variants = {"1-как-было": extra(0), "2-плюс-1-кадр": extra(1), "3-плюс-2-кадра": extra(2), "4-плюс-3-кадра": extra(3)}
    out = HERE / "out" / "tail"
    out.mkdir(parents=True, exist_ok=True)
    print(f"{'вариант':22} | " + " | ".join(p[:12] for p in PHRASES) + " | среднее, дБ | длина, с")
    for name, fn in variants.items():
        parts, dbs, dur = [], [], 0.0
        for p in PHRASES:
            for _ in range(args.takes):
                a = fn(p)
                dbs.append(tail_db(a, sr))
                dur += len(a) / sr
                parts += [a, np.zeros(int(0.7 * sr), np.float32)]
        wav = np.concatenate(parts)
        with wave.open(str(out / f"{name}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((np.clip(wav, -1, 1) * 32767).astype("<i2").tobytes())
        per = [np.mean(dbs[i * args.takes:(i + 1) * args.takes]) for i in range(len(PHRASES))]
        print(f"{name:22} | " + " | ".join(f"{x:12.1f}" for x in per) + f" | {np.mean(dbs):11.1f} | {dur:.1f}")
    print(f"\nфайлы: {out}/ — послушайте подряд, где концы слов целые")


if __name__ == "__main__":
    main()
