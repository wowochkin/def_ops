"""Пакет Qwen и параметры запросов: без загрузки весов и без обещаний скорости CUDA."""
import asyncio
import ast
import json
import threading
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from models import Models
from models_torch import TorchModels
from tests.test_server import make_client, connect, until, audio_header
from tests.prompt_helpers import sample_prompt
from tests.test_windows_models import model_files


def torch_model(tmp_path, synth):
    m = TorchModels(models_dir=model_files(tmp_path))
    m.tts = synth
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"local")
    return m, (ref, "Текст образца")


def test_torch_batch_single_call_preserves_order_and_prompt(tmp_path):
    calls, prompts = [], []
    prompt = sample_prompt('Текст образца')
    def generate(**kw):
        calls.append(kw)
        return [np.full(i + 3, i + 1) for i in range(len(kw["text"]))], 24000
    synth = SimpleNamespace(create_voice_clone_prompt=lambda **kw: (prompts.append(kw) or prompt),
                            generate_voice_clone=generate)
    m, ref = torch_model(tmp_path, synth)
    texts = ["Раз.", "Два предложения. Ещё одно.", "Три.", "Четыре."]
    out = m.tts_batch(texts, ref, temperature=0.2)
    prepared = calls[0]['voice_clone_prompt']
    assert len(out) == 4 and [a[0] for a in out] == [1, 2, 3, 4]
    assert calls == [{"text": texts, "language": "Russian", "voice_clone_prompt": prepared,
                      "temperature": 0.2, "subtalker_temperature": 0.2,
                      "non_streaming_mode": True, "repetition_penalty": 1.5}]
    m.tts_batch(texts[:2], ref, temperature=0.7)
    assert len(prompts) == 1 and calls[1]["voice_clone_prompt"] is prepared
    assert calls[1]["temperature"] == 0.7 and m.engine.kwargs["temperature"] == 0.2


def test_torch_zero_turns_off_both_samplers_and_does_not_leak(tmp_path):
    calls = []
    def generate(**kw):
        calls.append(kw)
        return [np.ones(4) for _ in kw["text"]] if isinstance(kw["text"], list) else [np.ones(4)], 24000
    m, ref = torch_model(tmp_path, SimpleNamespace(create_voice_clone_prompt=lambda **kw: sample_prompt(kw['ref_text']),
                                                   generate_voice_clone=generate))
    m.tts_batch(["Раз.", "Два."], ref, temperature=0)
    list(m.tts_stream("Три.", ref, temperature=0.6))
    list(m.tts_stream("Четыре.", ref))
    assert calls[0]["do_sample"] is False and calls[0]["subtalker_dosample"] is False
    assert calls[1]["temperature"] == calls[1]["subtalker_temperature"] == 0.6
    assert calls[1].get("do_sample", True) is True
    assert calls[2]["temperature"] == 0.2


@pytest.mark.parametrize("temperature", [-0.1, 1.1, float("nan"), float("inf"), "0.2", True])
def test_torch_invalid_temperature_fails_before_model(tmp_path, temperature):
    m, ref = torch_model(tmp_path, object())
    with pytest.raises(ValueError, match="температур"):
        m.tts_batch(["Есть."], ref, temperature=temperature)


def test_base_batch_is_explicit_serial_fallback_without_legacy_keyword(tmp_path):
    m = Models()
    seen = []
    def stream(text, ref):
        seen.append(text)
        yield np.full(2, len(text), dtype=np.float32)
    m.tts_stream = stream
    result = m.tts_batch(["А.", "Больше."], None)
    assert seen == ["А.", "Больше."] and [a[0] for a in result] == [2, 7]


