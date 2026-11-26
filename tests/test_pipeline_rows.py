import itertools
import json
from pathlib import Path

import pytest
from huri_core.core.dataclasses.config import ClientConfig
from huri_core.core.policy import InterruptPolicy

from huri_playground.pipeline import InvalidPipeline, load_catalog_config

from .curated import CURATED, details
from .test_check_modules_yaml import check, write

BUNDLE_YAML = (
    "inbound: {}\nselected: [bundle]\n"
    "rows:\n  bundle: {members: [rag, tts]}\n"
    "modules:\n  rag: {}\n  tts: {}\n"
)
THINKING = ["think", "think_say", "think_token", "think_stop"]
TYPED_VOICE = ["rag", "tts"]


def registry_of(tmp_path, names):
    entries = "".join(f'\n[[module]]\nname = "{n}"\npackage = "p"\n' for n in names)
    return write(tmp_path, "registry.toml", "schema = 2\n" + entries)


def catalog_of(names=None, served=None):
    found = details(names) if served is None else served
    return load_catalog_config().catalog(found, None, "0.5.0")


def row_names(catalog):
    return [row["name"] for row in catalog.public()["modules"]]


def row_named(catalog, name):
    return next(row for row in catalog.public()["modules"] if row["name"] == name)


def test_selected_may_name_a_row(tmp_path):
    registry = registry_of(tmp_path, ["rag", "tts"])
    config = write(tmp_path, "modules.yaml", BUNDLE_YAML)
    assert check.main([str(registry), str(config)]) == 0


def test_selected_naming_neither_a_row_nor_a_module_fails(tmp_path, capsys):
    registry = registry_of(tmp_path, ["rag", "tts"])
    config = write(
        tmp_path, "modules.yaml", BUNDLE_YAML.replace("[bundle]", "[bundle, nope]")
    )
    assert check.main([str(registry), str(config)]) == 1
    assert "selected[1] = 'nope'" in capsys.readouterr().err


def test_thinking_is_one_row_that_runs_its_four_modules():
    catalog = catalog_of()
    thinking = row_named(catalog, "thinking")
    assert (thinking["label"], thinking["group"]) == ("Thinking", "speak")
    assert not set(THINKING) & set(row_names(catalog))
    pipeline = catalog.build([*TYPED_VOICE, "thinking"])
    assert set(pipeline.modules) == {*TYPED_VOICE, *THINKING}
    assert set(catalog.build(TYPED_VOICE).modules) == set(TYPED_VOICE)


@pytest.mark.parametrize(
    "served, runs",
    [
        (["think", "think_stop"], ["think", "think_stop"]),
        (["think_say", "think_stop"], ["think_say", "think_stop"]),
        (["think_say", "think_token", "think_stop"], THINKING[1:]),
        (
            ["think", "think_token", "think_stop"],
            ["think", "think_token", "think_stop"],
        ),
    ],
)
def test_thinking_runs_the_part_of_the_package_huri_has(served, runs):
    pipeline = catalog_of([*TYPED_VOICE, *served]).build([*TYPED_VOICE, "thinking"])
    assert set(pipeline.modules) == {*TYPED_VOICE, *runs}


@pytest.mark.parametrize(
    "served",
    [["think_stop"], ["think_token", "think_stop"], THINKING[:3]],
    ids=["stop-only", "nothing-produced", "no-stop"],
)
def test_thinking_is_not_offered_without_stop_or_without_an_output(served):
    catalog = catalog_of([*TYPED_VOICE, *served])
    assert "thinking" not in row_names(catalog)
    assert not set(served) & set(row_names(catalog))


def test_lip_sync_is_offered_by_its_name_and_never_as_its_engines():
    catalog = catalog_of()
    lips = row_named(catalog, "lips")
    assert (lips["label"], lips["group"]) == ("Lip sync", "speak")
    assert "tts_phonemes" not in row_names(catalog)
    assert "other" not in [group["id"] for group in catalog.public()["groups"]]


def test_the_speak_group_lists_its_rows_in_the_designed_order():
    rows = catalog_of().public()["modules"]
    speak = [row["label"] for row in rows if row["group"] == "speak"]
    assert speak == ["Voice", "Lip sync", "Gestures", "Thinking", "HuRI's emotion"]


def test_a_row_lists_the_topics_of_its_members_once():
    thinking = row_named(catalog_of(), "thinking")
    assert thinking["inputs"] == ["huri.question", "huri.token", "huri.audio.out"]
    assert thinking["outputs"] == ["huri.motion", "huri.audio.out"]
    assert row_named(catalog_of(), "rag")["outputs"] == ["huri.token"]


