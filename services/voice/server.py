#!/usr/bin/env python3
"""Сервис голоса: только звук. Окно приложения шлёт кадры микрофона и тексты для озвучки, сервис отвечает
распознанными репликами и звуком фраз (протокол — спецификация голосового управления, раздел 2).

  python server.py --port 47645 --data DIR [--seed-refs DIR] [--fake] [--fake-script FILE]
                   [--vad 0.5 --barge-vad 0.8 --barge-ms 300 --end-ms 400]

GET /health — {"state": "loading"|"ready"|"error", "error"?}; WS /ws — разговор. --fake — поддельные модели
(fake.py) без MLX и torch: для тестов и сквозной проверки приложения."""
from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from audio import FRAME, SR_IN, Listener, calibrate, should_merge
from tts import CALIB_PHRASE, PiecePlanner, Sentences, fade_tail, pause_after
from voices import DEFAULT_VOICE, RECORD_TEXT, ROLES, VoiceStore, check_recording, write_wav

HERE = Path(__file__).resolve().parent
SEED_DEFAULT = HERE.parent.parent / "scripts" / "voice-bench"
PREVIEW_TEXT = ("Слушаю вас. Докладываю: на участке армии без изменений, противник активности не проявляет, "
                "части готовы к выполнению задачи.")
RECORD_MAX_S = 60  # запись голоса дольше не копится
ECHO_RATIO = 0.6  # распознанное так похоже на сказанное моделью — это эхо из динамиков, не реплика


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Сервис голоса: VAD, конец реплики, распознавание, синтез")
    ap.add_argument("--port", type=int, default=47645)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data", required=True, help="папка данных голоса: voices/, roles.json")
    ap.add_argument("--seed-refs", dest="seed_refs", default=str(SEED_DEFAULT),
                    help="папка стенда с refs.json и ref/*.wav — встроенные образцы голоса")
    ap.add_argument("--fake", action="store_true", help="поддельные модели (без MLX и torch)")
    ap.add_argument("--fake-script", dest="fake_script", help="реплики поддельного распознавания, по строке")
    ap.add_argument("--vad", type=float, default=0.5, help="порог речи Silero, пока модель молчит")
    ap.add_argument("--barge-vad", dest="barge_vad", type=float, default=0.8, help="порог речи, пока модель говорит")
    ap.add_argument("--barge-ms", dest="barge_ms", type=int, default=300, help="сколько говорить, чтобы перебить")
    ap.add_argument("--end-ms", dest="end_ms", type=int, default=400, help="тишина до проверки конца реплики")
    ap.add_argument("--max-silence-ms", dest="max_silence_ms", type=int, default=1500)
    ap.add_argument("--turn", type=float, default=0.5, help="порог Smart Turn")
    ap.add_argument("--min-speech-ms", dest="min_speech_ms", type=int, default=200)
    ap.add_argument("--tts", default="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")
    ap.add_argument("--asr", default="v3_e2e_rnnt")
    ap.add_argument("--eos-extra", dest="eos_extra", type=int, default=1,
                    help="кадров (по 80 мс) договаривания после «конца» синтеза")
    ap.add_argument("--tail-fade-ms", dest="tail_fade_ms", type=int, default=10, help="затухание конца куска, мс")
    return ap.parse_args(argv)


class Service:
    """Модели и образцы — одни на все подключения; модели грузятся в фоне, /health показывает состояние."""

    def __init__(self, args):
        self.args = args
        self.store = VoiceStore(Path(args.data), Path(args.seed_refs) if args.seed_refs else None)
        if args.fake:
            from fake import FakeModels

            self.models = FakeModels(Path(args.fake_script) if args.fake_script else None)
        else:
            from models import Models

            self.models = Models(args.tts, args.asr, args.eos_extra)
        self.state, self.error = "loading", None
        self.loaded = threading.Event()
        self.calib_cache: dict[str, np.ndarray] = {}

    def start(self):
        if self.args.fake:
            self._load()
        else:
            threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            ref = self.ref_for("chief")
            self.models.load(ref if ref and ref[0].is_file() else None)  # прогрев — если образец есть
            self.state = "ready"
        except Exception as e:  # noqa: BLE001 — любая ошибка загрузки — в /health
            self.state, self.error = "error", f"{type(e).__name__}: {e}"
            print("ошибка загрузки:", self.error, flush=True)
        finally:
            self.loaded.set()

    def health(self) -> dict:
        return {"state": self.state, **({"error": self.error} if self.error else {})}

    def ref_for(self, role: str) -> tuple[Path, str] | None:
        """Образец роли; пропал — образец по умолчанию; нет и его — None."""
        for vid in (self.store.roles().get(role), DEFAULT_VOICE):
            try:
                return self.store.ref(vid)
            except KeyError:
                continue
        return None

    def calib_audio(self) -> np.ndarray:  # в нити mlx: тестовая фраза голосом начальника штаба, один раз на образец
        ref = self.ref_for("chief")
        key = str(ref[0]) if ref else ""
        if key not in self.calib_cache:
            self.calib_cache[key] = np.concatenate(list(self.models.tts_stream(CALIB_PHRASE, ref)))
        return self.calib_cache[key]