def test_real_qwen_011_wrapper_broadcasts_prepared_prompt(tmp_path):
    """Execute the pinned wrapper methods with tensor/model doubles, not a guessed generate signature."""
    source = Path('/tmp/defops-qwen-parity-deps/qwen_tts/inference/qwen3_tts_model.py')
    if not source.is_file():
        pytest.skip('Pinned qwen-tts0.1.1 source is not installed for the wrapper contract check')
    module = ast.parse(source.read_text())
    cls = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == 'Qwen3TTSModel')
    names = {'generate_voice_clone', '_prompt_items_to_voice_clone_prompt', '_merge_generate_kwargs'}
    methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for method in methods:
        method.decorator_list = []
    import torch
    namespace = {'np': np, 'torch': torch}
    wrapper_ast = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0),
                                   ast.ClassDef(name='PinnedWrapper', bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])
    exec(compile(ast.fix_missing_locations(wrapper_ast), str(source), 'exec'), namespace)
    wrapper = namespace['PinnedWrapper']()
    captured = []
    code = torch.zeros((2, 16), dtype=torch.int64)
    prompt_item = SimpleNamespace(ref_code=code, ref_spk_embedding=torch.ones(4), ref_text='Текст образца',
                                  x_vector_only_mode=False, icl_mode=True)
    def generate(**kw):
        captured.append(kw)
        return [torch.full((i + 3, 16), i, dtype=torch.int64) for i in range(4)], None
    wrapper.model = SimpleNamespace(tts_model_type='base', generate=generate,
                                    speech_tokenizer=SimpleNamespace(decode=lambda codes: ([np.arange(len(c['audio_codes']) * 10) for c in codes], 24000)))
    wrapper.generate_defaults = {}
    wrapper._ensure_list = lambda x: x if isinstance(x, list) else [x]
    wrapper._validate_languages = lambda langs: None
    wrapper._build_assistant_text = lambda t: 'assistant:' + t
    wrapper._build_ref_text = lambda t: 'reference:' + t
    wrapper._tokenize_texts = lambda texts: texts
    wrapper.create_voice_clone_prompt = lambda **kw: [prompt_item]
    m, ref = torch_model(tmp_path, wrapper)
    out = m.tts_batch(['Коротко.', 'Длинная фраза. Ещё предложение.', 'Три.', 'Четыре.'], ref, temperature=0)
    assert len(captured) == 1 and [len(a) for a in out] == [30, 40, 50, 60]
    call = captured[0]
    assert call['languages'] == ['Russian'] * 4 and call['ref_ids'] == ['reference:Текст образца'] * 4
    assert all(torch.equal(c, code) for c in call['voice_clone_prompt']['ref_code'])
    assert call['do_sample'] is False and call['subtalker_dosample'] is False
    assert call['non_streaming_mode'] is True and call['repetition_penalty'] == 1.5


def send_batch(ws, pid=1, texts=None, **kw):
    ws.send_json({'type': 'prepare-batch', 'id': pid, 'role': 'chief',
                  'texts': texts if texts is not None else [f'Фраза {i}.' for i in range(8)], **kw})


def batch_until_final(ws):
    progress = []
    while True:
        msg = until(ws, 'prepared-batch')
        progress.append(msg)
        if msg.get('error') or msg['done'] == msg['total']:
            return progress


def install_batch_model(client):
    m = client.app.state.service.models
    calls = []
    def batch(texts, ref, **kw):
        calls.append((texts, kw))
        return [np.full((int(text.split()[1].rstrip('.')) + 1) * 2400, 0.1, np.float32) for text in texts]
    m.tts_batch = batch
    return m, calls


def test_batch_chunks_real_progress_order_duplicates_temperature_and_say_reuse(make_client):
    c = make_client()
    m, calls = install_batch_model(c)
    ws, ready = connect(c)
    assert ready.get('capabilities') == {'prepare_batch': True, 'tts_temperature': True, 'tts_cpu_threads': True}
    send_batch(ws, temperature=0.2)
    progress = batch_until_final(ws)
    assert [(p['done'], p['total']) for p in progress] == [(4, 8), (8, 8)]
    assert [texts for texts, _ in calls] == [[f'Фраза {i}.' for i in range(4)], [f'Фраза {i}.' for i in range(4, 8)]]
    assert [kw for _, kw in calls] == [{'temperature': 0.2}] * 2
    assert progress[-1]['audio_s'] == pytest.approx([i / 10 for i in range(1, 9)], abs=0.02)
    # Hits and duplicate entries preserve their original durations, no new model call.
    send_batch(ws, pid=2, texts=['Фраза 7.', 'Фраза 1.', 'Фраза 7.'], temperature=0.2, batch_size=2)
    assert batch_until_final(ws)[-1]['audio_s'] == pytest.approx([0.8, 0.2, 0.8], abs=0.02)
    assert len(calls) == 2
    def forbidden(*args, **kw):
        raise AssertionError('prepared say must reuse cached PCM')
    m.tts_stream = forbidden
    ws.send_json({'type': 'say', 'id': 50, 'role': 'chief', 'text': 'Фраза 7.', 'temperature': 0.2})
    seen = []
    assert 'error' not in until(ws, 'say-done', seen)
    assert any(isinstance(x, bytes) for x in seen)
    send_batch(ws, pid=3, texts=['Фраза 1.', 'Фраза 1.'], temperature=0.6)
    assert batch_until_final(ws)[-1]['done'] == 2
    assert calls[-1] == (['Фраза 1.'], {'temperature': 0.6})
    ws.close()


