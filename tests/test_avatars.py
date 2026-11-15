"""avatars.yaml: the avatars the page shows, and the body modules get."""

import pytest
from fastapi.testclient import TestClient

from huri_playground.avatars import (
    BODY_FIELDS,
    AvatarsConfig,
    InvalidBody,
    check_body,
    load_avatars_config,
)

from . import curated
from .test_gateway import make_client  # noqa: F401 - the fixture

# A body as the page measures it (the man, metres from the pelvis).
BODY = {
    "shoulder": [0.207, 0.525, -0.025],
    "upper_arm": 0.282,
    "forearm": 0.267,
    "hand": 0.178,
    "chin": [0.709, 0.134],
    "chest": [0.382, 0.134, 0.207],
    "waist": [0.173, 0.082, 0.165],
    "hip": [0.074, 0.15],
}


def test_the_shipped_avatars_yaml_loads():
    config = load_avatars_config()
    names = [a["name"] for a in config.public()]
    assert names[:2] == ["man", "mouse"]
    assert config.body_args == {"think": "body"}
    for avatar in config.public():
        assert avatar["model"].startswith("/static/")


def test_a_body_is_only_metres():
    assert check_body(BODY) == BODY
    assert set(BODY) == set(BODY_FIELDS)


@pytest.mark.parametrize(
    "change",
    [
        {"knee": 0.5},
        {"upper_arm": -0.2},
        {"upper_arm": "0.2"},
        {"upper_arm": True},
        {"chin": [0.7]},
        {"chest": [0.4, 0.1, float("inf")]},
        {"shoulder": [0.2, 40.0, 0.0]},
        {"hip": {"y": 0.1}},
    ],
)
def test_a_bad_body_is_refused(change):
    with pytest.raises(InvalidBody):
        check_body({**BODY, **change})


def test_a_body_must_be_whole_unless_it_overrides():
    partial = {"upper_arm": 0.3}
    with pytest.raises(InvalidBody):
        check_body(partial)
    assert check_body(partial, partial=True) == partial


def test_the_config_overrides_the_measurement():
    config = AvatarsConfig(
        avatars={"man": {"model": "m.fbx", "body": {"upper_arm": 0.3}}},
        body_args={"think": "body"},
    )
    args = config.module_args("man", BODY)
    assert args["think"]["body"] == {**BODY, "upper_arm": 0.3}
    # An avatar the config does not know, or none, gives no body.
    assert config.module_args("robot", BODY) == {}
    assert config.module_args(None, BODY) == {}
    # Not measured (the page could not): the overrides alone.
    assert config.module_args("man", None) == {"think": {"body": {"upper_arm": 0.3}}}


def test_a_camera_shot_must_be_known(tmp_path):
    path = tmp_path / "avatars.yaml"
    path.write_text(
        "avatars:\n  a:\n    model: /static/a.fbx\n    camera: { idle: feet }\n"
    )
    with pytest.raises(ValueError, match="camera"):
        load_avatars_config(path)


@pytest.fixture
def with_think(monkeypatch):
    monkeypatch.setitem(curated.CURATED, "think", ("huri.question", "huri.motion"))


def start_as(ws, modules, **fields):
    ws.send_json({"type": "start", "modules": modules, **fields})
    return ws.receive_json()


def test_think_gets_the_avatars_body(make_client, with_think):  # noqa: F811
    client, huri = make_client()
    with client.websocket_connect("/ws") as ws:
        ready = start_as(ws, ["rag", "think"], avatar="man", body=BODY)
    assert ready["type"] == "ready"
    modules = huri.handshake["modules"]
    assert modules["think"]["args"]["body"] == BODY
    assert "body" not in modules["rag"]["args"]


def test_without_an_avatar_think_keeps_its_default_body(
    make_client, with_think  # noqa: F811
):
    client, huri = make_client()
    with client.websocket_connect("/ws") as ws:
        assert start_as(ws, ["think"])["type"] == "ready"
    assert "body" not in huri.handshake["modules"]["think"]["args"]


def test_a_bad_body_refuses_the_session(make_client, with_think):  # noqa: F811
    client, huri = make_client()
    with client.websocket_connect("/ws") as ws:
        reply = start_as(ws, ["think"], avatar="man", body={**BODY, "hand": "big"})
    assert reply["type"] == "error"
    assert reply["reason"] == "invalid_pipeline"
    assert huri.sent == []


def test_the_page_gets_the_avatars(make_client):  # noqa: F811
    client, _ = make_client()
    config = TestClient(client.app).get("/api/config").json()
    man = next(a for a in config["avatars"] if a["name"] == "man")
    assert man["camera"]["idle"] in ("head", "chest", "waist", "knees", "full")
    assert "body_args" not in config
