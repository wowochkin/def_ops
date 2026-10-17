#!/usr/bin/env python3
"""Скорость языковой модели в LM Studio для голосового разговора: время до первого слова и до конца первой
фразы (с неё начинается озвучка), скорость токенов в секунду. Только стандартная библиотека.

  python3 llm_bench.py [--url http://localhost:1234/v1] [--model qwen3.6-35b-a3b] [--think]
"""
import argparse
import json
import re
import time
import urllib.request

PERSONA = ("Ты — маршал Г. К. Жуков, весна 1945 года. Отвечай устно, коротко и по делу, как на докладе: "
           "две-четыре фразы, без списков и разметки, числа словами.")
QUESTIONS = [
    "Товарищ маршал, почему атака шестнадцатого апреля на Зееловские высоты захлебнулась?",
    "Когда вводить первую гвардейскую танковую армию, если вторая полоса обороны ещё не прорвана?",
    "Что важнее сейчас — Берлин или окружение девятой армии?",
]


def models(url):
    with urllib.request.urlopen(url + "/models", timeout=10) as r:
        return [m["id"] for m in json.loads(r.read())["data"]]


def ask(url, model, q, think):
    body = {"model": model, "stream": True, "temperature": 0.6, "max_tokens": 400,
            "messages": [{"role": "system", "content": PERSONA}, {"role": "user", "content": q}],
            "chat_template_kwargs": {"enable_thinking": think}}
    req = urllib.request.Request(url + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    first_any = first_text = first_sentence = None
    text, reasoning, n = "", "", 0
    with urllib.request.urlopen(req, timeout=300) as r:
        for line in r:
            line = line.decode().strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            d = json.loads(line[5:])["choices"][0].get("delta", {})
            piece = d.get("content") or ""
            rpiece = d.get("reasoning_content") or d.get("reasoning") or ""
            if (piece or rpiece) and first_any is None:
                first_any = time.perf_counter() - t0
            if rpiece:
                reasoning += rpiece
                n += 1
            if piece:
                n += 1
                if first_text is None:
                    first_text = time.perf_counter() - t0
                text += piece
                if first_sentence is None and re.search(r"[.!?…](\s|$)", text):
                    first_sentence = time.perf_counter() - t0
    total = time.perf_counter() - t0
    return {"first_token_s": first_any, "first_text_s": first_text, "first_sentence_s": first_sentence or total,
            "total_s": total, "tok_s": n / max(1e-6, total - (first_any or 0)), "reasoning_chars": len(reasoning), "text": text}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:1234/v1")
    ap.add_argument("--model", help="id модели в LM Studio (по умолчанию — первая с qwen3.6 в имени)")
    ap.add_argument("--think", action="store_true", help="с размышлением (по умолчанию выключено)")
    args = ap.parse_args()
    ids = models(args.url)
    model = args.model or next((m for m in ids if "qwen3.6" in m.lower()), ids[0])
    print(f"модель: {model}; размышление: {'вкл' if args.think else 'выкл'}")
    ask(args.url, model, "Скажи «готов».", args.think)  # прогрев: загрузка модели в память
    rows = []
    for q in QUESTIONS:
        r = ask(args.url, model, q, args.think)
        rows.append(r)
        think = f" · размышление {r['reasoning_chars']} зн." if r["reasoning_chars"] else ""
        print(f"\n— {q}\n  первый токен {r['first_token_s']:.2f} с · первая фраза {r['first_sentence_s']:.2f} с · "
              f"всего {r['total_s']:.1f} с · {r['tok_s']:.0f} ток/с{think}\n  {r['text'].strip()}")
    fs = sorted(r["first_sentence_s"] for r in rows)
    print(f"\nпервая фраза: медиана {fs[len(fs) // 2]:.2f} с — столько добавляет модель к задержке ответа голосом")


if __name__ == "__main__":
    main()
