"""Полный CPU-образец Qwen для проверок контракта без загрузки весов."""
from types import SimpleNamespace
import torch


def sample_prompt(text):
    return [SimpleNamespace(ref_code=torch.zeros((2, 16), dtype=torch.int64),
        ref_spk_embedding=torch.ones(4, dtype=torch.bfloat16),
        ref_text=text, x_vector_only_mode=False, icl_mode=True)]
