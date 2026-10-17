#!/usr/bin/env python3
"""Испытание синтеза речи с клонированием голоса на Mac (Apple Silicon).

Каждый движок из engines.json озвучивает фразы из phrases.json голосом образца из refs.json. Замеряются:
загрузка модели, время до первого звука (у потоковых — первый кусок), полное время, длительность звука,
скорость относительно реального времени (RTF = время синтеза / длительность звука; меньше 1 — быстрее
реального времени) и пиковая память. Звук — out/tts/<образец>/<движок>/<фраза>.wav, замеры —
out/tts/results.json (дописываются, повторный прогон движка заменяет его строки).

  .venv-tts/bin/python tts_bench.py                       # все движки, кроме необязательных
  .venv-tts/bin/python tts_bench.py --engines qwen3-1.7b,fish-s2-pro --ref zhukov-22s
  .venv-tts/bin/python tts_bench.py --phrases p01,p04 --engines voicebox-qwen
"""
import argparse
import gc
import json
import struct
import sys
import time
import traceback
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "tts"


def load_json(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def save_wav(path: Path, audio: np.ndarray, sr: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def peak_memory_gb():
    try:
        import mlx.core as mx
        f = getattr(mx, "get_peak_memory", None) or mx.metal.get_peak_memory
        return round(f() / 2**30, 2)
    except Exception:
        return None


def reset_peak():
    try:
        import mlx.core as mx
        (getattr(mx, "reset_peak_memory", None) or mx.metal.reset_peak_memory)()
    except Exception:
        pass


def clear_cache():
    gc.collect()
    try:
        import mlx.core as mx
        (getattr(mx, "clear_cache", None) or mx.metal.clear_cache)()
    except Exception:
        pass


# ---------------------------------------------------------------- mlx-audio

class MlxEngine:
    def __init__(self, spec, ref):
        from mlx_audio.tts.utils import load_model
        from mlx_audio.utils import load_audio

        errors = []
        t0 = time.perf_counter()
        self.model = None
        for repo in spec["repo"]:
            try:
                self.model = load_model(repo)
                self.repo = repo
                break
            except Exception as e:  # следующий вариант весов
                errors.append(f"{repo}: {e}")
        if self.model is None:
            raise RuntimeError("модель не загрузилась: " + " | ".join(errors))
        self.load_s = time.perf_counter() - t0
        self.sr = int(getattr(self.model, "sample_rate", 24000))
        self.spec = spec
        self.ref_path = str(HERE / ref["file"])
        self.ref_array = load_audio(self.ref_path, sample_rate=self.sr)
        self.kwargs = dict(spec.get("kwargs", {}))
        if spec.get("ref_text"):
            self.kwargs["ref_text"] = ref["text"]
        # язык у Qwen3-TTS — по списку модели: «russian», иначе авто
        langs = getattr(self.model, "get_supported_languages", None)
        if callable(langs) and "lang_code" in self.kwargs:
            have = [str(x).lower() for x in langs()]
            want = self.kwargs["lang_code"].lower()
            if want not in have:
                ru = [x for x in have if x.startswith("russ") or x == "ru"]
                self.kwargs["lang_code"] = ru[0] if ru else "auto"
                print(f"  язык: {want} нет в {have} → {self.kwargs['lang_code']}")
        self.stream = bool(spec.get("stream"))
        if not self.stream:
            self.kwargs.pop("streaming_interval", None)

    def _generate(self, text, ref):
        kw = dict(self.kwargs)
        if self.stream:
            kw["stream"] = True
        return self.model.generate(text=text, ref_audio=ref, verbose=False, **kw)

    def synth(self, text):
        t0 = time.perf_counter()
        first = None
        chunks = []
        sr = self.sr
        for ref in (self.ref_array, self.ref_path):  # одни модели берут массив, другие — путь
            try:
                for r in self._generate(text, ref):
                    a = np.asarray(r.audio, dtype=np.float32).reshape(-1)
                    if first is None and a.size:
                        first = time.perf_counter() - t0
                    chunks.append(a)
                    sr = int(getattr(r, "sample_rate", sr) or sr)
                break
            except (TypeError, AttributeError, ValueError) as e:
                if ref is self.ref_path or chunks:
                    raise
                print(f"  образец массивом не принят ({e}) — передаю путь")
                t0 = time.perf_counter()
        total = time.perf_counter() - t0
        audio = np.concatenate(chunks) if chunks else np.zeros(0, np.float32)
        return audio, sr, first if first is not None else total, total

    def close(self):
        del self.model
        clear_cache()


# ---------------------------------------------------------------- Voicebox

class VoiceboxEngine:
    """Voicebox (github.com/jamiepine/voicebox) по его локальному API: POST /generate/stream → WAV потоком."""

    def __init__(self, spec, ref, base):
        import urllib.request

        self.urllib = urllib.request
        self.base = base.rstrip("/")
        self.spec = spec
        self.repo = f"voicebox:{spec['engine']}"
        t0 = time.perf_counter()
        profiles = self._get("/profiles")
        match = [p for p in profiles if p.get("name") == spec["profile"]]
        if not match:
            names = ", ".join(p.get("name", "?") for p in profiles) or "нет"
            raise RuntimeError(
                f"в Voicebox нет профиля «{spec['profile']}» (есть: {names}). Создайте его из {ref['file']} "
                f"с расшифровкой из refs.json"
            )
        self.profile_id = match[0]["id"]
        self.load_s = time.perf_counter() - t0
        self.stream = True

    def _get(self, path):
        with self.urllib.urlopen(self.base + path, timeout=30) as r:
            return json.loads(r.read())

    def synth(self, text):
        body = {"profile_id": self.profile_id, "text": text, "language": "ru", "engine": self.spec["engine"]}
        if self.spec.get("model_size"):
            body["model_size"] = self.spec["model_size"]
        req = self.urllib.Request(
            self.base + "/generate/stream", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
        )
        t0 = time.perf_counter()
        first = None
        buf = bytearray()
        with self.urllib.urlopen(req, timeout=600) as r:
            while True:
                part = r.read(8192)
                if not part:
                    break
                buf += part
                if first is None and len(buf) > 2048:  # заголовок WAV и первые отсчёты
                    first = time.perf_counter() - t0
        total = time.perf_counter() - t0
        audio, sr = parse_wav(bytes(buf))
        return audio, sr, first if first is not None else total, total

    def close(self):
        pass


def parse_wav(data: bytes):
    """WAV из потока: размеры в заголовке могут быть не заполнены — ищем fmt и data сами."""
    if data[:4] != b"RIFF":
        raise RuntimeError(f"ответ не WAV: {data[:200]!r}")
    pos, sr, bits, ch = 12, 24000, 16, 1
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        if cid == b"fmt ":
            _, ch, sr, _, _, bits = struct.unpack("<HHIIHH", data[pos + 8:pos + 24])
        if cid == b"data":
            raw = data[pos + 8:]
            if bits == 16:
                a = np.frombuffer(raw[: len(raw) // 2 * 2], "<i2").astype(np.float32) / 32768
            else:
                a = np.frombuffer(raw[: len(raw) // 4 * 4], "<f4").astype(np.float32)
            return a.reshape(-1, ch)[:, 0] if ch > 1 else a, sr
        pos += 8 + size + (size & 1)
    raise RuntimeError("в WAV нет блока data")


# ---------------------------------------------------------------- прогон

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", help="id через запятую (по умолчанию — все, кроме optional)")
    ap.add_argument("--ref", help="образец из refs.json (по умолчанию — у движка свой или общий default)")
    ap.add_argument("--phrases", help="id фраз через запятую")
    ap.add_argument("--voicebox", default="http://127.0.0.1:17493", help="адрес API Voicebox")
    args = ap.parse_args()

    refs = load_json("refs.json")
    phrases = load_json("phrases.json")["phrases"]
    if args.phrases:
        keep = set(args.phrases.split(","))
        phrases = [p for p in phrases if p["id"] in keep]
    engines = load_json("engines.json")["engines"]
    if args.engines:
        keep = args.engines.split(",")
        engines = [e for e in engines if e["id"] in keep]
    else:
        engines = [e for e in engines if not e.get("optional")]

    OUT.mkdir(parents=True, exist_ok=True)
    res_path = OUT / "results.json"
    results = json.loads(res_path.read_text()) if res_path.exists() else []

    for spec in engines:
        ref_name = args.ref or spec.get("ref") or refs["default"]
        ref = refs["refs"][ref_name]
        if not (HERE / ref["file"]).exists():
            print(f"нет {ref['file']} — сначала ./prepare_ref.sh <запись.mp3>")
            sys.exit(1)
        print(f"\n=== {spec['id']} · образец {ref_name}")
        rows = []
        reset_peak()
        try:
            eng = VoiceboxEngine(spec, ref, args.voicebox) if spec["type"] == "voicebox" else MlxEngine(spec, ref)
        except Exception as e:
            print(f"  ошибка загрузки: {e}")
            rows.append({"engine": spec["id"], "ref": ref_name, "error": str(e)})
        else:
            print(f"  {eng.repo}: загрузка {eng.load_s:.1f} с")
            try:  # прогрев: первая генерация компилирует ядра — в замер не идёт
                eng.synth("Проверка связи.")
            except Exception as e:
                print(f"  прогрев не прошёл: {e}")
            for p in phrases:
                row = {"engine": spec["id"], "ref": ref_name, "repo": eng.repo, "phrase": p["id"], "kind": p["kind"],
                       "text": p["text"], "load_s": round(eng.load_s, 2), "stream": eng.stream, "license": spec.get("license")}
                try:
                    audio, sr, first, total = eng.synth(p["text"])
                    dur = len(audio) / sr if sr else 0
                    f = OUT / ref_name / spec["id"] / f"{p['id']}.wav"
                    save_wav(f, audio, sr)
                    row.update(ttfa_s=round(first, 3), total_s=round(total, 3), audio_s=round(dur, 2),
                               rtf=round(total / dur, 3) if dur else None, sr=sr, file=str(f.relative_to(HERE / "out")))
                    print(f"  {p['id']}: первый звук {first:.2f} с, всего {total:.2f} с, звук {dur:.1f} с, RTF {row['rtf']}")
                except Exception as e:
                    traceback.print_exc(limit=2)
                    row["error"] = str(e)
                rows.append(row)
            for r in rows:
                r["peak_gb"] = peak_memory_gb()
            eng.close()
        results = [r for r in results if not (r["engine"] == spec["id"] and r["ref"] == ref_name)] + rows
        res_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"\nзамеры: {res_path}\nдальше: .venv-tts/bin/python make_listen.py")


if __name__ == "__main__":
    main()
