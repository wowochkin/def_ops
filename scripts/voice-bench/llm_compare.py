#!/usr/bin/env python3
"""Сравнение языковых моделей LM Studio для голосового режима. Только стандартная библиотека.

Каждая модель отвечает на вопросы llm_prompts.json (роли Жукова и начальника оперативного отдела, команды карты).
Замеры — время до первого токена и до конца первой фразы (с неё начинается озвучка), ток/с. Автоматические
проверки того, что ломает озвучку: цифры и сокращения в ответе, разметка (списки, звёздочки), латиница, длина,
просочившееся размышление; для команд — вызвана ли нужная команда с нужным аргументом. Ответы — для чтения
вслепую (страница out/llm-read.html) с оценками языка, сути и голоса роли.

  python3 llm_compare.py run --models qwen/qwen3.6-35b-a3b,google/gemma-4-26b-a4b   # id — как в LM Studio
  python3 llm_compare.py page                     # out/llm-read.html и ключ out/llm-key.json
  python3 llm_compare.py score                    # сводка: замеры, проверки, оценки (out/llm-ratings.json)

Модели в LM Studio загружаются по запросу (JIT) — держите в настройках сервера «Just-in-time model loading».
"""
import argparse
import html
import json
import random
import re
import statistics as st
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
RES = OUT / "llm" / "results.json"
P = json.loads((HERE / "llm_prompts.json").read_text(encoding="utf-8"))

NO_THINK = {  # способы выключить размышление — у разных моделей и шаблонов работают разные
    "kwargs": lambda b: b.update(chat_template_kwargs={"enable_thinking": False}),
    "no_think": lambda b: b["messages"][-1].update(content=b["messages"][-1]["content"] + " /no_think"),
    "effort": lambda b: b.update(reasoning_effort="none"),
}