@pytest.mark.parametrize('options', [{'temperature': -1}, {'temperature': 2}, {'temperature': float('nan')},
                                    {'temperature': '0.2'}, {'temperature': True}, {'batch_size': 3},
                                    {'batch_size': True}, {'texts': ['']}, {'texts': 'слово'}])
def test_batch_invalid_parameters_return_terminal_error(make_client, options):
    c = make_client()
    m, calls = install_batch_model(c)
    ws, _ = connect(c)
    send_batch(ws, **options)
    result = batch_until_final(ws)[-1]
    assert result['id'] == 1 and result.get('error') and calls == []
    ws.close()


def test_cancel_batch_discards_inflight_pcm_and_does_not_enqueue_next_chunk(make_client):
    c = make_client()
    m, calls = install_batch_model(c)
    original = m.tts_batch
    started, release = threading.Event(), threading.Event()
    def blocked(texts, ref, **kw):
        started.set()
        assert release.wait(5)
        return original(texts, ref, **kw)
    m.tts_batch = blocked
    ws, _ = connect(c)
    try:
        send_batch(ws, temperature=0.2)
        assert started.wait(3)
        ws.send_json({'type': 'cancel-prepare-batch', 'id': 1})
        assert batch_until_final(ws)[-1].get('error') == 'отменено'
        release.set()
        send_batch(ws, pid=2, texts=['Фраза 0.'], temperature=0.2)
        result = batch_until_final(ws)[-1]
        assert result['id'] == 2 and result['done'] == 1
        assert [len(texts) for texts, _ in calls] == [4, 1]
    finally:
        release.set()
        ws.close()


def test_batch_failure_is_terminal_without_later_chunks_or_ready(make_client):
    c = make_client()
    m, calls = install_batch_model(c)
    def fail(texts, ref, **kw):
        calls.append((texts, kw))
        raise RuntimeError('CUDA out of memory')
    m.tts_batch = fail
    ws, _ = connect(c)
    send_batch(ws)
    result = batch_until_final(ws)
    assert len(result) == 1 and result[0]['done'] == 0 and result[0]['total'] == 8
    assert 'CUDA out of memory' in result[0]['error'] and len(calls) == 1
    ws.close()


def test_legacy_prepare_and_say_temperature_cache_isolation(make_client):
    c = make_client()
    m = c.app.state.service.models
    original, calls = m.tts_stream, []
    def stream(text, ref, **kw):
        calls.append(kw)
        return original(text, ref, **kw)
    m.tts_stream = stream
    ws, _ = connect(c)
    for pid, temperature in [(1, 0), (2, 0.6)]:
        ws.send_json({'type': 'prepare', 'id': pid, 'role': 'chief', 'text': 'Есть.', 'temperature': temperature})
        assert 'error' not in until(ws, 'prepared')
    assert calls == [{'temperature': 0.0}, {'temperature': 0.6}]
    for pid, temperature in [(3, 0), (4, 0.6)]:
        ws.send_json({'type': 'say', 'id': pid, 'role': 'chief', 'text': 'Есть.', 'temperature': temperature})
        assert 'error' not in until(ws, 'say-done')
    assert len(calls) == 2
    ws.close()


def test_cancelling_single_prepare_watcher_does_not_cancel_its_shared_batch(make_client):
    from server import Session
    c = make_client()
    m, calls = install_batch_model(c)
    started, release = threading.Event(), threading.Event()
    original = m.tts_batch
    def blocked(texts, ref, **kw):
        started.set()
        assert release.wait(4)
        return original(texts, ref, **kw)
    m.tts_batch = blocked
    async def scenario():
        messages = []
        async def send(text):
            messages.append(json.loads(text))
        session = Session(SimpleNamespace(send_text=send), c.app.state.service)
        try:
            await session.on_prepare_batch({'id': 1, 'texts': ['Фраза 0.'], 'temperature': 0.2})
            task = session.batch_requests[1]['task']
            assert await asyncio.to_thread(started.wait, 2)
            await session.on_prepare({'id': 9, 'text': 'Фраза 0.', 'temperature': 0.2})
            session.cancel_prepare(9)
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            await asyncio.sleep(0)
            assert any(p['type'] == 'prepared-batch' and p.get('audio_s') == [0.1] for p in messages)
            assert any(p['type'] == 'prepared' and p['id'] == 9 and p.get('error') == 'отменено' for p in messages)
        finally:
            release.set()
            await session.close()
    asyncio.run(scenario())


