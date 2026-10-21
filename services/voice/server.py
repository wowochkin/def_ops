#!/usr/bin/env python3
"""Сервис голоса: только звук. Окно приложения шлёт кадры микрофона и тексты для озвучки, сервис отвечает
распознанными репликами и звуком фраз (протокол — спецификация голосового управления, раздел 2).

  python server.py --port 47645 --data DIR [--seed-refs DIR] [--fake] [--fake-script FILE]
                   [--vad 0.5 --barge-vad 0.8 --barge-ms 300 --end-ms 400 --barge-mode voice|word] [--aec on|off]

GET /health — {"state": "loading"|"ready"|"error", "error"?}; WS /ws — разговор. --fake — поддельные модели
(fake.py) без MLX и torch: для тестов и сквозной проверки приложения.

Кадры микрофона (двоичные): int16 LE без заголовка — только микрофон; `[0x02][микрофон int16 × n][опора int16 × n]` —
микрофон и звук, который окно в тот же миг отрисовало на вывод (опора подавления эха, aec.py). Окно шлёт второй
вид, когда в `ready` сказано `aec: true`."""
from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import threading
import time
import uuid
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

import aec
from audio import FRAME, SR_IN, Listener, calibrate, is_stop_phrase, should_merge
from tts import CALIB_PHRASE, PiecePlanner, Sentences, fade_tail, pause_after
from engines import EngineStore, describe as engines_list
from voices import DEFAULT_VOICE, RECORD_TEXT, ROLES, VoiceStore, check_recording, trim_silence, write_wav

HERE = Path(__file__).resolve().parent
SEED_DEFAULT = HERE.parent.parent / "scripts" / "voice-bench"
PREVIEW_TEXT = ("Слушаю вас. Докладываю: на участке армии без изменений, противник активности не проявляет, "
                "части готовы к выполнению задачи.")
RECORD_MAX_S = 60  # запись голоса дольше не копится
ECHO_RATIO = 0.6  # распознанное так похоже на сказанное моделью — это эхо из динамиков, не реплика…
ECHO_AFTER_S = 1.5  # …если речь кончилась, пока штаб говорит, или не позже этого после конца его звука
ASR_PIECE_S = 24  # распознавание берёт до 25 с звука (GigaAM) — длиннее режется на куски
NO_REF = "нет образца голоса — запишите голос в окне «Голоса»"
WORD_CHUNK_S = 0.5  # перебивание словом: кусок речи распознаётся, когда он не короче этого…
WORD_STEP_S = 0.25  # …и снова — по мере роста куска на столько
WORD_WINDOW_S = 1.75  # распознаётся хвост куска не длиннее этого (стоп-слово — в новой речи, цена не растёт)
BARGE_MODES = ("voice", "word")
MIC_REF = 0x02  # первый байт кадра «микрофон + опора»; кадр только микрофона — чётной длины, без заголовка


def aec_enabled(arg: str | None, available: bool) -> bool:
    """--aec: не задан — подавление эха есть, если есть пакет; on без пакета — ошибка при запуске."""
    if arg == "on" and not available:
        raise SystemExit("--aec on: нет пакета livekit для подавления эха — поставьте его (setup.sh) или --aec off")
    return available if arg is None else arg == "on"


