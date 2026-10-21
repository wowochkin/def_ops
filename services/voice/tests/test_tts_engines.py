"""Выбор модели озвучки: список, переключение, откат при ошибке загрузки, выбор переживает перезапуск."""
import json

import pytest
from fastapi.testclient import TestClient

from engines import DEFAULT_ENGINE, ENGINES, EngineStore
from server import build_app
from tests.test_server import connect, make_client, until  # noqa: F401 — фикстура


def tts(ws, **m):
    ws.send_text(json.dumps({"type": "tts", **m}))


def test_ready_carries_engine_list_with_default(make_client):
    ws, ready = connect(make_client())
    t = ready["tts"]
    assert t["current"] == DEFAULT_ENGINE == "qwen3-1.7b" and t["state"] == "ready"
    assert [e["id"] for e in t["engines"]] == [e.id for e in ENGINES]
    assert [e["id"] for e in t["engines"] if e["default"]] == [DEFAULT_ENGINE]
    assert all(e["title"] and e["note"] for e in t["engines"])


def test_switch_loads_and_persists(make_client, tmp_path):
    c = make_client()
    ws, _ = connect(c)
    tts(ws, op="set", id="qwen3-0.6b")
    assert until(ws, "tts_list")["state"] == "loading"
    done = until(ws, "tts_list")
    assert done["state"] == "ready" and done["current"] == "qwen3-0.6b" and "error" not in done
    assert c.app.state.service.models.switched == ["qwen3-0.6b"]
    assert EngineStore(tmp_path / "data").get() == "qwen3-0.6b"
    ws.close()
    again = TestClient(build_app(["--data", str(tmp_path / "data"), "--seed-refs", str(tmp_path / "seed"), "--fake"]))
    assert connect(again)[1]["tts"]["current"] == "qwen3-0.6b"  # новый запуск на тех же данных


def test_failed_load_keeps_previous_and_reports(make_client, tmp_path):
    c = make_client()
    c.app.state.service.models.fail_engines.add("omnivoice")
    ws, _ = connect(c)
    tts(ws, op="set", id="omnivoice")
    until(ws, "tts_list")
    done = until(ws, "tts_list")
    assert done["state"] == "ready" and done["current"] == DEFAULT_ENGINE and "omnivoice" in done["error"]
    assert EngineStore(tmp_path / "data").get() == DEFAULT_ENGINE


def test_unknown_engine_is_an_error(make_client):
    ws, _ = connect(make_client())
    tts(ws, op="set", id="нет-такой")
    assert "нет такой модели озвучки" in until(ws, "error")["text"]


def test_same_engine_is_a_no_op(make_client):
    c = make_client()
    ws, _ = connect(c)
    tts(ws, op="set", id=DEFAULT_ENGINE)
    assert until(ws, "tts_list")["state"] == "ready"
    assert c.app.state.service.models.switched == []


def test_store_ignores_garbage(tmp_path):
    s = EngineStore(tmp_path)
    assert s.get() == DEFAULT_ENGINE
    (tmp_path / "tts.json").write_text('{"engine": "что-то"}', encoding="utf-8")
    assert s.get() == DEFAULT_ENGINE
    with pytest.raises(ValueError):
        s.set("что-то")
