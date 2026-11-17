"""Выбор исполняющего стека. Смена ОС не подменяет сохранённую модель голоса."""
from __future__ import annotations

import json
import os
import sys

from engines import EngineStore

TORCH_ENGINE = "qwen3-ru-stress"


def select_backend(requested: str = "auto", platform: str | None = None) -> str:
    if requested not in ("auto", "mlx", "torch"):
        raise ValueError(f"неизвестный стек голоса: {requested}")
    return ("torch" if (platform or sys.platform) == "win32" else "mlx") if requested == "auto" else requested


def require_torch_engine(eid: str):
    if eid != TORCH_ENGINE:
        raise ValueError(f"стек Torch/CUDA поддерживает только {TORCH_ENGINE}; сохранена модель {eid}. "
                         "Выберите qwen3-ru-stress явно; автоматической замены модели нет")


def selected_engine(store: EngineStore, backend: str) -> str:
    if backend != "torch":
        if not store.file.exists() and os.environ.get("DEFOPS_VOICE_DEFAULT_ENGINE"):
            return os.environ["DEFOPS_VOICE_DEFAULT_ENGINE"]
        return store.get()
    if not store.file.exists():
        return TORCH_ENGINE
    try:
        eid = json.loads(store.file.read_text(encoding="utf-8"))["engine"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise ValueError(f"не читается выбор модели {store.file}: {e}") from e
    require_torch_engine(eid)
    return eid
