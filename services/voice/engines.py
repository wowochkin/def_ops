"""Модели озвучки, которые можно выбрать в разделе «ИИ». Параметры вызова — как на стенде
(scripts/voice-bench/engines.json). Выбор хранится в папке данных голоса (tts.json); нет записи — Qwen3-TTS 1.7B."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_ENGINE = "qwen3-1.7b"


@dataclass(frozen=True)
class Engine:
    id: str
    title: str
    note: str  # для человека: что даёт и чего стоит
    repos: tuple[str, ...]  # первый доступный вариант весов
    ref_text: bool = True  # образцу нужна расшифровка
    stream: bool = True  # звук отдаётся кусками по ходу синтеза
    eos_patch: bool = False  # договаривание конца фразы (tts_tail): только у Qwen3-TTS
    kwargs: dict = field(default_factory=dict)
    license: str = ""
    commercial: bool = True


_QWEN = {"lang_code": "russian", "streaming_interval": 0.32}

ENGINES: tuple[Engine, ...] = (
    Engine("qwen3-1.7b", "Qwen3-TTS 1.7B", "по умолчанию: стабильный; занимает около 4 ГБ памяти; ударения иногда ошибочны",
           ("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"),
           eos_patch=True, kwargs=_QWEN, license="Apache-2.0"),
    Engine("qwen3-0.6b", "Qwen3-TTS 0.6B", "быстрее и легче (около 1,5 ГБ), голос беднее; чаще ошибается в ударениях",
           ("mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16", "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"),
           eos_patch=True, kwargs=_QWEN, license="Apache-2.0"),
    Engine("omnivoice", "OmniVoice", "звук отдаётся целой фразой после синтеза, начало фразы позже",
           ("mlx-community/OmniVoice-bf16", "mlx-community/OmniVoice-bfloat16"), stream=False,
           kwargs={"language": "ru"}, license="см. карточку k2-fsa/OmniVoice"),
    Engine("voxcpm2", "VoxCPM2", "звук отдаётся целой фразой после синтеза, начало фразы позже",
           ("mlx-community/VoxCPM2-bf16", "mlx-community/VoxCPM2-8bit"), stream=False, license="Apache-2.0"),
    Engine("fish-s2-pro", "Fish S2 Pro", "звучит лучше всех, но тяжёлая: речь идёт с подтормаживаниями; только для некоммерческого использования",
           ("mlx-community/fish-audio-s2-pro",), kwargs={"streaming_interval": 0.5},
           license="Fish Audio Research (некоммерческая)", commercial=False),
)
BY_ID = {e.id: e for e in ENGINES}


def engine(eid: str) -> Engine:
    try:
        return BY_ID[eid]
    except KeyError:
        raise ValueError(f"нет такой модели озвучки: {eid}") from None


def describe() -> list[dict]:
    return [{"id": e.id, "title": e.title, "note": e.note, "license": e.license, "commercial": e.commercial,
             "default": e.id == DEFAULT_ENGINE} for e in ENGINES]


class EngineStore:
    def __init__(self, root: Path):
        self.file = Path(root) / "tts.json"

    def get(self) -> str:
        try:
            eid = json.loads(self.file.read_text(encoding="utf-8")).get("engine")
        except (OSError, ValueError, AttributeError):
            return DEFAULT_ENGINE
        return eid if isinstance(eid, str) and eid in BY_ID else DEFAULT_ENGINE

    def set(self, eid: str):
        engine(eid)
        self.file.write_text(json.dumps({"engine": eid}, ensure_ascii=False), encoding="utf-8")