def test_disconnect_discards_running_batch_and_all_later_chunks(make_client):
    from server import Session
    c = make_client()
    m, calls = install_batch_model(c)
    started, release = threading.Event(), threading.Event()
    original = m.tts_batch
    def blocked(texts, ref, **kw):
        started.set()
        assert release.wait(4)
        return original(texts, ref, **kw)
    m.tts_batch = blocked
    async def scenario():
        messages = []
        async def send(text):
            messages.append(json.loads(text))
        session = Session(SimpleNamespace(send_text=send), c.app.state.service)
        await session.on_prepare_batch({'id': 1, 'texts': [f'Фраза {i}.' for i in range(8)]})
        task = session.batch_requests[1]['task']
        try:
            assert await asyncio.to_thread(started.wait, 2)
            await session.close()
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            await asyncio.get_running_loop().run_in_executor(m.mlx, lambda: None)
            assert len(calls) == 1 and messages == [] and session.renders == {}
        finally:
            release.set()
    asyncio.run(scenario())


def test_sessions_serialize_on_one_executor_without_temperature_leak(make_client):
    c = make_client()
    m, calls = install_batch_model(c)
    ws1, _ = connect(c)
    ws2, _ = connect(c)
    send_batch(ws1, texts=['Фраза 0.'], temperature=0)
    send_batch(ws2, texts=['Фраза 0.'], temperature=0.8)
    assert batch_until_final(ws1)[-1]['done'] == batch_until_final(ws2)[-1]['done'] == 1
    assert sorted(kw['temperature'] for _, kw in calls) == [0, 0.8]
    ws1.close()
    ws2.close()


def test_torch_diagnostics_count_actual_batch_text_characters(tmp_path, capsys):
    states = []
    def generate(**kw):
        states.append(dict(m.synthesis_state))
        count = len(kw['text']) if isinstance(kw['text'], list) else 1
        return [np.ones(3) for _ in range(count)], 24000
    m, ref = torch_model(tmp_path, SimpleNamespace(create_voice_clone_prompt=lambda **kw: sample_prompt(kw['ref_text']),
                                                   generate_voice_clone=generate))
    m.tts_batch(['Один.', 'Два.'], ref)
    list(m.tts_stream('Три.', ref))
    assert [(s['chars'], s.get('batch_size')) for s in states] == [(9, 2), (4, 1)]
    logs = capsys.readouterr().out
    assert '[tts-start] chars=9 batch_size=2' in logs and '[tts-start] chars=4 batch_size=1' in logs


@pytest.mark.parametrize('interruption', ['cancel', 'model-error'])
@pytest.mark.parametrize('consumer', ['batch', 'ready-prepare'])
def test_partial_batch_interruption_preserves_shared_ready_pcm(make_client, interruption, consumer):
    """A completed chunk remains playable when its original batch's later chunk is cancelled/fails."""
    from server import Session
    c = make_client()
    m, calls = install_batch_model(c)
    original = m.tts_batch
    second_started, release = threading.Event(), threading.Event()
    attempts, resynth = [], []
    def batch(texts, ref, **kw):
        attempts.append(list(texts))
        if len(attempts) == 2:
            second_started.set()
            assert release.wait(4)
            if interruption == 'model-error':
                raise RuntimeError('CUDA out of memory')
        return original(texts, ref, **kw)
    def forbidden_stream(*args, **kw):
        resynth.append(args[0])
        raise AssertionError('a ready consumer must keep its cached PCM')
    m.tts_batch, m.tts_stream = batch, forbidden_stream
    async def scenario():
        messages, audio = [], []
        async def send(text):
            messages.append(json.loads(text))
        async def send_bytes(pcm):
            audio.append(pcm)
        session = Session(SimpleNamespace(send_text=send, send_bytes=send_bytes), c.app.state.service)
        try:
            await session.on_prepare_batch({'id': 1, 'texts': [f'Фраза {i}.' for i in range(8)], 'temperature': 0.2})
            task_a = session.batch_requests[1]['task']
            assert await asyncio.to_thread(second_started.wait, 2)
            if consumer == 'batch':
                await session.on_prepare_batch({'id': 2, 'texts': [f'Фраза {i}.' for i in range(4)], 'temperature': 0.2})
                task_b = session.batch_requests[2]['task']
            else:
                await session.on_prepare({'id': 2, 'text': 'Фраза 0.', 'temperature': 0.2})
                await asyncio.sleep(0)
                assert any(p['type'] == 'prepared' and p['id'] == 2 and p.get('audio_s') == 0.1 for p in messages)
            if interruption == 'cancel':
                session.cancel_prepare_batch(1)
            release.set()
            await asyncio.gather(task_a, return_exceptions=True)
            if consumer == 'batch':
                await task_b
                assert any(p['type'] == 'prepared-batch' and p['id'] == 2 and p.get('audio_s') == [0.1, 0.2, 0.3, 0.4] for p in messages)
            if interruption == 'model-error':
                assert any(p['type'] == 'prepared-batch' and p['id'] == 1 and 'CUDA out of memory' in p.get('error', '') for p in messages)
            await session.on_say({'id': 50, 'text': 'Фраза 0.', 'temperature': 0.2})
            await session.jobs[50].task
            assert resynth == [], 'successful preparation must remain in the playback cache'
            assert audio and any(p['type'] == 'say-done' and p['id'] == 50 for p in messages)
            assert len(attempts) == 2
        finally:
            release.set()
            await session.close()
    asyncio.run(scenario())


