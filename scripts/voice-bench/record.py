#!/usr/bin/env python3
"""Запись фраз для испытания распознавания: каждую фразу из stt_phrases.json читаете вслух — Enter начинает и
Enter заканчивает запись. Файлы — rec/<id>.wav (16 кГц, моно). Повторный запуск перезаписывает только
указанные фразы: --only s03,s07.

  .venv-stt/bin/python record.py [--only s01,s02]
"""
import argparse
import json
import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

HERE = Path(__file__).resolve().parent
SR = 16000


def record() -> np.ndarray:
    chunks, stop = [], threading.Event()

    def cb(indata, frames, t, status):
        chunks.append(indata.copy())

    with sd.InputStream(samplerate=SR, channels=1, dtype="int16", callback=cb):
        input("  … говорите, Enter — стоп ")
        stop.set()
    return np.concatenate(chunks)[:, 0] if chunks else np.zeros(0, np.int16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    args = ap.parse_args()
    phrases = json.loads((HERE / "stt_phrases.json").read_text(encoding="utf-8"))["phrases"]
    if args.only:
        keep = set(args.only.split(","))
        phrases = [p for p in phrases if p["id"] in keep]
    (HERE / "rec").mkdir(exist_ok=True)
    print(f"микрофон: {sd.query_devices(kind='input')['name']}")
    for p in phrases:
        input(f"\n{p['id']}: «{p['text']}»\n  Enter — начать ")
        a = record()
        with wave.open(str(HERE / "rec" / f"{p['id']}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(a.tobytes())
        print(f"  записано {len(a) / SR:.1f} с")
    print("\nдальше: .venv-stt/bin/python stt_bench.py")


if __name__ == "__main__":
    main()
