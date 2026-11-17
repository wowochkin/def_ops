#!/usr/bin/env python3
"""Подготовка весов Windows с интернетом; --check только проверяет локальные файлы.

python prepare_models.py --models-dir D:/DefOps/models/voice
python prepare_models.py --check --models-dir D:/DefOps/models/voice
Ничего не запускает, не меняет выбор/образцы голоса и не касается GAME.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from pathlib import Path

from windows_assets import (ASR_NAME, ASR_ORIGIN, TTS_FILES, TTS_REPO, TTS_REVISION,
                            TURN_FILE, TURN_REPO, TURN_REVISION, verify_manifest, write_manifest)

ASR_MD5 = "2730de7545ac43ad256485a462b0a27a"  # GigaAM._MODEL_HASHES, закреплённый commit в setup.ps1


def download_file(url: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=120) as response, tmp.open("wb") as output:
            shutil.copyfileobj(response, output)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def prepare(root: Path, gigaam_cache: Path | None = None):
    from huggingface_hub import hf_hub_download, snapshot_download

    root.mkdir(parents=True, exist_ok=True)
    print("Qwen3 ru-stress: исходный BF16 checkpoint и речевой токенизатор", flush=True)
    snapshot_download(TTS_REPO, revision=TTS_REVISION, local_dir=root / "qwen3-ru-stress",
                      allow_patterns=list(TTS_FILES))
    print("Smart Turn v3.0 ONNX", flush=True)
    hf_hub_download(TURN_REPO, TURN_FILE, revision=TURN_REVISION, local_dir=root / "smart-turn")
    print("GigaAM v3 e2e RNNT и токенизатор", flush=True)
    for name in (f"{ASR_NAME}.ckpt", f"{ASR_NAME}_tokenizer.model"):
        target = root / "gigaam" / name
        cached = gigaam_cache / name if gigaam_cache else None
        if cached and cached.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            if cached.resolve() != target.resolve():
                shutil.copy2(cached, target)
        else:
            download_file(f"{ASR_ORIGIN}/{name}", target)
    with (root / "gigaam" / f"{ASR_NAME}.ckpt").open("rb") as f:
        if hashlib.file_digest(f, "md5").hexdigest() != ASR_MD5:
            raise ValueError("контрольная сумма GigaAM не совпала с закреплённой версией")
    write_manifest(root)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, required=True)
    parser.add_argument("--gigaam-cache", type=Path, help="ранее загруженные веса GigaAM; checksum ckpt проверяется")
    parser.add_argument("--check", action="store_true", help="только файлы и SHA256, без сети и загрузки моделей")
    args = parser.parse_args(argv)
    try:
        root = args.models_dir.resolve()
        if not args.check:
            prepare(root, args.gigaam_cache)
        result = verify_manifest(root)
        print(json.dumps({"ok": True, "engine": result["engine"], "files": len(result["files"]),
                          "tts_revision": result["tts_revision"]}, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