def test_lip_sync_swaps_the_voice_for_the_phoneme_tts():
    catalog = catalog_of()
    assert set(catalog.build([*TYPED_VOICE, "lips"]).modules) == {
        "rag",
        "tts_phonemes",
        "lips",
    }
    assert set(catalog.build(TYPED_VOICE).modules) == set(TYPED_VOICE)


def test_the_swap_is_dropped_when_the_phoneme_tts_has_other_topics():
    served = {**details(), "tts_phonemes": {"input": "huri.token", "output": "x.y"}}
    catalog = catalog_of(served=served)
    pipeline = catalog.build([*TYPED_VOICE, "lips"])
    assert set(pipeline.modules) == {*TYPED_VOICE, "lips"}
    assert "tts_phonemes" not in row_names(catalog)


def test_lip_sync_without_the_phoneme_tts_runs_on_the_voice():
    catalog = catalog_of([*TYPED_VOICE, "lips"])
    pipeline = catalog.build([*TYPED_VOICE, "lips"])
    assert set(pipeline.modules) == {*TYPED_VOICE, "lips"}
    assert pipeline.outbound == ["huri.token", "huri.audio.out", "huri.lips.face"]


def test_no_lip_sync_row_without_lips():
    assert "lips" not in row_names(catalog_of(set(CURATED) - {"lips"}))


@pytest.mark.parametrize(
    "rows, message",
    [
        (["rag", "lips"], "lips needs 'huri.audio.out'"),
        (["rag", "thinking"], "thinking needs 'huri.audio.out'"),
        (["rag", "lips", "thinking"], "thinking needs 'huri.audio.out'"),
    ],
    ids=["lips-unvoiced", "thinking-hears-only-itself", "lips-fed-by-unfed-thinking"],
)
def test_a_row_needs_another_row_to_feed_it(rows, message):
    with pytest.raises(InvalidPipeline, match=message):
        catalog_of().build(rows)


def test_huri_emotion_is_one_row_that_runs_both_modules():
    catalog = catalog_of()
    emotion = row_named(catalog, "huri_emotion")
    assert (emotion["label"], emotion["group"]) == ("HuRI's emotion", "speak")
    pipeline = catalog.build(["rag", "huri_emotion"])
    assert set(pipeline.modules) == {"rag", "emo_react", "emo_out"}
    assert "huri.emotion.out" in pipeline.outbound


@pytest.mark.parametrize("served", ["emo_react", "emo_out"])
def test_huri_emotion_runs_the_one_module_huri_has(served):
    pipeline = catalog_of(["rag", served]).build(["rag", "huri_emotion"])
    assert set(pipeline.modules) == {"rag", served}
    assert pipeline.outbound == ["huri.token", "huri.emotion.out"]


def test_no_huri_emotion_row_without_its_modules():
    catalog = catalog_of(set(CURATED) - {"emo_react", "emo_out"})
    assert "huri_emotion" not in row_names(catalog)


@pytest.mark.parametrize(
    "served, crafted",
    [
        (None, ["rag", "think_say"]),
        (None, ["rag", "tts_phonemes"]),
        (set(CURATED) - {"lips"}, [*TYPED_VOICE, "lips"]),
        (set(CURATED) - set(THINKING), [*TYPED_VOICE, "thinking"]),
    ],
    ids=["member", "swap-target", "absent-module", "absent-row"],
)
def test_a_crafted_start_naming_no_row_is_refused(served, crafted):
    with pytest.raises(InvalidPipeline, match="unknown module"):
        catalog_of(served).build(crafted)


def test_extra_args_reach_their_module_after_one_with_with_args():
    rows = ["vad", "stt", "tag", "qag", "rag", "tts", "thinking"]
    body = {"upper_arm": 0.3}
    pipeline = catalog_of().build(rows, None, {"think": {"body": body}})
    assert pipeline.modules["think"]["args"]["body"] == body


def all_selections(catalog):
    names = list(catalog.rows)
    for size in range(1, len(names) + 1):
        yield from itertools.combinations(names, size)


def valid_pipelines(catalog):
    for selection in all_selections(catalog):
        try:
            yield catalog.build(list(selection))
        except InvalidPipeline:
            continue


def session_topics(handshake):
    topics = {*handshake["send"], *handshake["subscribe"]}
    for name in handshake["modules"]:
        topics.update(t for t in CURATED[name] if t is not None)
    return topics


