"""Локальный профиль CUDA; отсутствие файла сохраняет прежний режим."""
from dataclasses import dataclass
import json
from pathlib import Path


@dataclass(frozen=True)
class TorchProfile:
    managed: bool = False
    quantization: str = "bf16"
    attention: str = "sdpa"

    def __post_init__(self):
        if type(self.managed) is not bool or self.quantization not in ("nf4", "int8", "bf16") or self.attention not in ("sdpa", "flash_attention_2"):
            raise ValueError("неверный профиль Torch: managed, quantization или attention")


def load_torch_profile(data: Path) -> TorchProfile:
    path = Path(data) / "torch-profile.json"
    if not path.exists():
        return TorchProfile()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or set(data) != {"managed", "quantization", "attention"}:
            raise ValueError("нужны managed, quantization и attention")
        return TorchProfile(**data)
    except (ValueError, TypeError) as e:
        raise ValueError(f"неверный профиль {path}: {e}") from e
