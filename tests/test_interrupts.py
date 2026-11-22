import pytest

from huri_playground.interrupts import session_interrupts, takes_interrupts
from huri_playground.pipeline import RENDERED, load_catalog_config

RULES = load_catalog_config().interrupts
SPEAK_TOPICS = [
    "huri.token",
    "huri.audio.out",
    "huri.motion",
    "huri.lips.face",
    "huri.emotion.out",
]


def test_a_typed_question_interrupts_only_the_answer_being_written():
    rules = session_interrupts(RULES, {"huri.question", "huri.token"}, {"huri.token"})
    assert rules == {"huri.question": ["huri.token"]}


def test_a_full_speaking_session_interrupts_every_answer_topic_in_page_order():
    produced = {"huri.question", *SPEAK_TOPICS}
    rules = session_interrupts(RULES, {"huri.audio.in", *produced}, produced)
    assert rules == {"huri.question": SPEAK_TOPICS}
    assert SPEAK_TOPICS == [t for t in RENDERED if t in SPEAK_TOPICS]


def test_a_session_without_questions_gets_no_rule():
    produced = {"huri.voice", "huri.transcript"}
    assert session_interrupts(RULES, {"huri.audio.in", *produced}, produced) == {}


def test_a_rule_whose_targets_are_all_absent_is_dropped():
    assert session_interrupts(RULES, {"huri.question"}, {"huri.transcript"}) == {}


@pytest.mark.parametrize(
    "version, takes",
    [
        ("0.4.0.dev0", False),
        ("0.4.1", False),
        ("0.5.0", True),
        ("0.5.0.dev0", True),
        ("1.0.0", True),
        (None, False),
        ("", False),
        ("garbage", False),
        ("v0.5.0", False),
        ("٠.٥.٠", False),
        (5, False),
        (["0.5.0"], False),
    ],
)
def test_interrupt_rules_go_only_to_a_huri_core_that_takes_them(version, takes):
    assert takes_interrupts(version) is takes


def test_a_rule_whose_trigger_the_session_lacks_is_dropped():
    assert session_interrupts(RULES, {"huri.token"}, {"huri.token"}) == {}