def yaml_swaps():
    entries = load_catalog_config().entries.values()
    return [(old, new) for e in entries for old, new in (e.get("swaps") or {}).items()]


@pytest.mark.parametrize(
    "served", [set(CURATED), set(CURATED) - {"tts"}], ids=["both-engines", "no-tts"]
)
def test_no_selection_runs_a_module_and_the_one_swapped_in_for_it(served):
    swaps = yaml_swaps()
    assert swaps
    for pipeline in valid_pipelines(catalog_of(served)):
        for pair in swaps:
            assert not set(pair) <= set(pipeline.modules), pipeline.modules


def test_the_phoneme_tts_is_the_voice_when_huri_runs_no_other_tts():
    catalog = catalog_of(["rag", "tts_phonemes", "lips"])
    assert row_names(catalog) == ["rag", "tts_phonemes", "lips"]
    voice = row_named(catalog, "tts_phonemes")
    assert (voice["label"], voice["group"]) == ("Voice", "speak")
    pipeline = catalog.build(["rag", "tts_phonemes", "lips"])
    assert set(pipeline.modules) == {"rag", "tts_phonemes", "lips"}


def test_the_page_opens_on_a_valid_selection_without_the_plain_tts():
    catalog = catalog_of(set(CURATED) - {"tts"})
    assert "tts_phonemes" in catalog.selected
    assert "tts_phonemes" in catalog.build(catalog.selected).modules


def test_every_interrupt_policy_sent_is_one_huri_accepts():
    sent = 0
    for pipeline in valid_pipelines(catalog_of()):
        handshake = pipeline.handshake("u")
        if "event_policy" not in handshake:
            continue
        sent += 1
        InterruptPolicy(**handshake["event_policy"]).check(session_topics(handshake))
    assert sent


def test_a_typed_question_interrupts_the_answer_it_writes():
    handshake = catalog_of().build(["rag"]).handshake("u")
    expected = {"interrupts": {"huri.question": ["huri.token"]}}
    assert handshake["event_policy"] == expected
    assert ClientConfig.from_dict(handshake).event_policy == expected


def test_no_interrupt_policy_for_a_huri_before_0_5_or_without_a_question():
    old = load_catalog_config().catalog(details(), None, "0.4.1")
    assert "event_policy" not in old.build(["rag"]).handshake("u")
    assert "event_policy" not in catalog_of().build(["vad", "stt"]).handshake("u")


def test_a_pipeline_without_interrupts_keeps_the_rest_of_its_handshake():
    pipeline = catalog_of().build(TYPED_VOICE)
    plain = pipeline.without_interrupts().handshake("u")
    assert "event_policy" not in plain
    assert plain == {k: v for k, v in pipeline.handshake("u").items() if k in plain}
    assert pipeline.interrupts


BASE_CONFIG = {
    "inbound": {
        "huri.question": {"max_per_minute": 1},
        "huri.audio.in": {"max_per_minute": 1, "binary": True},
    },
    "groups": {"speak": "Speak"},
    "selected": "all",
    "interrupts": {"huri.question": ["huri.token"]},
    "rows": {"bundle": {"group": "speak", "members": ["a", "b"], "required": ["b"]}},
    "modules": {"a": {}, "b": {}, "c": {}, "d": {"swaps": {"c": "e"}}, "e": {}},
}


def config_file(tmp_path, **changes):
    path = tmp_path / "modules.yaml"
    path.write_text(json.dumps({**BASE_CONFIG, **changes}))
    return path


def test_the_base_of_the_refusal_cases_loads(tmp_path):
    config = load_catalog_config(config_file(tmp_path))
    assert list(config.rows) == ["bundle"]


MODULES = BASE_CONFIG["modules"]
BUNDLE = BASE_CONFIG["rows"]["bundle"]


