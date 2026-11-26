import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple

import pytest

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "huri_playground" / "static"
JS_TESTS = ROOT / "tests" / "js"
MIN_NODE = (20, 19)
TIMEOUT_SECONDS = 120
FOCUSED = re.compile(r"\b(?:describe|it|test|suite)\.only\b|\bonly\s*:\s*true")


def node_version(node: str) -> Optional[Tuple[int, int]]:
    result = subprocess.run(
        [node, "--version"], capture_output=True, text=True, timeout=TIMEOUT_SECONDS
    )
    found = re.match(r"v(\d+)\.(\d+)", result.stdout)
    return (int(found.group(1)), int(found.group(2))) if found else None


def unavailable_reason() -> Optional[str]:
    node = shutil.which("node")
    if node is None:
        return "node is not installed"
    version = node_version(node)
    if version is None or version < MIN_NODE:
        return "node >= %d.%d is required" % MIN_NODE
    return None


@pytest.fixture(scope="module")
def node() -> str:
    reason = unavailable_reason()
    if reason is not None:
        if os.environ.get("CI"):
            pytest.fail(reason)
        pytest.skip(reason)
    return str(shutil.which("node"))


def static_scripts() -> List[Path]:
    return sorted(STATIC.glob("*.js"))


def js_suites() -> List[Path]:
    return sorted(JS_TESTS.glob("*.test.mjs"))


def run_node(node: str, *args: str) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(
        [node, *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=TIMEOUT_SECONDS,
    )


def test_static_scripts_parse(node: str) -> None:
    scripts = static_scripts()
    assert scripts, "no scripts found in %s" % STATIC
    failures = []
    for script in scripts:
        result = run_node(node, "--check", str(script))
        if result.returncode != 0:
            failures.append("%s\n%s" % (script.name, result.stderr))
    assert not failures, "\n".join(failures)


def test_js_suites_pass(node: str) -> None:
    suites = js_suites()
    assert suites, "no *.test.mjs files found in %s" % JS_TESTS
    result = run_node(node, "--test", *[str(suite) for suite in suites])
    assert result.returncode == 0, result.stdout + result.stderr


def test_js_tests_mirror_static_modules() -> None:
    orphans = [
        suite.name
        for suite in js_suites()
        if not (STATIC / (suite.name[: -len(".test.mjs")] + ".js")).is_file()
    ]
    assert not orphans, "no static module for: %s" % ", ".join(orphans)


def test_no_only_in_js_tests() -> None:
    offenders = [
        suite.name
        for suite in js_suites()
        if FOCUSED.search(suite.read_text(encoding="utf-8"))
    ]
    assert not offenders, "focused tests in: %s" % ", ".join(offenders)


@pytest.mark.parametrize(
    "source",
    [
        "it.only('x', () => {})",
        "describe.only('x', () => {})",
        "test('x', { only: true }, () => {})",
        "test('x', { skip: false, only: true }, () => {})",
    ],
)
def test_focused_pattern_catches(source: str) -> None:
    assert FOCUSED.search(source)


@pytest.mark.parametrize(
    "source",
    ["it('x', () => {})", "const only = true", "test('x', { skip: true }, f)"],
)
def test_focused_pattern_ignores(source: str) -> None:
    assert not FOCUSED.search(source)
