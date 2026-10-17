#!/usr/bin/env python3
"""Озвучка ответов языковых моделей (out/llm/results.json из llm_compare.py) одним синтезом и одним голосом —
чтобы на странице чтения ответы можно было и слушать. Файлы — out/llm/audio/<модель>/<вопрос>.wav; уже
озвученные пропускаются (--redo — заново). После озвучки — python3 llm_compare.py page.

  .venv-tts/bin/python llm_voice.py [--engine qwen3-1.7b] [--ref zhukov-14s] [--redo]
"""
import argparse
import json
import sys
import time

from llm_compare import OUT, RES, audio_path
from tts_bench import HERE, MlxEngine, save_wav


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="qwen3-1.7b", help="id из engines.json (только MLX)")
    ap.add_argument("--ref", help="образец из refs.json (по умолчанию — default)")
    ap.add_argument("--redo", action="store_true")
    args = ap.parse_args()
    refs = json.loads((HERE / "refs.json").read_text(encoding="utf-8"))
    spec = next((e for e in json.loads((HERE / "engines.json").read_text(encoding="utf-8"))["engines"]
                 if e["id"] == args.engine and e["type"] == "mlx"), None)
    if not spec:
        sys.exit(f"нет MLX-движка {args.engine} в engines.json")
    ref = refs["refs"][args.ref or refs["default"]]
    rows = [r for r in json.loads(RES.read_text(encoding="utf-8")) if r.get("text")]
    todo = [r for r in rows if args.redo or not audio_path(r["model"], r["prompt"]).exists()]
    print(f"ответов: {len(rows)}, озвучить: {len(todo)}; синтез {args.engine}, образец {args.ref or refs['default']}")
    if not todo:
        return
    eng = MlxEngine(spec, ref)
    for r in todo:
        t0 = time.perf_counter()
        audio, sr, first, total = eng.synth(r["text"])
        f = audio_path(r["model"], r["prompt"])
        save_wav(f, audio, sr)
        print(f"  {r['model']} · {r['prompt']}: {len(audio) / sr:.1f} с звука за {time.perf_counter() - t0:.1f} с")
    eng.close()
    print(f"\nдальше: python3 llm_compare.py page  → {OUT / 'llm-read.html'}")


if __name__ == "__main__":
    main()
