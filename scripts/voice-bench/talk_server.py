#!/usr/bin/env python3
"""Стенд живого разговора: говорите свободно, модель сама слушает, отвечает голосом и её можно перебить.

Браузер (talk.html) — микрофон с подавлением эха и воспроизведение; этот сервер — всё остальное:
  речь (Silero VAD, процессор) → конец реплики (Smart Turn, MLX) → распознавание (GigaAM v3, PyTorch)
  → поправка названий театра → языковая модель (LM Studio, поток) → фразы → синтез (Qwen3-TTS, MLX, поток)
  → звук кусками в браузер. Заговорили, пока модель отвечает, — ответ обрывается, звук гаснет.

Вся работа MLX (Smart Turn, синтез) — в одном потоке: потоки MLX привязаны к нити, на которой созданы.

  .venv-tts/bin/python talk_server.py [--persona zhukov|staff] [--model qwen/qwen3.6-35b-a3b] [--port 8765]
  затем откройте http://localhost:8765 (Chrome или Safari), «Начать», разрешите микрофон.
"""
import argparse
import asyncio
import difflib
import json
import re
import tempfile
import threading
import time
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SR_IN = 16000
FRAME = 512  # Silero: 32 мс на 16 кГц

# ---------------------------------------------------------------- текст для синтеза

ABBR = [  # сокращения, которые модель всё же может написать
    (r"\bгв\.", "гвардейская"), (r"\bуд\.", "ударная"), (r"\bТА\b", "танковая армия"), (r"\bсд\b", "стрелковая дивизия"),
    (r"\bск\b", "стрелковый корпус"), (r"\bтк\b", "танковый корпус"), (r"\bкм\b", "километров"), (r"\bт\.\s?е\.", "то есть"),
    (r"\bт\.\s?д\.", "так далее"), (r"\bтыс\.", "тысяч"), (r"\bчел\.", "человек"), (r"№", "номер "),
]


def speakable(text: str) -> str:
    """Числа и сокращения — словами (на случай, если модель нарушила правило), без разметки."""
    from num2words import num2words

    t = re.sub(r"[*#`_]+", "", text)
    for pat, rep in ABBR:
        t = re.sub(pat, rep, t)
    t = re.sub(r"(\d)\s(\d{3})\b", r"\1\2", t)  # «1 250»
    months = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split()
    t = re.sub(r"\b(\d{1,2})\.(\d{2})(?:\.\d{2,4})?\b",  # «20.04» → «двадцать апреля»
               lambda m: f"{num2words(int(m.group(1)), lang='ru')} {months[int(m.group(2)) - 1]}" if 1 <= int(m.group(2)) <= 12 else m.group(0), t)
    t = re.sub(r"(\d+)-(?:й|я|е|го|му|м|х)\b", lambda m: num2words(int(m.group(1)), lang="ru", to="ordinal"), t)
    t = re.sub(r"\d+(?:[.,]\d+)?", lambda m: num2words(float(m.group(0).replace(",", ".")) if re.search(r"[.,]", m.group(0)) else int(m.group(0)), lang="ru"), t)
    return re.sub(r"\s+", " ", t).strip()


class Sentences:
    """Режет поток токенов на фразы для синтеза: по концу предложения или переносу строки; первую — короче
    (по запятой после 50 знаков), чтобы голос начинался раньше."""

    def __init__(self):
        self.buf, self.first = "", True

    def push(self, piece: str) -> list[str]:
        self.buf += piece
        out = []
        while True:
            # конец предложения — знак и пробел после него (иначе «3.5» и «20.04» резались бы); перенос строки
            m = re.search(r"[.!?…]+[»\")]?\s+|\n+", self.buf)
            if not m and self.first and len(self.buf) > 50:
                m = re.search(r",\s+", self.buf[30:])
                if m:
                    cut = 30 + m.end()
                    out.append(self.buf[:cut])
                    self.buf, self.first = self.buf[cut:], False
                    continue
            if not m:
                break
            out.append(self.buf[:m.end()])
            self.buf, self.first = self.buf[m.end():], False
        return [s for s in (x.strip() for x in out) if re.search(r"\w", s)]

    def rest(self) -> list[str]:
        s, self.buf = self.buf.strip(), ""
        return [s] if re.search(r"\w", s) else []


