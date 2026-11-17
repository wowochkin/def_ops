"""Закреплённый комплект весов Windows. Проверки ничего не скачивают и не запускают модели."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

TTS_REPO = "siriusfreak/qwen3-tts-12hz-1.7b-ru-stress-cf"
TTS_REVISION = "c16b3af3db3095120efc1ebb73f6522442bcb3b1"
TURN_REPO = "pipecat-ai/smart-turn-v3"
TURN_REVISION = "f766f81d3cfdf7737ac64aad813d91bbfd56bf93"
TURN_FILE = "smart-turn-v3.0.onnx"
ASR_NAME = "v3_e2e_rnnt"
ASR_ORIGIN = "https://cdn.chatwm.opensmodel.sberdevices.ru/GigaAM"
TTS_FILES = ("config.json", "generation_config.json", "merges.txt", "model.safetensors",
             "preprocessor_config.json", "tokenizer_config.json", "vocab.json",
             "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
             "speech_tokenizer/model.safetensors", "speech_tokenizer/preprocessor_config.json")
REQUIRED_FILES = tuple(f"qwen3-ru-stress/{f}" for f in TTS_FILES) + (
    f"smart-turn/{TURN_FILE}", f"gigaam/{ASR_NAME}.ckpt", f"gigaam/{ASR_NAME}_tokenizer.model")


def validate_files(root: Path):
    missing = [f for f in REQUIRED_FILES if not (root / f).is_file() or (root / f).stat().st_size == 0]
    if missing:
        raise FileNotFoundError("неполный локальный комплект голоса: " + ", ".join(missing) +
                                "; заранее выполните prepare_models.py --models-dir <папка> на машине с интернетом")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_manifest(root: Path):
    validate_files(root)
    value = {"version": 1, "engine": "qwen3-ru-stress", "tts_repo": TTS_REPO, "tts_revision": TTS_REVISION,
             "turn_repo": TURN_REPO, "turn_revision": TURN_REVISION, "turn_file": TURN_FILE,
             "asr": ASR_NAME, "files": {f: {"bytes": (root / f).stat().st_size, "sha256": sha256(root / f)}
                                        for f in REQUIRED_FILES}}
    tmp = root / "manifest.json.tmp"
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(root / "manifest.json")


def verify_manifest(root: Path) -> dict:
    validate_files(root)
    value = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if (value.get("engine"), value.get("tts_repo"), value.get("tts_revision"), value.get("turn_revision")) != (
            "qwen3-ru-stress", TTS_REPO, TTS_REVISION, TURN_REVISION):
        raise ValueError("манифест относится к другому комплекту весов голоса")
    for f in REQUIRED_FILES:
        actual = {"bytes": (root / f).stat().st_size, "sha256": sha256(root / f)}
        if value.get("files", {}).get(f) != actual:
            raise ValueError(f"файл весов не совпадает с манифестом: {f}")
    return value
