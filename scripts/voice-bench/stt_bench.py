#!/usr/bin/env python3
"""Испытание распознавания русской речи на записях rec/*.wav (record.py): доля ошибок по словам (WER, после
приведения к нижнему регистру, ё→е, без знаков) и время распознавания фразы. Модели: Whisper large-v3-turbo и
Parakeet v3 (MLX), GigaAM v3 (Сбер, PyTorch), T-one (Т-Банк, ONNX). Результат — out/stt.md и out/stt.json.

  .venv-stt/bin/python stt_bench.py [--engines whisper,gigaam-rnnt]
"""
import argparse
import json
import re
import statistics as st
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def norm(s):
    s = s.lower().replace("ё", "е").replace("-", " ")
    return re.sub(r"[^\w\s]", " ", s).split()


def wer(ref, hyp):
    a, b = norm(ref), norm(hyp)
    d = list(range(len(b) + 1))
    for i, wa in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, wb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (wa != wb))
    return d[len(b)] / max(1, len(a))


def mlx_engine(repo):
    def load():
        from mlx_audio.stt.utils import load_model

        m = load_model(repo)
        return lambda path: m.generate(path, language="ru").text if "whisper" in repo else m.generate(path).text
    return load


def gigaam_engine(name):
    def load():
        import gigaam

        m = gigaam.load_model(name)
        return lambda path: str(m.transcribe(path))
    return load


def tone_engine():
    from tone import StreamingCTCPipeline, read_audio

    p = StreamingCTCPipeline.from_hugging_face()
    return lambda path: " ".join(x.text for x in p.forward_offline(read_audio(path)))


ENGINES = {
    "whisper-turbo": mlx_engine("mlx-community/whisper-large-v3-turbo-asr-fp16"),
    "parakeet-v3": mlx_engine("mlx-community/parakeet-tdt-0.6b-v3"),
    "gigaam-rnnt": gigaam_engine("v3_rnnt"),
    "gigaam-e2e": gigaam_engine("v3_e2e_rnnt"),
    "t-one": tone_engine,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", help=",".join(ENGINES))
    args = ap.parse_args()
    phrases = json.loads((HERE / "stt_phrases.json").read_text(encoding="utf-8"))["phrases"]
    phrases = [p for p in phrases if (HERE / "rec" / f"{p['id']}.wav").exists()]
    if not phrases:
        print("нет записей в rec/ — сначала record.py")
        return
    names = args.engines.split(",") if args.engines else list(ENGINES)
    OUT.mkdir(exist_ok=True)
    res = {}
    for n in names:
        print(f"\n=== {n}")
        try:
            t0 = time.perf_counter()
            run = ENGINES[n]()
            load_s = time.perf_counter() - t0
            run(str(HERE / "rec" / f"{phrases[0]['id']}.wav"))  # прогрев
        except Exception as e:
            traceback.print_exc(limit=2)
            res[n] = {"error": str(e)}
            continue
        rows = []
        for p in phrases:
            f = str(HERE / "rec" / f"{p['id']}.wav")
            t0 = time.perf_counter()
            try:
                hyp = run(f)
            except Exception as e:
                hyp = f"<ошибка: {e}>"
            dt = time.perf_counter() - t0
            w = wer(p["text"], hyp)
            rows.append({"id": p["id"], "hyp": hyp, "wer": round(w, 3), "s": round(dt, 3)})
            print(f"  {p['id']} WER {w:.2f} · {dt:.2f} с · {hyp}")
        res[n] = {"load_s": round(load_s, 1), "wer": round(st.mean(r["wer"] for r in rows), 3),
                  "s": round(st.median(r["s"] for r in rows), 3), "rows": rows}
    (OUT / "stt.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["# Распознавание русской речи", "", "| Модель | WER | Фраза, с (медиана) | Загрузка, с |", "|---|---|---|---|"]
    for n, r in sorted(res.items(), key=lambda x: x[1].get("wer", 9)):
        lines.append(f"| {n} | {r['wer']:.1%} | {r['s']} | {r['load_s']} |" if "wer" in r else f"| {n} | ошибка: {r['error'][:80]} | | |")
    (OUT / "stt.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n" + "\n".join(lines))


if __name__ == "__main__":
    main()