# ---------------------------------------------------------------- названия театра

def gazetteer() -> list[str]:
    names = {"Кюстрин", "Зееловские", "Зелов", "Мюнхеберг", "Врицен", "Штраусберг", "Бернау", "Катуков", "Чуйков",
             "Кривошеев", "Франкфурт", "Одер", "Шпрее", "Хафель", "Цоссен", "Кетцин", "Дольгелин", "Альт-Розенталь"}
    th = ROOT / "packages/sim/data/theatres/oder-berlin-1945.json"
    try:
        d = json.loads(th.read_text(encoding="utf-8"))
        for k in ("areas", "rivers", "bridges", "lines"):
            for x in d.get(k, []):
                names.update(w for w in re.findall(r"[А-ЯЁ][а-яё]{3,}(?:-[А-ЯЁ][а-яё]+)?", x.get("name", "")))
    except Exception:
        pass
    common = {"Вторая", "Третья", "Главная", "Нижнем", "Оборона", "Отсечная", "Позиция", "Полоса", "Рубеж", "Первая"}
    return sorted(n for n in names if n not in common)


def fix_names(text: str, names: list[str]) -> tuple[str, list[str]]:
    """Слова, похожие на названия театра, заменяются на написание из словаря (похожесть по difflib: от 0,75 для
    длинных слов, от 0,8 для коротких); лишнее окончание слова сохраняется («кастрина» → «Кюстрина»)."""
    low = {n.lower(): n for n in names}
    fixes = []

    def one(m):
        w = m.group(0)
        lw = w.lower()
        if len(w) < 5 or lw in low:
            return w
        best = difflib.get_close_matches(lw, low.keys(), n=1, cutoff=0.75 if len(w) >= 7 else 0.8)
        if not best:
            return w
        cand = low[best[0]]
        if lw[: len(cand) - 2] == best[0][: len(cand) - 2]:  # то же название в другом падеже — оставить
            return w
        # окончание: хвост слова после совпавшего конца названия («кастрин|а» → «Кюстрин|а»)
        blocks = [b for b in difflib.SequenceMatcher(None, lw, best[0]).get_matching_blocks() if b.size]
        last = blocks[-1] if blocks else None
        new = cand + (lw[last.a + last.size:] if last and last.b + last.size == len(cand) else "")
        fixes.append(f"{w}→{new}")
        return new

    return re.sub(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*", one, text), fixes


# ---------------------------------------------------------------- модели

class Models:
    def __init__(self, args):
        self.args = args
        self.mlx = ThreadPoolExecutor(1, thread_name_prefix="mlx")  # всё MLX — в одной нити
        self.torch = ThreadPoolExecutor(1, thread_name_prefix="torch")
        self.names = gazetteer()
        refs = json.loads((HERE / "refs.json").read_text(encoding="utf-8"))
        self.ref = refs["refs"][args.ref or refs["default"]]
        prompts = json.loads((HERE / "llm_prompts.json").read_text(encoding="utf-8"))
        self.system = prompts["roles"][args.persona] + "\n\n" + prompts["speech_rules"]
        self.tts_lock = threading.Lock()

    def load(self):
        print("загрузка: VAD, распознавание…")
        self.torch.submit(self._load_torch).result()
        print("загрузка: Smart Turn, синтез…")
        self.mlx.submit(self._load_mlx).result()
        print("прогрев синтеза…")
        self.mlx.submit(lambda: list(self._tts_iter("Слушаю вас.", threading.Event()))).result()

    def _load_torch(self):
        import gigaam
        import torch
        from silero_vad import load_silero_vad

        torch.set_num_threads(2)
        self.vad = load_silero_vad()
        try:
            self.asr = gigaam.load_model("v3_rnnt", device="mps")
            self._asr_file(self._silence_wav())
        except Exception:
            self.asr = gigaam.load_model("v3_rnnt", device="cpu")

    def _silence_wav(self):
        f = Path(tempfile.gettempdir()) / "talk-warm.wav"
        write_wav(f, np.zeros(SR_IN, np.float32), SR_IN)
        return f

    def _load_mlx(self):
        from mlx_audio.tts.utils import load_model
        from mlx_audio.utils import load_audio
        from mlx_audio.vad import load as load_vad

        self.turn = load_vad("mlx-community/smart-turn-v3")
        self.tts = load_model(self.args.tts)
        self.tts_sr = int(self.tts.sample_rate)
        self.ref_audio = load_audio(str(HERE / self.ref["file"]), sample_rate=self.tts_sr)

    # VAD — в нити asyncio (≈1 мс на кадр), чтобы слушать и во время синтеза
    def vad_prob(self, frame: np.ndarray) -> float:
        import torch

        return float(self.vad(torch.from_numpy(frame), SR_IN).item())

    def vad_reset(self):
        self.vad.reset_states()

    def turn_complete(self, audio: np.ndarray) -> float:
        return float(self.turn.predict_endpoint(audio[-8 * SR_IN:], sample_rate=SR_IN).probability)

    def _asr_file(self, path) -> str:
        return str(self.asr.transcribe(str(path)))

    def transcribe(self, audio: np.ndarray) -> str:  # в torch-нити
        f = Path(tempfile.gettempdir()) / "talk-turn.wav"
        write_wav(f, audio, SR_IN)
        return self._asr_file(f)

    def _tts_iter(self, text: str, cancel: threading.Event):
        for r in self.tts.generate(text=text, ref_audio=self.ref_audio, ref_text=self.ref["text"], lang_code="russian",
                                   stream=True, streaming_interval=0.32, verbose=False):
            if cancel.is_set():
                break
            yield np.asarray(r.audio, dtype=np.float32).reshape(-1)


def write_wav(path, audio, sr):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


# ---------------------------------------------------------------- разговор

class Session:
    def __init__(self, ws, models: Models, args):
        self.ws, self.m, self.args = ws, models, args
        self.loop = asyncio.get_running_loop()
        self.history = []
        self.audio = np.zeros(0, np.float32)  # реплика: от начала речи (с запасом)
        self.pre = np.zeros(0, np.float32)  # последние 300 мс до начала речи
        self.buf = np.zeros(0, np.float32)
        self.in_speech = False
        self.speech_ms = self.silence_ms = 0.0
        self.turn_checked = False
        self.response: asyncio.Task | None = None
        self.cancel = threading.Event()
        self.playing = False  # браузер ещё играет ответ
        self.barged = False
        self.last_said = ""  # последние фразы модели — чтобы не принять их эхо за реплику
        # настройки, которые меняются со страницы на ходу: порог речи в тишине, порог и длительность
        # перебивания (пока модель говорит, микрофон слышит и её — порог строже), пауза до проверки конца реплики
        self.cfg = {"vad": args.vad, "barge_vad": args.barge_vad, "barge_ms": args.barge_ms, "end_ms": args.end_ms}
        self.frames = 0

    async def send(self, **msg):
        await self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    @property
    def busy(self):
        return (self.response is not None and not self.response.done()) or self.playing

    async def on_audio(self, pcm: bytes):
        self.buf = np.concatenate([self.buf, np.frombuffer(pcm, "<i2").astype(np.float32) / 32768])
        while len(self.buf) >= FRAME:
            frame, self.buf = self.buf[:FRAME], self.buf[FRAME:]
            await self.on_frame(frame)

    async def on_frame(self, frame):
        a, c = self.args, self.cfg
        p = self.m.vad_prob(frame)
        busy = self.busy
        speech = p >= (c["barge_vad"] if busy else c["vad"])
        self.frames += 1
        if self.frames % 3 == 0:  # индикатор на странице: ~10 раз в секунду
            await self.send(type="level", p=round(p, 2), busy=busy)
        if not self.in_speech:
            self.pre = np.concatenate([self.pre, frame])[-int(0.3 * SR_IN):]
            if speech:
                self.in_speech, self.speech_ms, self.silence_ms, self.turn_checked = True, 32.0, 0.0, False
                self.barged = False
                self.audio = np.concatenate([self.pre, frame])
                await self.send(type="vad", state="speech")
            return
        self.audio = np.concatenate([self.audio, frame])
        if speech:
            self.speech_ms += 32
            self.silence_ms = 0
            self.turn_checked = False
            # перебивание: человек говорит дольше порога, пока модель отвечает
            if busy and not self.barged and self.speech_ms >= c["barge_ms"]:
                self.barged = True
                await self.barge_in()
            return
        self.silence_ms += 32
        if self.speech_ms < a.min_speech_ms and self.silence_ms >= 300:  # щелчок, кашель
            self.in_speech = False
            await self.send(type="vad", state="silence")
            return
        if self.silence_ms >= c["end_ms"] and not self.turn_checked:
            self.turn_checked = True
            prob = await self.loop.run_in_executor(self.m.mlx, self.m.turn_complete, self.audio)
            await self.send(type="turn", prob=round(prob, 2))
            if prob >= a.turn:
                await self.end_turn(prob)
                return
        if self.silence_ms >= a.max_silence_ms:
            await self.end_turn(None)

    async def barge_in(self):
        if self.response and not self.response.done():
            self.cancel.set()
            self.response.cancel()
        elif self.playing and self.history and self.history[-1]["role"] == "assistant":
            # ответ уже сгенерирован, но ещё звучал — модель должна знать, что её не дослушали
            self.history[-1]["content"] += " (перебит, не договорил)"
        self.playing = False
        await self.send(type="stop")

    async def end_turn(self, prob):
        self.in_speech = False
        audio = self.audio[: len(self.audio) - int(self.silence_ms / 1000 * SR_IN) + int(0.2 * SR_IN)]
        self.m.vad_reset()
        await self.send(type="vad", state="silence")
        if self.busy:
            await self.barge_in()
        t_end = time.perf_counter()
        text = (await self.loop.run_in_executor(self.m.torch, self.m.transcribe, audio)).strip()
        t_stt = time.perf_counter()
        if not text:
            return
        if self.last_said and difflib.SequenceMatcher(None, text.lower(), self.last_said.lower()[-len(text) * 2:]).ratio() > 0.6:
            await self.send(type="echo", text=text)  # микрофон поймал голос модели
            return
        text, fixes = fix_names(text, self.m.names)
        await self.send(type="user", text=text, fixes=fixes, stt_ms=round((t_stt - t_end) * 1000),
                        audio_s=round(len(audio) / SR_IN, 1), turn=prob)
        self.cancel = threading.Event()
        self.response = asyncio.create_task(self.respond(text, t_end))

    async def respond(self, text, t_end):
        self.history.append({"role": "user", "content": text})
        cancel = self.cancel
        q: asyncio.Queue = asyncio.Queue()
        times = {}
        spoken = []

        def llm():  # поток токенов из LM Studio → фразы в очередь
            body = {"model": self.args.model, "stream": True, "temperature": 0.7, "top_p": 0.8, "max_tokens": 600,
                    "reasoning_effort": "none", "messages": [{"role": "system", "content": self.m.system}] + self.history[-12:]}
            req = urllib.request.Request(self.args.llm + "/chat/completions", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
            cut = Sentences()
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    for line in r:
                        if cancel.is_set():
                            return
                        line = line.decode().strip()
                        if not line.startswith("data:") or line == "data: [DONE]":
                            continue
                        piece = (json.loads(line[5:]).get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                        if piece and "llm_first" not in times:
                            times["llm_first"] = time.perf_counter()
                        for s in cut.push(piece):
                            times.setdefault("sentence", time.perf_counter())
                            self.loop.call_soon_threadsafe(q.put_nowait, s)
                for s in cut.rest():
                    times.setdefault("sentence", time.perf_counter())
                    self.loop.call_soon_threadsafe(q.put_nowait, s)
            except Exception as e:
                self.loop.call_soon_threadsafe(q.put_nowait, RuntimeError(str(e)))
            finally:
                self.loop.call_soon_threadsafe(q.put_nowait, None)

        threading.Thread(target=llm, daemon=True).start()
        await self.send(type="state", state="thinking")
        try:
            while True:
                s = await q.get()
                if s is None:
                    break
                if isinstance(s, Exception):
                    await self.send(type="error", text=f"языковая модель: {s}")
                    break
                say = speakable(s)
                await self.send(type="assistant", text=s, say=say if say != s else None)
                self.last_said = (self.last_said + " " + say)[-400:]
                chunks: asyncio.Queue = asyncio.Queue()

                def tts(say=say):
                    try:
                        for a in self.m._tts_iter(say, cancel):
                            self.loop.call_soon_threadsafe(chunks.put_nowait, a)
                    finally:
                        self.loop.call_soon_threadsafe(chunks.put_nowait, None)

                fut = self.loop.run_in_executor(self.m.mlx, tts)
                while (a := await chunks.get()) is not None:
                    if "audio" not in times:
                        times["audio"] = time.perf_counter()
                        ms = lambda k: round((times[k] - t_end) * 1000) if k in times else None
                        await self.send(type="latency", stt_llm_first=ms("llm_first"), first_sentence=ms("sentence"),
                                        first_audio=ms("audio"))
                    self.playing = True
                    await self.ws.send_bytes(b"\x01" + struct_rate(self.m.tts_sr) + (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())
                await fut
                spoken.append(s)
        except asyncio.CancelledError:
            cancel.set()
            spoken.append("…")
        finally:
            if spoken:
                self.history.append({"role": "assistant", "content": " ".join(spoken)})
            await self.send(type="state", state="done")


def struct_rate(sr: int) -> bytes:
    return int(sr).to_bytes(4, "little")


# ---------------------------------------------------------------- веб

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--llm", default="http://localhost:1234/v1")
    ap.add_argument("--model", default="qwen/qwen3.6-35b-a3b")
    ap.add_argument("--persona", default="zhukov", choices=["zhukov", "staff"])
    ap.add_argument("--tts", default="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")
    ap.add_argument("--ref", help="образец из refs.json")
    ap.add_argument("--vad", type=float, default=0.5, help="порог речи Silero, пока модель молчит")
    ap.add_argument("--barge-vad", dest="barge_vad", type=float, default=0.8, help="порог речи, пока модель говорит (перебивание)")
    ap.add_argument("--end-ms", dest="end_ms", type=int, default=400, help="тишина до проверки конца реплики")
    ap.add_argument("--max-silence-ms", dest="max_silence_ms", type=int, default=1500, help="тишина — реплика кончилась в любом случае")
    ap.add_argument("--turn", type=float, default=0.5, help="порог Smart Turn")
    ap.add_argument("--barge-ms", dest="barge_ms", type=int, default=300, help="сколько говорить, чтобы перебить")
    ap.add_argument("--min-speech-ms", dest="min_speech_ms", type=int, default=200)
    args = ap.parse_args()

    import uvicorn
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import HTMLResponse

    models = Models(args)
    models.load()
    app = FastAPI()

    @app.get("/favicon.ico")
    def favicon():
        from fastapi import Response

        return Response(status_code=204)

    @app.get("/")
    def index():
        return HTMLResponse((HERE / "talk.html").read_text(encoding="utf-8"))

    @app.websocket("/ws")
    async def ws(sock: WebSocket):
        await sock.accept()
        s = Session(sock, models, args)
        await s.send(type="ready", persona=args.persona, model=args.model, names=len(models.names))
        await s.send(type="settings", **s.cfg)
        try:
            while True:
                msg = await sock.receive()
                if msg.get("bytes"):
                    await s.on_audio(msg["bytes"])
                elif msg.get("text"):
                    d = json.loads(msg["text"])
                    if d.get("type") == "played":  # браузер доиграл ответ
                        s.playing = False
                    elif d.get("type") == "settings":
                        for k in s.cfg:
                            if isinstance(d.get(k), (int, float)):
                                s.cfg[k] = d[k]
                        await s.send(type="settings", **s.cfg)
                    elif d.get("type") == "reset":
                        s.history.clear()
                if msg.get("type") == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass
        finally:
            if s.response:
                s.cancel.set()
                s.response.cancel()

    print(f"\nготово: откройте http://localhost:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