class Job:
    """Фраза `say` (или проба голоса): текст приходит целиком или кусками, звук — кусками синтеза."""

    def __init__(self, jid: int, ref, preview: bool = False):
        self.id, self.ref, self.preview = jid, ref, preview
        self.sentences = Sentences()
        self.planner = PiecePlanner()
        self.closed = False  # весь текст получен
        self.sent_all = False  # весь звук отправлен (say-done)
        self.cancel = threading.Event()
        self.wake = asyncio.Event()
        self.task: asyncio.Task | None = None
        self.samples = 0

    def push(self, text: str, more: bool):
        for s in self.sentences.push(text):
            self.planner.push(s)
        if not more:
            for s in self.sentences.rest():
                self.planner.push(s)
            self.planner.finish()
            self.closed = True
        self.wake.set()


def audio_frame(jid: int, sr: int, a: np.ndarray) -> bytes:
    return (b"\x01" + int(jid).to_bytes(4, "little") + int(sr).to_bytes(4, "little")
            + (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes())


class Session:
    """Одно подключение окна: слушатель кадров, склейка реплик, очередь фраз, калибровка, запись голоса."""

    def __init__(self, ws, svc: Service):
        self.ws, self.svc, self.m = ws, svc, svc.models
        a = svc.args
        self.loop = asyncio.get_running_loop()
        self.cfg = {"vad": a.vad, "barge_vad": a.barge_vad, "barge_ms": a.barge_ms, "end_ms": a.end_ms}
        self.listener = Listener(self.cfg, self._vad, self._turn, max_silence_ms=a.max_silence_ms,
                                 turn_threshold=a.turn, min_speech_ms=a.min_speech_ms)
        self.buf = np.zeros(0, np.float32)
        self.t_mic = 0.0  # часы микрофона, с: по числу пришедших отсчётов
        self.frames = 0
        # склейка реплик
        self.utt_id = 0
        self.prev: dict | None = None  # прежняя реплика: id, text, audio_s, end (конец речи по часам микрофона)
        self.merge = False  # текущая речь — продолжение прежней реплики
        self.reply_start: float | None = None  # когда зазвучал ответ после прежней реплики
        # фразы: пока фраза в jobs (до played), модель «говорит»
        self.jobs: dict[int, Job] = {}
        self.last_task: asyncio.Task | None = None
        self.play_until = 0.0  # когда (perf_counter) окно доиграет всё отправленное
        self.last_said = ""  # последние фразы модели — чтобы не принять их эхо за реплику
        # калибровка и запись голоса
        self.calib: dict | None = None
        self.calib_data: dict[str, list[float]] = {}
        self.recording: list[np.ndarray] | None = None
        self.pending: dict | None = None  # проверенная запись: audio, path

    async def _vad(self, frame):
        return self.m.vad_prob(frame)

    async def _turn(self, audio):
        return await self.loop.run_in_executor(self.m.mlx, self.m.turn_complete, audio)

    async def send(self, **msg):
        await self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    @property
    def busy(self) -> bool:
        return bool(self.jobs)

    # ------------------------------------------------------------ микрофон

    async def on_audio(self, pcm: bytes):
        self.buf = np.concatenate([self.buf, np.frombuffer(pcm, "<i2").astype(np.float32) / 32768])
        while len(self.buf) >= FRAME:
            frame, self.buf = self.buf[:FRAME], self.buf[FRAME:]
            self.t_mic += FRAME / SR_IN
            await self.on_frame(frame)

    async def _level_only(self, frame) -> float:
        p = self.m.vad_prob(frame)
        self.frames += 1
        if self.frames % 3 == 0:
            await self.send(type="level", p=round(p, 2), busy=self.busy)
        return p

    async def on_frame(self, frame: np.ndarray):
        if self.recording is not None:  # запись голоса: кадры — в запись, разговор стоит
            await self._level_only(frame)
            if sum(len(x) for x in self.recording) < RECORD_MAX_S * SR_IN:
                self.recording.append(frame)
            return
        if self.calib:  # калибровка: копим уверенность VAD, разговор стоит
            p = await self._level_only(frame)
            self.calib_data.setdefault(self.calib["step"], []).append(p)
            self.calib["left"] -= 1
            if self.calib["left"] <= 0:
                step, self.calib = self.calib["step"], None
                await self.send(type="calib_step", step=step, frames=len(self.calib_data[step]))
            return
        busy = self.busy
        for ev in await self.listener.feed(frame, busy):
            kind = ev[0]
            if kind == "level":
                await self.send(type="level", p=ev[1], busy=busy)
            elif kind == "speech_start":
                self.merge = self.prev is not None and should_merge(self.prev["end"], self.t_mic, self.reply_start)
                await self.send(type="speech", state="start")
            elif kind == "speech_end":
                await self.send(type="speech", state="end")
            elif kind == "barge":
                await self.barge_all()
            elif kind == "utterance":
                await self.on_utterance(ev[1])

    async def on_utterance(self, audio: np.ndarray):
        end = self.t_mic - self.listener.silence_ms / 1000
        merge = self.merge
        self.merge = False
        self.m.vad_reset()
        if self.busy:  # договорил, пока модель отвечала (или склейка) — ответ обрывается
            await self.barge_all()
        t0 = time.perf_counter()
        text = (await self.loop.run_in_executor(self.m.torch, self.m.transcribe, audio)).strip()
        stt_ms = round((time.perf_counter() - t0) * 1000)
        if not text:
            return
        if self.last_said and difflib.SequenceMatcher(
                None, text.lower(), self.last_said.lower()[-len(text) * 2:]).ratio() > ECHO_RATIO:
            await self.send(type="echo", text=text)  # микрофон поймал голос модели
            return
        self.utt_id += 1
        audio_s = round(len(audio) / SR_IN, 1)
        msg = {"id": self.utt_id, "text": text, "audio_s": audio_s, "stt_ms": stt_ms}
        if merge and self.prev:
            msg.update(text=f"{self.prev['text']} {text}", continues=self.prev["id"],
                       audio_s=round(self.prev["audio_s"] + audio_s, 1))
        self.prev = {"id": msg["id"], "text": msg["text"], "audio_s": msg["audio_s"], "end": end}
        self.reply_start = None
        await self.send(type="utterance", **msg)

    # ------------------------------------------------------------ фразы

    def _start_job(self, job: Job):
        self.jobs[job.id] = job
        prev = self.last_task
        job.task = asyncio.create_task(self.run_job(job, prev))
        self.last_task = job.task

    async def on_say(self, d: dict):
        jid, role, more = int(d["id"]), d.get("role", "chief"), bool(d.get("more"))
        job = self.jobs.get(jid)
        if job is None:
            if role not in ROLES:
                raise ValueError(f"нет такой роли: {role}")
            job = Job(jid, self.svc.ref_for(role))
            self._start_job(job)
        elif job.closed:
            raise ValueError(f"фраза {jid} уже получена целиком")
        job.push(str(d.get("text", "")), more)

    async def run_job(self, job: Job, prev: asyncio.Task | None):
        """Как Session.respond стенда, без языковой модели: куски по PiecePlanner, потоковый синтез в нити MLX,
        затухание конца куска, пауза по знаку (после последнего куска — без паузы)."""
        if prev is not None and not prev.done():
            await asyncio.wait([prev])  # фразы звучат по очереди; отмена этой не отменяет прежнюю
        sr = self.m.sample_rate
        fade_n = int(self.svc.args.tail_fade_ms / 1000 * sr)
        try:
            while True:
                piece = job.planner.next_piece(time.perf_counter(), self.play_until)
                if piece is None:
                    if job.planner.done:
                        break
                    job.wake.clear()
                    try:
                        await asyncio.wait_for(job.wake.wait(), 0.05)
                    except asyncio.TimeoutError:
                        pass
                    continue
                if not job.preview:
                    self.last_said = (self.last_said + " " + piece)[-400:]
                hold = await self._synth(job, piece, fade_n)
                if hold is None:  # ошибка синтеза — сообщена, фраза кончается
                    break
                pause = 0.0 if job.planner.done else pause_after(piece)
                await self.send_audio(job, np.concatenate([fade_tail(hold, sr, self.svc.args.tail_fade_ms),
                                                           np.zeros(int(pause * sr), np.float32)]))
            job.sent_all = True
            if self.jobs.get(job.id) is job:
                await self.send(type="say-done", id=job.id)
                if job.samples == 0:  # звука не было — играть нечего, played не придёт
                    self.jobs.pop(job.id, None)
        except asyncio.CancelledError:
            job.cancel.set()

    async def _synth(self, job: Job, text: str, fade_n: int) -> np.ndarray | None:
        q: asyncio.Queue = asyncio.Queue()
        cancel = job.cancel

        def synth():
            try:
                for a in self.m.tts_stream(text, job.ref):
                    if cancel.is_set():
                        break
                    self.loop.call_soon_threadsafe(q.put_nowait, a)
            except Exception as e:  # noqa: BLE001
                self.loop.call_soon_threadsafe(q.put_nowait, e)
            finally:
                self.loop.call_soon_threadsafe(q.put_nowait, None)

        fut = self.loop.run_in_executor(self.m.mlx, synth)
        hold = np.zeros(0, np.float32)  # последние fade_n отсчётов: на конце куска их плавно гасим
        err = None
        while (a := await q.get()) is not None:
            if isinstance(a, Exception):
                err = a
                continue
            a = np.concatenate([hold, a])
            n = max(0, len(a) - fade_n)
            a, hold = a[:n], a[n:]
            await self.send_audio(job, a)
        await fut
        if err is not None:
            await self.send(type="error", text=f"синтез: {err}")
            return None
        return hold

    async def send_audio(self, job: Job, a: np.ndarray):
        if not len(a):
            return
        sr = self.m.sample_rate
        self.play_until = max(self.play_until, time.perf_counter() + 0.03) + len(a) / sr
        if not job.preview and self.reply_start is None:
            self.reply_start = self.t_mic
        job.samples += len(a)
        await self.ws.send_bytes(audio_frame(job.id, sr, a))

    def _drop(self, job: Job):
        job.cancel.set()
        if job.task and not job.task.done():
            job.task.cancel()
        self.jobs.pop(job.id, None)

    async def barge_all(self):
        """Человек перебил: все фразы обрываются, окно гасит звук по barge {id}."""
        for job in list(self.jobs.values()):
            self._drop(job)
            await self.send(type="barge", id=job.id)
        self.play_until = 0.0

    async def stop(self, jid: int | None = None):
        for job in [j for j in self.jobs.values() if jid is None or j.id == jid]:
            self._drop(job)
            if not job.sent_all:
                await self.send(type="say-done", id=job.id, stopped=True)
        if not self.jobs:
            self.play_until = 0.0

    def played(self, jid: int):
        job = self.jobs.get(jid)
        if job is not None and job.sent_all:  # окно доиграло фразу — модель больше не говорит
            self.jobs.pop(jid, None)

    # ------------------------------------------------------------ калибровка

    async def calib_start(self, step: str, sec: float):
        await self.stop()
        self.recording = None
        self.listener.reset()
        self.m.vad_reset()
        if step == "noise":
            self.calib_data = {}
        self.calib_data.pop(step, None)
        if step in ("echo", "over"):  # модель говорит тестовую фразу; копим всё время звучания
            a = await self.loop.run_in_executor(self.m.mlx, self.svc.calib_audio)
            sr = self.m.sample_rate
            for i in range(0, len(a), sr // 2):
                await self.ws.send_bytes(audio_frame(0, sr, a[i:i + sr // 2]))
            sec = len(a) / sr + 0.3
        self.calib = {"step": step, "left": int(sec * 1000 / 32)}
        await self.send(type="calib_rec", step=step, sec=round(sec, 1))

    async def calib_finish(self):
        self.calib = None
        try:
            cfg, rep = calibrate(self.calib_data, self.cfg["end_ms"])
        except (ValueError, KeyError) as e:
            await self.send(type="calib_result", error=str(e) if isinstance(e, ValueError) else f"нет шага {e}")
            return
        self.cfg.update(cfg)
        await self.send(type="calib_result", cfg=cfg, **rep)
        await self.send(type="settings", **self.cfg)

    async def on_calib(self, d: dict):
        step = d.get("step")
        if step == "finish":
            await self.calib_finish()
        elif step == "cancel":
            self.calib = None
        elif step in ("noise", "speech", "echo", "over"):
            await self.calib_start(step, float(d.get("sec", 3)))
        else:
            raise ValueError(f"нет такого шага калибровки: {step}")

    # ------------------------------------------------------------ голоса

    async def voice_list(self, **extra):
        await self.send(type="voice_list", voices=self.svc.store.list(), roles=self.svc.store.roles(), **extra)

    async def on_voice(self, d: dict):
        op, store = d.get("op"), self.svc.store
        if op == "list":
            await self.voice_list()
        elif op == "record-start":
            await self.stop()
            self.calib = None
            self.listener.reset()
            self.m.vad_reset()
            self.recording, self.pending = [], None
            await self.send(type="voice_recording", text=RECORD_TEXT)
        elif op == "record-stop":
            if self.recording is None:
                raise ValueError("запись не идёт")
            audio = np.concatenate(self.recording) if self.recording else np.zeros(0, np.float32)
            self.recording = None
            self.listener.reset()
            self.m.vad_reset()
            heard = (await self.loop.run_in_executor(self.m.torch, self.m.transcribe, audio)).strip() if len(audio) else ""
            r = check_recording(audio, SR_IN, RECORD_TEXT, heard)
            if r["ok"]:
                path = Path(self.svc.args.data) / "pending.wav"
                write_wav(path, r["audio"], SR_IN)
                self.pending = {"audio": r["audio"], "path": path}
            await self.send(type="voice_check", heard=heard, **{k: v for k, v in r.items() if k != "audio"})
        elif op == "preview":
            vid = d.get("voice_id")
            if vid:
                ref = store.ref(vid)
            elif self.pending:
                ref = (self.pending["path"], RECORD_TEXT)
            else:
                raise ValueError("нет записи для пробы — запишите голос")
            job = Job(int(d.get("id", 0)), ref, preview=True)
            if job.id in self.jobs:
                raise ValueError(f"фраза {job.id} уже звучит")
            self._start_job(job)
            job.push(str(d.get("text") or PREVIEW_TEXT), False)
        elif op == "save":
            if not self.pending:
                raise ValueError("нет записи, прошедшей проверку — запишите голос заново")
            vid = store.save(str(d.get("name", "")), self.pending["audio"], SR_IN, RECORD_TEXT, "микрофон")
            self.pending = None
            await self.send(type="voice_saved", id=vid)
            await self.voice_list()
        elif op == "assign":
            store.assign(str(d.get("role")), str(d.get("voice_id")))
            await self.voice_list()
        elif op == "delete":
            store.delete(str(d.get("voice_id")))
            await self.voice_list()
        else:
            raise ValueError(f"нет такой операции с голосами: {op}")

    # ------------------------------------------------------------ сообщения окна

    async def on_text(self, d: dict):
        t = d.get("type")
        if t in ("hello", "settings"):
            src = d.get("settings") if t == "hello" else d
            for k in self.cfg:
                if isinstance((src or {}).get(k), (int, float)) and not isinstance(src[k], bool):
                    self.cfg[k] = src[k]
            await self.send(type="settings", **self.cfg)
        elif t == "say":
            await self.on_say(d)
        elif t == "stop":
            await self.stop(int(d["id"]) if d.get("id") is not None else None)
        elif t == "played":
            self.played(int(d.get("id", 0)))
        elif t == "calib":
            await self.on_calib(d)
        elif t == "voice":
            await self.on_voice(d)
        else:
            raise ValueError(f"неизвестное сообщение: {t}")

    async def close(self):
        for job in list(self.jobs.values()):
            self._drop(job)


def build_app(argv=None):
    args = parse_args(argv)
    svc = Service(args)
    svc.start()
    app = FastAPI()
    app.state.service = svc

    @app.get("/health")
    def health():
        return svc.health()

    @app.websocket("/ws")
    async def ws(sock: WebSocket):
        await sock.accept()
        s = Session(sock, svc)
        try:
            if not svc.loaded.is_set():
                await asyncio.get_running_loop().run_in_executor(None, svc.loaded.wait)
            if svc.state != "ready":
                await s.send(type="error", text=f"модели не загрузились: {svc.error}")
            else:
                await s.send(type="ready", voices=svc.store.list(), roles=svc.store.roles(), loaded=True,
                             record_text=RECORD_TEXT, rate=svc.models.sample_rate)
                await s.send(type="settings", **s.cfg)
            while True:
                msg = await sock.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if svc.state != "ready":
                    continue
                try:
                    if msg.get("bytes"):
                        await s.on_audio(msg["bytes"])
                    elif msg.get("text"):
                        await s.on_text(json.loads(msg["text"]))
                except (ValueError, KeyError, TypeError) as e:
                    await s.send(type="error", text=str(e) if not isinstance(e, KeyError) else f"нет поля или образца: {e}")
        except WebSocketDisconnect:
            pass
        finally:
            await s.close()

    return app


def main():
    import uvicorn

    app = build_app()
    a = app.state.service.args
    print(f"сервис голоса: http://{a.host}:{a.port} (ws /ws, /health)", flush=True)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
