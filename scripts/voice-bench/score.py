#!/usr/bin/env python3
"""Сводка испытания синтеза: out/report-<образец>.md.

По движкам — средние оценки слепого прослушивания (если есть out/ratings-<образец>.json), ошибки чтения,
разборчивость (доля ошибок распознавания CER: синтезированную речь распознаёт Whisper и сравнивает с текстом
фразы; включается --asr) и скорость: время до первого звука, RTF, загрузка, пиковая память.

  .venv-tts/bin/python score.py [--ref zhukov-14s] [--asr]
"""
import argparse
import json
import re
import statistics as st
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def norm(s):
    s = s.lower().replace("ё", "е")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s)).strip()


def cer(ref, hyp):
    a, b = norm(ref), norm(hyp)
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[len(b)] / max(1, len(a))


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(st.mean(xs), 2) if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref")
    ap.add_argument("--asr", action="store_true", help="разборчивость по Whisper (mlx-audio)")
    args = ap.parse_args()
    refs = json.loads((HERE / "refs.json").read_text(encoding="utf-8"))
    ref_name = args.ref or refs["default"]
    results = [r for r in json.loads((OUT / "tts" / "results.json").read_text(encoding="utf-8"))]
    key_p, rat_p = OUT / f"key-{ref_name}.json", OUT / f"ratings-{ref_name}.json"
    key = json.loads(key_p.read_text()) if key_p.exists() else {}
    ratings = json.loads(rat_p.read_text()) if rat_p.exists() else {}

    # фразы с числами словами: для разборчивости сравниваем с вариантом словами
    phrases = {p["id"]: p for p in json.loads((HERE / "phrases.json").read_text(encoding="utf-8"))["phrases"]}
    if args.asr:
        from mlx_audio.stt.utils import load_model

        stt = load_model("mlx-community/whisper-large-v3-turbo-asr-fp16")
        cache_p = OUT / "tts" / "asr.json"
        cache = json.loads(cache_p.read_text()) if cache_p.exists() else {}
        for r in results:
            if r.get("file") and r["file"] not in cache:
                cache[r["file"]] = stt.generate(str(OUT / r["file"]), language="ru").text
        cache_p.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
        for r in results:
            if r.get("file"):
                r["asr"] = cache[r["file"]]
                r["cer"] = None if r["kind"] == "numbers" else cer(phrases[r["phrase"]]["text"], cache[r["file"]])

    # как на странице прослушивания: выбранный образец, а у движка, считанного только со своим, — его
    best = {}
    for r in results:
        k = (r["engine"], r.get("phrase"))
        if k not in best or r["ref"] == ref_name:
            best[k] = r
    by = defaultdict(lambda: defaultdict(list))
    for r in best.values():
        e = by[r["engine"]]
        if r.get("error"):
            e["errors"].append(f"{r.get('phrase', 'загрузка')}: {r['error'][:120]}")
            continue
        for k in ("ttfa_s", "rtf", "load_s", "peak_gb", "cer"):
            e[k].append(r.get(k))
        e["license"] = [r.get("license")]
    for sid, v in ratings.items():
        k = key.get(sid)
        if not k:
            continue
        e = by[k["engine"]]
        e["nat"].append(float(v["nat"]) if v.get("nat") else None)
        e["sim"].append(float(v["sim"]) if v.get("sim") else None)
        e["err"].append(1 if v.get("err") else 0)
        if v.get("note"):
            e["notes"].append(f"{k['phrase']}: {v['note']}")

    lines = [f"# Синтез с клонированием · образец {ref_name}", "",
             "| Движок | Естеств. | Похожесть | Ошибки чтения | CER | Первый звук, с | RTF | Загрузка, с | Память, ГБ | Лицензия |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    order = sorted(by, key=lambda n: -((mean(by[n]["nat"]) or 0) + (mean(by[n]["sim"]) or 0)))
    for n in order:
        e = by[n]
        errs = f"{sum(e['err'])} из {len(e['err'])}" if e["err"] else "—"
        lines.append(f"| {n} | {mean(e['nat']) or '—'} | {mean(e['sim']) or '—'} | {errs} | {mean(e['cer']) or '—'} | "
                     f"{mean(e['ttfa_s']) or '—'} | {mean(e['rtf']) or '—'} | {mean(e['load_s']) or '—'} | "
                     f"{max([x for x in e['peak_gb'] if x] or [0]) or '—'} | {(e['license'] or ['—'])[0]} |")
    lines += ["", "RTF — время синтеза / длительность звука (меньше 1 — быстрее реального времени). Первый звук — у потоковых "
              "движков первый кусок, у остальных вся фраза. CER — доля ошибок, когда Whisper распознаёт синтезированную речь "
              "(фразы с числами цифрами не считаются).", ""]
    for n in order:
        e = by[n]
        if e["errors"] or e["notes"]:
            lines.append(f"## {n}")
            lines += [f"- ошибка: {x}" for x in e["errors"]] + [f"- {x}" for x in e["notes"]] + [""]
    p = OUT / f"report-{ref_name}.md"
    p.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:len(order) + 4]))
    print(f"\nотчёт: {p}")


if __name__ == "__main__":
    main()