@pytest.mark.parametrize('interruption', ['cancel', 'model-error'])
def test_repeated_partial_batch_interruptions_keep_idle_pcm_cache_bounded(make_client, interruption):
    from server import PREPARED_MAX, Session
    c = make_client()
    m = c.app.state.service.models
    control = {}
    attempts = []
    def batch(texts, ref, **kw):
        attempts.append(list(texts))
        if len(attempts) % 2 == 0:
            control['started'].set()
            assert control['release'].wait(4)
            if interruption == 'model-error':
                raise RuntimeError('CUDA out of memory')
        return [np.ones(32, np.float32) for _ in texts]
    m.tts_batch = batch
    async def scenario():
        async def send(text):
            pass
        session = Session(SimpleNamespace(send_text=send), c.app.state.service)
        try:
            for index in range(10):
                control.update(started=threading.Event(), release=threading.Event())
                await session.on_prepare_batch({'id': index, 'texts': [f'Набор {index}, фраза {i}.' for i in range(8)]})
                task = session.batch_requests[index]['task']
                assert await asyncio.to_thread(control['started'].wait, 2)
                if interruption == 'cancel':
                    session.cancel_prepare_batch(index)
                control['release'].set()
                await asyncio.gather(task, return_exceptions=True)
                await asyncio.get_running_loop().run_in_executor(m.mlx, lambda: None)
                assert len(session.renders) <= PREPARED_MAX, 'idle completed PCM must retain the cache bound after interruption'
            assert len(attempts) == 20
        finally:
            control['release'].set()
            await session.close()
    asyncio.run(scenario())


@pytest.mark.parametrize('interruption', ['cancel', 'model-error'])
def test_partial_batch_eviction_protects_queued_shared_pcm(make_client, monkeypatch, interruption):
    import server
    monkeypatch.setattr(server, 'PREPARED_MAX', 2)
    c = make_client()
    m, calls = install_batch_model(c)
    original = m.tts_batch
    started, release = threading.Event(), threading.Event()
    attempts, resynth = [], []
    def batch(texts, ref, **kw):
        attempts.append(list(texts))
        if len(attempts) == 2:
            started.set()
            assert release.wait(4)
            if interruption == 'model-error':
                raise RuntimeError('CUDA out of memory')
        return original(texts, ref, **kw)
    def forbidden_stream(*args, **kw):
        resynth.append(args[0])
        raise AssertionError('eviction removed a queued consumer\'s PCM')
    m.tts_batch, m.tts_stream = batch, forbidden_stream
    async def scenario():
        messages, audio = [], []
        async def send(text):
            messages.append(json.loads(text))
        async def send_bytes(pcm):
            audio.append(pcm)
        session = server.Session(SimpleNamespace(send_text=send, send_bytes=send_bytes), c.app.state.service)
        try:
            await session.on_prepare_batch({'id': 1, 'texts': [f'Фраза {i}.' for i in range(8)], 'temperature': 0.2})
            task_a = session.batch_requests[1]['task']
            assert await asyncio.to_thread(started.wait, 2)
            await session.on_prepare_batch({'id': 2, 'texts': ['Фраза 0.', 'Фраза 1.'], 'temperature': 0.2})
            task_b = session.batch_requests[2]['task']
            # Touch the other completed entries after the queued consumer, so its shared
            # PCM is oldest. Eviction must use active references as well as recency.
            await session.on_prepare({'id': 3, 'text': 'Фраза 2.', 'temperature': 0.2})
            await session.on_prepare({'id': 4, 'text': 'Фраза 3.', 'temperature': 0.2})
            await asyncio.sleep(0)
            if interruption == 'cancel':
                session.cancel_prepare_batch(1)
            release.set()
            await asyncio.gather(task_a, return_exceptions=True)
            await task_b
            assert len(session.renders) == 2
            assert any(p['type'] == 'prepared-batch' and p['id'] == 2 and p.get('audio_s') == [0.1, 0.2] for p in messages)
            for index in range(2):
                await session.on_say({'id': 50 + index, 'text': f'Фраза {index}.', 'temperature': 0.2})
                await session.jobs[50 + index].task
            assert resynth == [] and len(audio) == 2
        finally:
            release.set()
            await session.close()
    asyncio.run(scenario())


