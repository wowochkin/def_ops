"""Qwen3-TTS ставит «конец» (EOS) на кадр-другой раньше, чем затих последний звук, — последний слог проглатывается.
Обёртка над выборкой первого кода: когда выпал EOS, ещё `frames` кадров (по 80 мс) он запрещается и берётся
следующий по вероятности код — модель договаривает затухание, потом останавливается как обычно."""


def extend_eos(tts, frames: int):
    """Включить на загруженной модели mlx-audio (Qwen3-TTS); frames=0 — как в библиотеке. Возвращает функцию,
    сбрасывающую счётчик перед каждым синтезом."""
    if getattr(tts, "_eos_orig", None) is None:
        tts._eos_orig = tts._sample_token
    orig = tts._eos_orig
    eos = tts.config.talker_config.codec_eos_token_id
    state = {"left": frames}

    def sample(logits, *a, suppress_tokens=None, **kw):
        tok = orig(logits, *a, suppress_tokens=suppress_tokens, **kw)
        # первый код кадра выбирается с suppress_tokens (у остальных кодов его нет)
        if suppress_tokens is not None and state["left"] > 0 and int(tok[0, 0]) == eos:
            state["left"] -= 1
            tok = orig(logits, *a, suppress_tokens=list(suppress_tokens) + [eos], **kw)
        return tok

    tts._sample_token = sample if frames > 0 else orig
    return lambda: state.update(left=frames)
