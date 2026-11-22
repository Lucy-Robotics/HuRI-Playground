import json
import re
from pathlib import Path

import pytest

from huri_playground.visitor_identity import (
    VISITOR_ID_PATTERN,
    huri_user_id,
    is_visitor_id,
)

VISITOR_IDS = json.loads(
    (Path(__file__).parent / "fixtures" / "visitor_ids.json").read_text()
)
ONE_OFF_USER_ID = re.compile(r"playground-[0-9a-f]{32}")
INVALID = [case["value"] for case in VISITOR_IDS["invalid"]] + ["x" * 10000]


def test_a_visitor_id_always_gives_the_same_huri_user_id():
    assert huri_user_id("0" * 32) == "playground-84e0c0eafaa95a34c293f278ac52e45c"


def test_the_pattern_is_the_one_the_page_generates():
    assert VISITOR_ID_PATTERN.pattern == VISITOR_IDS["pattern"].strip("^$")


@pytest.mark.parametrize("visitor", VISITOR_IDS["valid"])
def test_a_valid_visitor_id_is_stable_and_never_sent_verbatim(visitor):
    user_id = huri_user_id(visitor)
    assert user_id == huri_user_id(visitor)
    assert user_id.startswith("playground-")
    assert visitor not in user_id


def test_two_visitors_get_two_huri_user_ids():
    user_ids = {huri_user_id(visitor) for visitor in VISITOR_IDS["valid"]}
    assert len(user_ids) == len(VISITOR_IDS["valid"])


@pytest.mark.parametrize(
    "visitor", INVALID, ids=[case["why"] for case in VISITOR_IDS["invalid"]] + ["long"]
)
def test_a_malformed_visitor_id_gets_a_new_one_off_huri_user_id(visitor):
    first, second = huri_user_id(visitor), huri_user_id(visitor)
    assert first != second
    assert ONE_OFF_USER_ID.fullmatch(first)
    assert not isinstance(visitor, str) or not visitor or visitor not in first


@pytest.mark.parametrize("visitor", VISITOR_IDS["valid"])
def test_a_visitor_id_the_page_generates_is_one(visitor):
    assert is_visitor_id(visitor) is True


@pytest.mark.parametrize("visitor", INVALID, ids=range(len(INVALID)))
def test_anything_else_is_not_a_visitor_id(visitor):
    assert is_visitor_id(visitor) is False