def parse_mic(b: bytes) -> tuple[np.ndarray, np.ndarray | None]:
    """Кадр микрофона окна → (микрофон, опора или None), float32 −1…1."""
    if len(b) % 2 == 0:
        return np.frombuffer(b, "<i2").astype(np.float32) / 32768, None
    if b[0] != MIC_REF or (len(b) - 1) % 4:
        raise ValueError(f"непонятный кадр микрофона: {len(b)} байт, первый {b[0]}")
    a = np.frombuffer(b, "<i2", offset=1).astype(np.float32) / 32768
    return a[: len(a) // 2], a[len(a) // 2:]


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
    ap.add_argument("--barge-mode", dest="barge_mode", choices=BARGE_MODES, default="voice",
                    help="перебивание: voice — речью громче порога, word — стоп-словом («Стоп», «Штаб…»)")
    ap.add_argument("--end-ms", dest="end_ms", type=int, default=400, help="тишина до проверки конца реплики")
    ap.add_argument("--max-silence-ms", dest="max_silence_ms", type=int, default=1500)
    ap.add_argument("--turn", type=float, default=0.5, help="порог Smart Turn")
    ap.add_argument("--min-speech-ms", dest="min_speech_ms", type=int, default=200)
    ap.add_argument("--tts", default=None,
                    help="свои веса синтеза вместо первого доступного варианта выбранной модели озвучки")
    ap.add_argument("--asr", default="v3_e2e_rnnt")
    ap.add_argument("--eos-extra", dest="eos_extra", type=int, default=1,
                    help="кадров (по 80 мс) договаривания после «конца» синтеза")
    ap.add_argument("--tail-fade-ms", dest="tail_fade_ms", type=int, default=10, help="затухание конца куска, мс")
    ap.add_argument("--aec", choices=("on", "off"), default=None,
                    help="подавление эха по звуку штаба (по умолчанию — on, если есть пакет livekit)")
    return ap.parse_args(argv)


class Service:
    """Модели и образцы — одни на все подключения; модели грузятся в фоне, /health показывает состояние."""

    def __init__(self, args):
        self.args = args
        self.aec = aec_enabled(args.aec, aec.available())
        self.store = VoiceStore(Path(args.data), Path(args.seed_refs) if args.seed_refs else None)
        self.engines = EngineStore(Path(args.data))
        if args.fake:
            from fake import FakeModels

            self.models = FakeModels(Path(args.fake_script) if args.fake_script else None, self.engines.get())
        else:
            from models import Models

            self.models = Models(self.engines.get(), args.asr, args.eos_extra, args.tts)
        self.state, self.error = "loading", None
        self.tts_state, self.tts_error = "ready", None  # смена модели озвучки: loading — идёт загрузка
        self.loaded = threading.Event()
        self.calib_cache: dict[str, np.ndarray] = {}
        for f in Path(args.data).glob("pending-*.wav"):  # непрошедшие в образцы записи прошлого запуска
            f.unlink(missing_ok=True)

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

    def tts_info(self) -> dict:
        return {"engines": engines_list(), "current": self.models.engine.id, "state": self.tts_state,
                **({"error": self.tts_error} if self.tts_error else {})}

    def switch_tts(self, eid: str):  # в нити mlx, после синтеза, который уже идёт
        try:
            self.models.switch_tts(eid)
        except ValueError:
            raise
        except Exception as e:  # noqa: BLE001 — прежняя модель вернулась, причина — в окно
            self.tts_error = f"{type(e).__name__}: {e}"
            return
        self.calib_cache.clear()
        self.engines.set(eid)

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
        if ref is None:
            raise ValueError(NO_REF)
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
        self.said = ""  # текст кусков, звук которых уже пошёл в окно, — с ним сравнивается эхо при перебивании словом

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
        self.cfg = {"vad": a.vad, "barge_vad": a.barge_vad, "barge_ms": a.barge_ms, "end_ms": a.end_ms,
                    "barge_mode": a.barge_mode}
        self.listener = Listener(self.cfg, self._vad, self._turn, max_silence_ms=a.max_silence_ms,
                                 turn_threshold=a.turn, min_speech_ms=a.min_speech_ms)
        self.buf = np.zeros(0, np.float32)
        self.aec: aec.EchoCanceller | None = None  # одно на подключение — с первого кадра с опорой
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
        self.last_said = ""  # последняя фраза модели — чтобы не принять её эхо за реплику
        self.last_said_id: int | None = None
        self.echo_until = 0.0  # до какого времени (perf_counter) из динамиков мог звучать голос модели
        # перебивание словом: кусок текущей речи распознаётся, пока штаб говорит
        self.seg = 0  # номер куска речи (растёт с каждым началом речи)
        self.word_task: asyncio.Task | None = None
        self.word_next = WORD_CHUNK_S  # с какой длины куска (с) распознать его снова
        self.word_barged = False  # текущий кусок уже остановил штаб стоп-словом
        self.word_err_seg = -1  # кусок, сбой распознавания которого уже записан в журнал (раз на кусок)
        # калибровка и запись голоса
        self.calib: dict | None = None  # шаг калибровки, который сейчас пишется
        self.calib_on = False  # калибровка идёт: от первого шага до finish/cancel (и между шагами)
        self.calib_data: dict[str, list[float]] = {}
        self.recording: list[np.ndarray] | None = None
        self.pending: dict | None = None  # проверенная запись: audio, path (файл — только до сохранения, для пробы)
        self.pending_path = Path(svc.args.data) / f"pending-{uuid.uuid4().hex[:8]}.wav"

    async def _vad(self, frame):
        return self.m.vad_prob(frame)

    async def _turn(self, audio):
        return await self.loop.run_in_executor(self.m.mlx, self.m.turn_complete, audio)

    async def send(self, **msg):
        await self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    @property
    def busy(self) -> bool:
        return bool(self.jobs)

    @property
    def speaking(self) -> bool:
        """Говорит штаб (не проба голоса: её не перебивают)."""
        return any(not j.preview for j in self.jobs.values())

    def chief_text(self) -> str:
        return " ".join(j.said for j in self.jobs.values() if not j.preview)

    # ------------------------------------------------------------ микрофон

    async def on_audio(self, data: bytes):
        """Кадр окна: с опорой и при включённом подавлении эха — микрофон без голоса штаба (и калибровка, и VAD, и
        распознавание слышат уже его); без опоры или с --aec off — микрофон как есть."""
        mic, ref = parse_mic(data)
        if ref is not None and self.svc.aec:
            if self.aec is None:
                self.aec = aec.EchoCanceller(SR_IN)
            mic = self.aec.process(mic, ref)
        self.buf = np.concatenate([self.buf, mic])
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
                self.seg += 1
                self.word_next, self.word_barged = WORD_CHUNK_S, False
                self.merge = self.prev is not None and should_merge(self.prev["end"], self.t_mic, self.reply_start)
                await self.send(type="speech", state="start")
            elif kind == "speech_end":
                self.seg += 1  # кусок кончился: его распознавание по ходу речи больше не перебивает
                await self.send(type="speech", state="end")
            elif kind == "barge":
                await self.barge_all()
            elif kind == "utterance":
                await self.on_utterance(ev[1])
        self.word_check()

    def word_check(self):
        """Перебивание словом: пока штаб говорит, кусок текущей речи (от WORD_CHUNK_S, по мере роста — каждые
        WORD_STEP_S) распознаётся в нити torch, не дожидаясь конца реплики, — его хвост не длиннее WORD_WINDOW_S;
        стоп-слово — штаб обрывается."""
        ls = self.listener
        if (self.cfg.get("barge_mode") != "word" or not ls.in_speech or self.word_barged or not self.speaking
                or (self.word_task and not self.word_task.done()) or ls.chunk_s() < self.word_next):
            return
        self.word_next = ls.chunk_s() + WORD_STEP_S
        self.word_task = asyncio.create_task(self._word_check(self.seg, ls.audio[-int(WORD_WINDOW_S * SR_IN):].copy()))

    async def _word_check(self, seg: int, audio: np.ndarray):
        try:
            text = (await self.loop.run_in_executor(self.m.torch, self.m.transcribe, audio)).strip()
        except Exception as e:  # noqa: BLE001 — кусок не распознался: штаб не обрывается, реплика распознается целиком
            if self.word_err_seg != seg:
                self.word_err_seg = seg
                print("кусок не распознан:", f"{type(e).__name__}: {e}", flush=True)
            return
        if seg != self.seg or self.word_barged or not self.speaking:
            return
        if is_stop_phrase(text, self.chief_text()):
            self.word_barged = True
            await self.barge_all()

    async def transcribe(self, audio: np.ndarray) -> str:
        """Распознавание любой длины: длиннее ASR_PIECE_S — кусками, разрез — в самом тихом месте второй
        половины куска (между словами)."""
        n, sr = ASR_PIECE_S * SR_IN, SR_IN
        parts = []
        while len(audio) > n:
            win = int(0.02 * sr)
            seg = audio[n // 2: n]
            k = len(seg) // win
            rms = np.sqrt(np.mean(seg[: k * win].reshape(k, win) ** 2, axis=1))
            cut = n // 2 + int(np.argmin(rms)) * win + win // 2
            parts.append(audio[:cut])
            audio = audio[cut:]
        parts.append(audio)
        texts = [(await self.loop.run_in_executor(self.m.torch, self.m.transcribe, p)).strip() for p in parts if len(p)]
        return " ".join(t for t in texts if t)

    async def on_utterance(self, audio: np.ndarray):
        end = self.t_mic - self.listener.silence_ms / 1000
        # эхо возможно, только если речь кончилась, пока модель говорила, или вскоре после конца её звука
        spoke_end = time.perf_counter() - self.listener.silence_ms / 1000
        echo_possible = self.busy or spoke_end <= self.echo_until + ECHO_AFTER_S
        merge = self.merge
        self.merge = False
        self.m.vad_reset()
        word = self.cfg.get("barge_mode") == "word"
        word_barged = self.word_barged
        if self.busy and not word:  # договорил, пока модель отвечала (или склейка) — ответ обрывается
            await self.barge_all()
        t0 = time.perf_counter()
        text = await self.transcribe(audio)
        stt_ms = round((time.perf_counter() - t0) * 1000)
        if not text:
            return
        # перебивание словом: штаб обрывает только стоп-слово (и успевшее по ходу речи — тоже); прочая речь, пока он
        # говорит, — не реплика: без подавления эха её не отличить от его же голоса из динамиков; штаб договаривает.
        # Окну она приходит отдельно (over) с тем, что штаб уже сказал: ответ на его вопрос окно примет само (и
        # остановит штаб), прочее отбросит; со следующей репликой она не склеивается
        if word and not word_barged and self.speaking:
            if not is_stop_phrase(text, self.chief_text()):
                self.utt_id += 1
                await self.send(type="over", id=self.utt_id, text=text, chief=self.chief_text())
                return
            word_barged = True
            await self.barge_all()
        if not word_barged and echo_possible and self.last_said and difflib.SequenceMatcher(
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
        """Фраза разговора. Во время калибровки и записи голоса не звучит (испортила бы замер или образец): say-done
        stopped без звука. Проба голоса и звук калибровки (id 0) идут не через say — они звучат."""
        jid, role, more = int(d["id"]), d.get("role", "chief"), bool(d.get("more"))
        job = self.jobs.get(jid)
        if job is None and (self.calib_on or self.recording is not None):
            await self.send(type="say-done", id=jid, stopped=True)
            return
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
        затухание конца куска, пауза по знаку — перед следующим куском (после последнего паузы нет)."""
        if prev is not None and not prev.done():
            await asyncio.wait([prev])  # фразы звучат по очереди; отмена этой не отменяет прежнюю
        sr = self.m.sample_rate
        fade_n = int(self.svc.args.tail_fade_ms / 1000 * sr)
        gap = 0.0  # пауза после прежнего куска — уходит перед звуком следующего
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
                if not job.preview:  # эхо сравнивается только с последней фразой
                    if self.last_said_id != job.id:
                        self.last_said_id, self.last_said = job.id, ""
                    self.last_said = (self.last_said + " " + piece)[-400:]
                hold = await self._synth(job, piece, fade_n, np.zeros(int(gap * sr), np.float32))
                if hold is None:  # ошибка синтеза — сообщена, фраза кончается
                    break
                await self.send_audio(job, fade_tail(hold, sr, self.svc.args.tail_fade_ms))
                gap = pause_after(piece)
            job.sent_all = True
            if self.jobs.get(job.id) is job:
                await self.send(type="say-done", id=job.id)
                if job.samples == 0:  # звука не было — играть нечего, played не придёт
                    self.jobs.pop(job.id, None)
        except asyncio.CancelledError:
            job.cancel.set()

    async def _synth(self, job: Job, text: str, fade_n: int, lead: np.ndarray) -> np.ndarray | None:
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
        hold = lead  # последние fade_n отсчётов: на конце куска их плавно гасим; вначале — пауза до куска
        err = None
        sent = False
        while (a := await q.get()) is not None:
            if isinstance(a, Exception):
                err = a
                continue
            a = np.concatenate([hold, a])
            n = max(0, len(a) - fade_n)
            a, hold = a[:n], a[n:]
            if len(a) and not sent and not job.preview:  # звук куска пошёл в окно — его слова могут вернуться эхом
                sent = True
                job.said = (job.said + " " + text).strip()
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
        if not job.preview:
            self.echo_until = max(self.echo_until, self.play_until)
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
        """Человек перебил: фразы штаба обрываются, окно гасит звук по barge {id}. Проба голоса не перебивается —
        её останавливают только stop, новая проба, отказ от записи и закрытие окна."""
        for job in [j for j in self.jobs.values() if not j.preview]:
            self._drop(job)
            await self.send(type="barge", id=job.id)
        if not self.jobs:
            self.play_until = 0.0
        self.echo_until = min(self.echo_until, time.perf_counter())

    async def stop(self, jid: int | None = None, only=None):
        """Остановить фразы (все, jid или подходящие под only): say-done stopped — и для фразы, звук которой уже
        весь отправлен: окно гасит её звук и played не шлёт."""
        for job in [j for j in self.jobs.values() if (jid is None or j.id == jid) and (only is None or only(j))]:
            self._drop(job)
            await self.send(type="say-done", id=job.id, stopped=True)
        if not self.jobs:
            self.play_until = 0.0
            self.echo_until = min(self.echo_until, time.perf_counter())

    def played(self, jid: int):
        job = self.jobs.get(jid)
        if job is not None and job.sent_all:  # окно доиграло фразу — модель больше не говорит
            self.jobs.pop(jid, None)

    # ------------------------------------------------------------ калибровка

    async def calib_start(self, step: str, sec: float):
        self.calib_on = True
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
        self.calib, self.calib_on = None, False
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
            self.calib, self.calib_on = None, False
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
            self.calib, self.calib_on = None, False
            self.listener.reset()
            self.m.vad_reset()
            self.recording = []
            await self.drop_pending()
            await self.send(type="voice_recording", text=RECORD_TEXT)
        elif op == "discard":  # отказ от записи: запись и проверенный образец стираются
            self.recording = None
            await self.drop_pending()
            self.listener.reset()
            self.m.vad_reset()
            await self.send(type="voice_discarded")
        elif op == "record-stop":
            if self.recording is None:
                raise ValueError("запись не идёт")
            audio = np.concatenate(self.recording) if self.recording else np.zeros(0, np.float32)
            self.recording = None
            self.listener.reset()
            self.m.vad_reset()
            await self.drop_pending()
            trimmed = trim_silence(audio, SR_IN)  # распознаётся речь без тишины по краям
            heard = await self.transcribe(trimmed) if len(trimmed) else ""
            r = check_recording(audio, SR_IN, RECORD_TEXT, heard)
            if r["ok"]:
                write_wav(self.pending_path, r["audio"], SR_IN)
                self.pending = {"audio": r["audio"], "path": self.pending_path}
            await self.send(type="voice_check", heard=heard, **{k: v for k, v in r.items() if k != "audio"})
        elif op == "preview":
            vid = d.get("voice_id")
            if vid:
                ref = store.ref(vid)
            elif self.pending:
                ref = (self.pending["path"], RECORD_TEXT)
            else:
                raise ValueError("нет записи для пробы — запишите голос")
            jid = d.get("id")
            if not isinstance(jid, int) or isinstance(jid, bool) or jid < 1:
                raise ValueError("проба голоса: нужен id фразы (от 1; 0 — звук калибровки)")
            job = Job(jid, ref, preview=True)
            if job.id in self.jobs:
                raise ValueError(f"фраза {job.id} уже звучит")
            self._start_job(job)
            job.push(str(d.get("text") or PREVIEW_TEXT), False)
        elif op == "save":
            if not self.pending:
                raise ValueError("нет записи, прошедшей проверку — запишите голос заново")
            vid = store.save(str(d.get("name", "")), self.pending["audio"], SR_IN, RECORD_TEXT, "микрофон")
            await self.drop_pending()
            await self.send(type="voice_saved", id=vid)
            await self.voice_list()
        elif op == "assign":
            store.assign(str(d.get("role")), str(d.get("voice_id")))
            await self.voice_list()
        elif op == "delete":
            vid = str(d.get("voice_id"))
            path = store.ref(vid)[0] if any(v["id"] == vid for v in store.list()) else None
            store.delete(vid)
            if path is not None:
                self.m.forget_ref(path)  # звук образца не остаётся и в памяти синтеза
            await self.voice_list()
        else:
            raise ValueError(f"нет такой операции с голосами: {op}")

    async def on_tts(self, d: dict):
        """Модель озвучки: `list` — список и выбранная; `set {id}` — загрузить другую (20–40 с, первый раз дольше);
        не загрузилась — остаётся прежняя, в `tts_list.error` причина."""
        svc = self.svc
        if d.get("op") == "list":
            await self.send(type="tts_list", **svc.tts_info())
            return
        if d.get("op") != "set":
            raise ValueError(f"нет такой операции с моделью озвучки: {d.get('op')}")
        eid = str(d.get("id"))
        from engines import engine

        engine(eid)  # неизвестная — ошибка сразу
        if svc.tts_state == "loading":
            raise ValueError("модель озвучки уже загружается — дождитесь")
        if eid == svc.models.engine.id:
            svc.tts_error = None
            await self.send(type="tts_list", **svc.tts_info())
            return
        await self.stop()  # звучащая фраза останавливается: пока грузится новая модель, штаб молчит
        svc.tts_state, svc.tts_error = "loading", None
        await self.send(type="tts_list", **svc.tts_info())
        try:
            await self.loop.run_in_executor(self.m.mlx, svc.switch_tts, eid)
        finally:
            svc.tts_state = "ready"
        await self.send(type="tts_list", **svc.tts_info())

    # ------------------------------------------------------------ сообщения окна

    async def on_text(self, d: dict):
        t = d.get("type")
        if t in ("hello", "settings"):
            src = d.get("settings") if t == "hello" else d
            for k in self.cfg:
                if k == "barge_mode":
                    if (src or {}).get(k) in BARGE_MODES:
                        self.cfg[k] = src[k]
                elif isinstance((src or {}).get(k), (int, float)) and not isinstance(src[k], bool):
                    self.cfg[k] = src[k]
            await self.send(type="settings", **self.cfg)
        elif t == "tts":
            await self.on_tts(d)
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

    async def drop_pending(self):
        """Проверенная запись больше не нужна: проба ею обрывается (её файла сейчас не станет), звук записи
        не остаётся ни на диске, ни в памяти синтеза."""
        await self.stop(only=lambda j: j.preview and j.ref is not None and j.ref[0] == self.pending_path)
        self.pending = None
        self.pending_path.unlink(missing_ok=True)
        self.m.forget_ref(self.pending_path)

    async def close(self):
        if self.word_task and not self.word_task.done():
            self.word_task.cancel()
        for job in list(self.jobs.values()):
            self._drop(job)
        self.recording = None
        self.pending = None
        self.pending_path.unlink(missing_ok=True)
        self.m.forget_ref(self.pending_path)


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
                             record_text=RECORD_TEXT, rate=svc.models.sample_rate, aec=svc.aec,
                             tts=svc.tts_info())
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
                except OSError as e:  # диск полон, нет прав — сессия продолжается
                    await s.send(type="error", text=f"не удалось записать или прочитать файл голоса "
                                                    f"(место на диске, права доступа): {e.strerror or e}")
                except (ValueError, KeyError, TypeError) as e:
                    await s.send(type="error", text=str(e) if not isinstance(e, KeyError) else f"нет поля или образца: {e}")
                except WebSocketDisconnect:
                    raise
                except Exception as e:  # noqa: BLE001 — любой другой сбой: сказать и продолжать сессию
                    print("сбой:", f"{type(e).__name__}: {e}", flush=True)
                    await s.send(type="error", text=f"сбой голоса: {e}" if str(e) else f"сбой голоса ({type(e).__name__})")
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
