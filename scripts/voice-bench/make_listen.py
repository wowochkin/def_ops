#!/usr/bin/env python3
"""Страница слепого прослушивания: out/listen-<образец>.html и ключ out/key-<образец>.json.

На странице по каждой фразе — образец голоса и варианты движков под буквами в случайном порядке (порядок
свой у каждой фразы). Оценки: естественность и похожесть на образец (1–5), ошибки чтения (ударение, число,
сокращение, пропуск). Оценки хранятся в браузере и выгружаются кнопкой «Сохранить оценки» в JSON; сводка —
score.py.

  python3 make_listen.py [--ref zhukov-14s] [--seed 7]
"""
import argparse
import html
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    refs = json.loads((HERE / "refs.json").read_text(encoding="utf-8"))
    ref_name = args.ref or refs["default"]
    results = json.loads((OUT / "tts" / "results.json").read_text(encoding="utf-8"))
    # на (движок, фразу) — запись с выбранным образцом, а если движок считался только со своим (OmniVoice — 10 с) — её
    best = {}
    for r in results:
        if not r.get("file"):
            continue
        k = (r["engine"], r["phrase"])
        if k not in best or r["ref"] == ref_name:
            best[k] = r
    rows = list(best.values())
    phrases = json.loads((HERE / "phrases.json").read_text(encoding="utf-8"))["phrases"]
    rnd = random.Random(args.seed)
    key, blocks = {}, []
    for p in phrases:
        cand = [r for r in rows if r["phrase"] == p["id"]]
        if not cand:
            continue
        rnd.shuffle(cand)
        items = []
        for i, r in enumerate(cand):
            letter = chr(ord("A") + i)
            sid = f"{p['id']}-{letter}"
            key[sid] = {"engine": r["engine"], "ref": r["ref"], "phrase": p["id"]}
            items.append(f"""
      <div class="s" data-id="{sid}"><b>{letter}</b><audio controls preload="none" src="{html.escape(r['file'])}"></audio>
        <label>естественность <select name="nat"><option></option>{''.join(f'<option>{k}</option>' for k in range(1, 6))}</select></label>
        <label>похожесть <select name="sim"><option></option>{''.join(f'<option>{k}</option>' for k in range(1, 6))}</select></label>
        <label><input type="checkbox" name="err"> ошибка чтения</label>
        <input name="note" placeholder="что не так">
      </div>""")
        blocks.append(f"""
    <section><h2>{p['id']} · {html.escape(p['kind'])}</h2><p class="t">{html.escape(p['text'])}</p>{''.join(items)}</section>""")
    ref_rel = "../" + refs["refs"][ref_name]["file"]
    page = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Прослушивание · {ref_name}</title>
<style>
body {{ font: 14px/1.4 -apple-system, system-ui, sans-serif; max-width: 980px; margin: 24px auto; padding: 0 16px; color: #222; }}
header {{ position: sticky; top: 0; background: #fff; padding: 8px 0; border-bottom: 1px solid #ddd; z-index: 1; }}
section {{ margin: 22px 0; }} h2 {{ font-size: 15px; margin: 0 0 4px; }} .t {{ color: #555; margin: 0 0 8px; }}
.s {{ display: flex; gap: 10px; align-items: center; padding: 4px 0; flex-wrap: wrap; }} .s b {{ width: 18px; }}
.s input[name=note] {{ flex: 1; min-width: 160px; }} button {{ padding: 6px 12px; }}
</style></head><body>
<header><b>Образец голоса:</b> <audio controls src="{html.escape(ref_rel)}"></audio>
<button id="save">Сохранить оценки</button> <span id="cnt"></span>
<div style="color:#666">Варианты под буквами перемешаны; какой движок под какой буквой — в key-{ref_name}.json (не открывайте до конца).
Естественность: 5 — как живой человек; похожесть: 5 — не отличить от образца. Ошибка чтения — ударение, число, сокращение, пропуск слова.</div></header>
{''.join(blocks)}
<script>
const KEY = 'voice-bench-{ref_name}';
let st = {{}}; try {{ st = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }} catch (e) {{}}
const els = [...document.querySelectorAll('.s')];
const count = () => document.getElementById('cnt').textContent = 'оценено ' + Object.values(st).filter(v => v.nat && v.sim).length + ' из ' + els.length;
for (const el of els) {{
  const id = el.dataset.id, v = st[id] || {{}};
  for (const f of el.querySelectorAll('select,input')) {{
    if (f.type === 'checkbox') f.checked = !!v[f.name]; else f.value = v[f.name] || '';
    f.addEventListener('change', () => {{
      st[id] = {{ ...(st[id] || {{}}), [f.name]: f.type === 'checkbox' ? f.checked : f.value }};
      try {{ localStorage.setItem(KEY, JSON.stringify(st)); }} catch (e) {{}}
      count();
    }});
  }}
  // одновременно звучит одна запись
  el.querySelector('audio').addEventListener('play', (e) => document.querySelectorAll('audio').forEach(a => a !== e.target && a.pause()));
}}
count();
document.getElementById('save').onclick = () => {{
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(st, null, 1)], {{ type: 'application/json' }}));
  a.download = 'ratings-{ref_name}.json'; a.click();
}};
</script></body></html>"""
    (OUT / f"listen-{ref_name}.html").write_text(page, encoding="utf-8")
    (OUT / f"key-{ref_name}.json").write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"откройте {OUT / f'listen-{ref_name}.html'} (оценки → «Сохранить оценки» → положите ratings-{ref_name}.json в out/)")


if __name__ == "__main__":
    main()