def option_naming(**names):
    option = {"label": "O", "default": "x", "values": {"x": "X"}, **names}
    return {**MODULES, "c": {"options": {"o": option}}}


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"rows": {"a": {"members": ["b"]}}}, "rows.a has the name of a module"),
        ({"rows": {"bundle": {**BUNDLE, "members": []}}}, "must list modules"),
        ({"rows": {"bundle": {"members": ["a", "zz"]}}}, "unknown modules \\['zz'\\]"),
        (
            {"rows": {"bundle": BUNDLE, "other": {"members": ["b"]}}},
            "b is in rows bundle and other",
        ),
        ({"rows": {"bundle": {**BUNDLE, "required": ["c"]}}}, "required"),
        ({"rows": {"bundle": {**BUNDLE, "group": "nope"}}}, "'nope' is not in groups"),
        ({"modules": {**MODULES, "a": {"label": "A"}}}, "member a has its own label"),
        ({"modules": {**MODULES, "a": {"group": "speak"}}}, "has its own group"),
        ({"modules": {**MODULES, "a": {"swaps": {"c": "e"}}}}, "has its own swaps"),
        ({"modules": {**MODULES, "d": {"swaps": {"c": "a"}}}}, "'a' cannot stand"),
        (
            {"modules": {**MODULES, "e": {"swaps": {"d": "c"}}}},
            "cannot stand in",
        ),
        ({"modules": {**MODULES, "d": {"swaps": {"c": "zz"}}}}, "unknown modules"),
        ({"modules": {**MODULES, "d": {"swaps": ["c"]}}}, "must map modules"),
        ({"modules": option_naming(needs="a")}, "c.o names 'a', which is not a row"),
        ({"modules": option_naming(ticks=["e"])}, "c.o names 'e', which is not a row"),
        ({"selected": ["bundle", "a"]}, "selected names 'a', which is not a row"),
        ({"selected": ["e"]}, "selected names 'e', which is not a row"),
        ({"selected": ["bundle", "zz"]}, "selected names unknown \\['zz'\\]"),
        ({"without_visitor": {"zz": {"x": 1}}}, "without_visitor names unknown 'zz'"),
        ({"without_visitor": {"a": "x"}}, "without_visitor.a must map args"),
        ({"without_visitor": ["a"]}, "without_visitor must map modules"),
        ({"selected": "bundle"}, "selected must be a list"),
        ({"interrupts": {"huri.audio.in": ["huri.token"]}}, "'huri.audio.in' is not"),
        ({"interrupts": {"huri.voice": ["huri.token"]}}, "'huri.voice' is not"),
        ({"interrupts": {"nope": ["huri.token"]}}, "'nope' is not"),
        ({"interrupts": {"huri.question": ["huri.voice"]}}, "topics the page renders"),
        ({"interrupts": {"huri.question": ["nope"]}}, "topics the page renders"),
        ({"interrupts": {"huri.question": "huri.token"}}, "topics the page renders"),
    ],
    ids=[
        "row-named-like-a-module",
        "no-members",
        "unknown-member",
        "member-in-two-rows",
        "required-not-a-member",
        "undeclared-row-group",
        "member-label",
        "member-group",
        "member-swaps",
        "swap-to-a-row-member",
        "swap-chain",
        "swap-to-unknown",
        "swaps-not-a-mapping",
        "option-needs-a-member",
        "option-ticks-a-swap-target",
        "selected-a-member",
        "selected-a-swap-target",
        "selected-unknown",
        "without-visitor-unknown-module",
        "without-visitor-not-args",
        "without-visitor-not-a-mapping",
        "selected-not-a-list",
        "trigger-microphone",
        "trigger-voice",
        "trigger-unknown",
        "target-voice",
        "target-unknown",
        "targets-not-a-list",
    ],
)
def test_a_bad_modules_yaml_is_refused_at_load(tmp_path, changes, message):
    path = config_file(tmp_path, **changes)
    with pytest.raises(ValueError, match=message) as refused:
        load_catalog_config(path)
    assert str(refused.value).startswith(f"{path}: ")


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


def test_the_public_catalogue_fixture_is_what_the_page_gets():
    public = catalog_of().public()
    fields = ("name", "label", "group", "inputs", "outputs")
    projection = {
        "modules": [{k: row[k] for k in fields} for row in public["modules"]],
        "selected": public["selected"],
        "inbound": public["inbound"],
        "rendered": public["rendered"],
    }
    assert fixture("public_catalog.json") == projection, json.dumps(projection)


@pytest.mark.parametrize(
    "case", fixture("picker_cases.json")["cases"], ids=lambda case: case["name"]
)
def test_the_server_agrees_with_each_picker_case(case):
    catalog = catalog_of()
    if case["valid"]:
        catalog.build(case["chosen"])
        return
    with pytest.raises(InvalidPipeline) as refused:
        catalog.build(case["chosen"])
    unfed = f"{case['unfed_row']} needs {case['unfed_topic']!r}"
    assert (unfed in str(refused.value)) is (case["unfed_row"] is not None)
    assert (" needs " in str(refused.value)) is (case["unfed_row"] is not None)
