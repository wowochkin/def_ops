#!/usr/bin/env python3
"""Запись фраз для испытания распознавания: каждую фразу из stt_phrases.json читаете вслух — Enter начинает и
Enter заканчивает запись. Файлы — rec/<id>.wav (16 кГц, моно). Уже записанные фразы пропускаются (продолжение
после сбоя); перезаписать — --redo s03,s07 или --redo all.

Микрофон открывается один раз на всю запись: повторное открытие и закрытие потока на macOS иногда зависает.

  .venv-stt/bin/python record.py [--redo s03,s07]
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


class Recorder:
    def __init__(self):
        self.on = threading.Event()
        self.lock = threading.Lock()
        self.chunks = []
        self.level = 0.0
        self.stream = sd.InputStream(samplerate=SR, channels=1, dtype="int16", callback=self._cb)
        self.stream.start()

    def _cb(self, indata, frames, t, status):
        if self.on.is_set():
            with self.lock:
                self.chunks.append(indata[:, 0].copy())
            self.level = max(self.level, float(np.abs(indata).max()) / 32768)

    def take(self) -> np.ndarray:
        with self.lock:
            self.chunks, self.level = [], 0.0
        self.on.set()
        input("  … говорите, Enter — стоп ")
        self.on.clear()
        with self.lock:
            return np.concatenate(self.chunks) if self.chunks else np.zeros(0, np.int16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--redo", help="id через запятую или all — перезаписать")
    args = ap.parse_args()
    phrases = json.loads((HERE / "stt_phrases.json").read_text(encoding="utf-8"))["phrases"]
    redo = set((args.redo or "").split(","))
    rec = HERE / "rec"
    rec.mkdir(exist_ok=True)
    todo = [p for p in phrases if "all" in redo or p["id"] in redo or not (rec / f"{p['id']}.wav").exists()]
    if not todo:
        print("все фразы уже записаны (перезаписать: --redo s03 или --redo all)")
        return
    print(f"микрофон: {sd.query_devices(kind='input')['name']}; осталось фраз: {len(todo)} из {len(phrases)}")
    r = Recorder()
    try:
        for p in todo:
            input(f"\n{p['id']}: «{p['text']}»\n  Enter — начать ")
            a = r.take()
            if a.size < SR // 2:
                print("  слишком коротко — фраза пропущена, запустите record.py ещё раз")
                continue
            with wave.open(str(rec / f"{p['id']}.wav"), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes(a.astype("<i2").tobytes())
            quiet = " — очень тихо, проверьте микрофон" if r.level < 0.02 else ""
            print(f"  записано {a.size / SR:.1f} с, пик {r.level:.2f}{quiet}")
    finally:
        r.stream.abort()  # abort, а не stop: stop на macOS может ждать опустошения буфера
    print("\nдальше: .venv-stt/bin/python stt_bench.py")


if __name__ == "__main__":
    main()