def test_pcm_cache_returns_to_bound_after_single_prepare_watchers_finish(make_client, monkeypatch):
    import server
    monkeypatch.setattr(server, 'PREPARED_MAX', 2)
    c = make_client()
    m, calls = install_batch_model(c)
    async def scenario():
        messages = []
        async def send(text):
            messages.append(json.loads(text))
        session = server.Session(SimpleNamespace(send_text=send), c.app.state.service)
        try:
            await session.on_prepare_batch({'id': 1, 'texts': [f'Фраза {i}.' for i in range(4)]})
            task = session.batch_requests[1]['task']
            for index in range(4):
                await session.on_prepare({'id': 10 + index, 'text': f'Фраза {index}.'})
            await task
            await asyncio.sleep(0)
            assert sum(p['type'] == 'prepared' and 'error' not in p for p in messages) == 4
            assert len(session.renders) <= 2, 'released watchers must no longer prevent eviction'
        finally:
            await session.close()
    asyncio.run(scenario())


@pytest.mark.parametrize("threads", [1, 2, 4, 8])
def test_torch_cpu_threads_apply_before_prompt_and_generate(tmp_path, monkeypatch, threads):
    import torch
    seen = []
    state = {"threads": 2}
    def set_threads(n): state["threads"] = n
    monkeypatch.setattr(torch, 'set_num_threads', set_threads)
    monkeypatch.setattr(torch, 'get_num_threads', lambda: state['threads'])
    def generate(**kw):
        seen.append(state["threads"])
        return [np.ones(4)], 24000
    m, ref = torch_model(tmp_path, SimpleNamespace(
        create_voice_clone_prompt=lambda **kw: (seen.append(state["threads"]) or sample_prompt(kw['ref_text'])), generate_voice_clone=generate))
    m.tts_batch(["Приказ принят."], ref, cpu_threads=threads)
    list(m.tts_stream("Разбор готов.", ref, cpu_threads=1))
    list(m.tts_stream("Продолжаем.", ref))
    assert seen == [threads, threads, 1, 2]
    assert m.runtime_info()["cpu_threads"] == 2


@pytest.mark.parametrize("threads", [0, 3, 16, 1.5, "2", True])
def test_torch_invalid_cpu_threads_fail_before_model(tmp_path, threads):
    m, ref = torch_model(tmp_path, object())
    with pytest.raises(ValueError, match="поток"):
        m.tts_batch(["Приказ принят."], ref, cpu_threads=threads)


def test_server_threads_reach_single_and_batch_synthesis(make_client):
    c = make_client()
    m = c.app.state.service.models
    calls = []
    original = m.tts_stream
    def stream(text, ref, **kw):
        calls.append(kw.copy())
        yield from original(text, ref, **kw)
    m.tts_stream = stream
    ws, ready = connect(c)
    assert ready["capabilities"]["tts_cpu_threads"] is True
    ws.send_json({"type":"prepare", "id":101, "role":"chief", "text":"Один.", "cpu_threads":1})
    assert 'error' not in until(ws, "prepared")
    send_batch(ws, pid=102, texts=["Два.","Три."], cpu_threads=4)
    assert 'error' not in batch_until_final(ws)[-1]
    assert [x["cpu_threads"] for x in calls] == [1,4,4]
    ws.close()