def http(url, body=None, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def ask(url, model, prompt, modes):
    msgs = [{"role": "system", "content": P["roles"][prompt["role"]] + "\n\n" + P["speech_rules"]}]
    msgs += prompt.get("history", []) + [{"role": "user", "content": prompt["text"]}]
    body = {"model": model, "stream": True, "temperature": 0.7, "top_p": 0.8, "max_tokens": 1500, "messages": msgs}
    if prompt.get("tools"):
        body["tools"] = P["tools"]
    for m in modes:
        NO_THINK[m](body)
    t0 = time.perf_counter()
    first = first_text = first_sentence = None
    text, reasoning, n, calls = "", "", 0, {}
    with http(url + "/chat/completions", body) as r:
        for line in r:
            line = line.decode().strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            ch = json.loads(line[5:]).get("choices") or [{}]
            d = ch[0].get("delta", {})
            piece, rpiece = d.get("content") or "", d.get("reasoning_content") or d.get("reasoning") or ""
            for tc in d.get("tool_calls") or []:
                c = calls.setdefault(tc.get("index", 0), {"name": "", "args": ""})
                c["name"] += (tc.get("function") or {}).get("name") or ""
                c["args"] += (tc.get("function") or {}).get("arguments") or ""
            if (piece or rpiece or d.get("tool_calls")) and first is None:
                first = time.perf_counter() - t0
            n += bool(piece or rpiece)
            reasoning += rpiece
            if piece:
                first_text = first_text or time.perf_counter() - t0
                text += piece
                if first_sentence is None and re.search(r"[.!?…](\s|$)", text):
                    first_sentence = time.perf_counter() - t0
    total = time.perf_counter() - t0
    # размышление внутри текста (<think>…</think>) — тоже считается
    m = re.search(r"<think>(.*?)</think>", text, re.S)
    if m:
        reasoning += m.group(1)
        text = text.replace(m.group(0), "")
    return {"first_s": first, "first_sentence_s": first_sentence or (total if text else None), "total_s": total,
            "tok_s": n / max(1e-6, total - (first or 0)), "reasoning": len(reasoning), "text": text.strip(),
            "calls": list(calls.values())}


def checks(prompt, r):
    t = r["text"]
    c = {
        "digits": len(re.findall(r"\d+", t)),
        "markup": len(re.findall(r"[*#`]|^\s*[-•]\s|^\s*\d+[.)]\s", t, re.M)),
        "latin": len(re.findall(r"[A-Za-z]{2,}", t)),
        "sentences": len([s for s in re.split(r"[.!?…]+", t) if s.strip()]),
        "chars": len(t),
        "thinking": r["reasoning"] > 0,
    }
    if prompt.get("expect_tool"):
        want = prompt["expect_arg"] if isinstance(prompt["expect_arg"], list) else [prompt["expect_arg"]]
        ok = any(x["name"] == prompt["expect_tool"] and any(w.lower() in x["args"].lower() for w in want) for x in r["calls"])
        c["tool_ok"] = ok
    return c


def pick_mode(url, model):
    """Способ выключить размышление: первый, при котором ответ без размышления; иначе все сразу."""
    probe = {"id": "probe", "role": "staff", "text": "Сколько будет два плюс два? Ответь одним словом."}
    for m in NO_THINK:
        try:
            r = ask(url, model, probe, [m])
            if r["reasoning"] == 0 and r["text"]:
                return [m]
        except Exception:
            pass
    return list(NO_THINK)


def run(args):
    with http(args.url + "/models", timeout=10) as r:
        ids = [m["id"] for m in json.loads(r.read())["data"] if "embed" not in m["id"].lower()]
    models = args.models.split(",") if args.models else ids
    rows = json.loads(RES.read_text()) if RES.exists() else []
    for model in models:
        print(f"\n=== {model}")
        t0 = time.perf_counter()
        try:
            ask(args.url, model, {"id": "w", "role": "staff", "text": "Скажи «готов»."}, list(NO_THINK))  # загрузка
        except Exception as e:
            print(f"  не загрузилась: {e}")
            continue
        load_s = time.perf_counter() - t0
        modes = [] if args.think else pick_mode(args.url, model)
        print(f"  загрузка и прогрев {load_s:.0f} с; размышление выключено: {'+'.join(modes) or '—'}")
        new = []
        for p in P["prompts"]:
            try:
                r = ask(args.url, model, p, modes)
            except Exception as e:
                print(f"  {p['id']}: ошибка {e}")
                new.append({"model": model, "prompt": p["id"], "error": str(e)})
                continue
            c = checks(p, r)
            new.append({"model": model, "prompt": p["id"], "modes": modes, **r, "checks": c})
            tool = f" · команда {'да' if c['tool_ok'] else 'НЕТ'} {r['calls']}" if "tool_ok" in c else ""
            fs = f"{r['first_sentence_s']:.2f}" if r["first_sentence_s"] else "—"
            print(f"  {p['id']}: первая фраза {fs} с · {r['tok_s']:.0f} ток/с · цифр {c['digits']} · разметки {c['markup']}"
                  f"{' · РАЗМЫШЛЯЛА' if c['thinking'] else ''}{tool}\n      {r['text'][:220]}")
        rows = [x for x in rows if x["model"] != model] + new
        RES.parent.mkdir(parents=True, exist_ok=True)
        RES.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nзамеры: {RES}\nдальше: python3 llm_compare.py page")


def audio_path(model: str, prompt: str) -> Path:
    """Озвучка ответа (llm_voice.py): out/llm/audio/<модель>/<вопрос>.wav."""
    return OUT / "llm" / "audio" / re.sub(r"[^\w.-]+", "_", model) / f"{prompt}.wav"


def page(args):
    rows = [r for r in json.loads(RES.read_text()) if r.get("text")]
    rnd = random.Random(args.seed)
    key, blocks = {}, []
    sel = lambda name: "<select name=\"" + name + "\"><option></option>" + "".join(f"<option>{k}</option>" for k in range(1, 6)) + "</select>"
    for p in P["prompts"]:
        cand = [r for r in rows if r["prompt"] == p["id"]]
        rnd.shuffle(cand)
        items = []
        for i, r in enumerate(cand):
            sid = f"{p['id']}-{chr(65 + i)}"
            key[sid] = {"model": r["model"], "prompt": p["id"]}
            wav = audio_path(r["model"], p["id"])
            audio = f"<audio controls preload=\"none\" src=\"{html.escape(str(wav.relative_to(OUT)))}\"></audio>" if wav.exists() else ""
            items.append(f"<div class=\"s\" data-id=\"{sid}\"><b>{chr(65 + i)}</b> {audio}<p>{html.escape(r['text'])}</p>"
                         f"<label>язык {sel('lang')}</label><label>суть {sel('sense')}</label><label>в образе {sel('voice')}</label></div>")
        blocks.append(f"<section><h2>{p['id']} · {p['role']}</h2><p class=\"q\">{html.escape(p['text'])}</p>{''.join(items)}</section>")
    doc = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ответы моделей</title><style>
body {{ font: 15px/1.45 -apple-system, system-ui, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; color: #222; }}
header {{ position: sticky; top: 0; background: #fff; padding: 8px 0; border-bottom: 1px solid #ddd; }}
.q {{ color: #555; font-style: italic; }} .s {{ border-top: 1px solid #eee; padding: 6px 0; }} .s p {{ margin: 4px 0; }}
label {{ margin-right: 14px; font-size: 13px; color: #444; }}
</style></head><body><header><button id="save">Сохранить оценки</button> <span id="cnt"></span>
<div style="color:#666;font-size:13px">Модели под буквами перемешаны. Язык: 5 — естественная русская речь, без канцелярита и ошибок; суть: 5 — верно и по делу;
в образе: 5 — так бы и сказал этот человек. Ответы озвучены одним и тем же синтезом (llm_voice.py) — слушайте: длинное, с цифрами и сокращениями для голоса плохо.</div></header>
{''.join(blocks)}
<script>
const KEY = 'llm-read'; let st = {{}}; try {{ st = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }} catch (e) {{}}
const els = [...document.querySelectorAll('.s')];
const count = () => document.getElementById('cnt').textContent = 'оценено ' + Object.values(st).filter(v => v.lang && v.sense && v.voice).length + ' из ' + els.length;
for (const el of els) {{ const id = el.dataset.id, v = st[id] || {{}};
  for (const f of el.querySelectorAll('select')) {{ f.value = v[f.name] || '';
    f.addEventListener('change', () => {{ st[id] = {{ ...(st[id] || {{}}), [f.name]: f.value }}; try {{ localStorage.setItem(KEY, JSON.stringify(st)); }} catch (e) {{}} count(); }}); }} }}
count();
document.getElementById('save').onclick = () => {{ const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(st, null, 1)], {{ type: 'application/json' }})); a.download = 'llm-ratings.json'; a.click(); }};
</script></body></html>"""
    (OUT / "llm-read.html").write_text(doc, encoding="utf-8")
    (OUT / "llm-key.json").write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"откройте {OUT / 'llm-read.html'}; оценки → «Сохранить оценки» → out/llm-ratings.json; затем: python3 llm_compare.py score")


def score(args):
    rows = json.loads(RES.read_text())
    key_p, rat_p = OUT / "llm-key.json", OUT / "llm-ratings.json"
    key = json.loads(key_p.read_text()) if key_p.exists() else {}
    rat = json.loads(rat_p.read_text()) if rat_p.exists() else {}
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        e = by[r["model"]]
        if r.get("error"):
            e["errors"].append(r["prompt"])
            continue
        c = r["checks"]
        if r["text"]:  # ответ-команда без текста в скорость не идёт
            e["fs"].append(r["first_sentence_s"])
            e["tok"].append(round(r["tok_s"]))
        e["digits"].append(c["digits"])
        e["markup"].append(c["markup"] + c["latin"])
        e["think"].append(1 if c["thinking"] else 0)
        e["sent"].append(c["sentences"])
        if "tool_ok" in c:
            e["tool"].append(1 if c["tool_ok"] else 0)
    for sid, v in rat.items():
        k = key.get(sid)
        if k:
            for f in ("lang", "sense", "voice"):
                if v.get(f):
                    by[k["model"]][f].append(int(v[f]))
    med = lambda xs: round(st.median([x for x in xs if x is not None]), 2) if [x for x in xs if x is not None] else "—"
    avg = lambda xs: round(st.mean(xs), 2) if xs else "—"
    lines = ["# Языковые модели для голосового режима", "",
             "| Модель | Язык | Суть | В образе | Первая фраза, с | Ток/с | Цифры (всего) | Разметка/латиница | Фраз в ответе | Команды | Размышляла |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for m in sorted(by, key=lambda m: -sum(avg(by[m][f]) if by[m][f] else 0 for f in ("lang", "sense", "voice"))):
        e = by[m]
        lines.append(f"| {m} | {avg(e['lang'])} | {avg(e['sense'])} | {avg(e['voice'])} | {med(e['fs'])} | {med(e['tok'])} | "
                     f"{sum(e['digits'])} | {sum(e['markup'])} | {med(e['sent'])} | {sum(e['tool'])} из {len(e['tool'])} | "
                     f"{sum(e['think'])} из {len(e['think'])} |")
    (OUT / "llm.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="run", choices=["run", "page", "score"])
    ap.add_argument("--url", default="http://localhost:1234/v1")
    ap.add_argument("--models", help="id моделей LM Studio через запятую (по умолчанию — все загруженные/доступные)")
    ap.add_argument("--think", action="store_true", help="не выключать размышление")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    {"run": run, "page": page, "score": score}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
