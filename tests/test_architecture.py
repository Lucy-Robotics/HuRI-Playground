import ast
import re
import sys
from pathlib import Path
from typing import Iterator, List, Set, Tuple

import pytest
from omegaconf import OmegaConf

from huri_playground.pipeline import RENDERED
from tests.curated import CURATED

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - python 3.10
    import tomli as tomllib

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "huri_playground"
STATIC = PACKAGE / "static"
CI_FILE = ROOT / ".github" / "workflows" / "ci.yml"
HURI_CORE_REQUIREMENT = re.compile(
    r"^huri-core\[[^\]]*\]\s*>=([\d.]+)\s*,\s*<([\d.]+)$"
)
CI_DEFAULT_REF = re.compile(
    r"huri_core_ref:.*?default:\s*[\"']([^\"']+)[\"']", re.DOTALL
)
CI_FALLBACK_REF = re.compile(r"HURI_CORE_REF:.*\|\|\s*'([^']+)'")
BROWSER_GLOBALS = re.compile(
    r"\b(document|window|localStorage|sessionStorage|crypto|performance"
    r"|AudioContext|state)\b"
)
JS_COMMENTS = re.compile(r"/\*.*?\*/|//[^\n]*", re.DOTALL)
JS_TESTS = ROOT / "tests" / "js"
REQUIRED_PURE_MODULES = {
    "picker-rules",
    "visitor-id",
    "answer-cut",
    "emotion-tags",
    "utterance-gate",
    "speaker",
}
PURE_MODULES = sorted(
    suite.name[: -len(".test.mjs")]
    for suite in JS_TESTS.glob("*.test.mjs")
    if (STATIC / (suite.name[: -len(".test.mjs")] + ".js")).is_file()
)
DATA_DRIVEN_PYTHON = (
    "pipeline.py",
    "interrupts.py",
    "gateway.py",
    "visitor_identity.py",
)


def version_tuple(text: str) -> Tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))


def huri_core_range() -> Tuple[Tuple[int, ...], Tuple[int, ...]]:
    with open(ROOT / "pyproject.toml", "rb") as handle:
        dependencies = tomllib.load(handle)["project"]["dependencies"]
    for requirement in dependencies:
        found = HURI_CORE_REQUIREMENT.match(requirement)
        if found:
            return version_tuple(found.group(1)), version_tuple(found.group(2))
    raise AssertionError("no huri-core[...]>=a,<b requirement in pyproject.toml")


def ci_refs() -> List[str]:
    text = CI_FILE.read_text(encoding="utf-8")
    refs = [CI_DEFAULT_REF.search(text), CI_FALLBACK_REF.search(text)]
    assert all(refs), "ci.yml lost its huri-core ref default or fallback"
    return [found.group(1) for found in refs if found]


@pytest.mark.parametrize("ref_index", [0, 1], ids=["input default", "env fallback"])
def test_ci_huri_core_ref_is_inside_the_pinned_range(ref_index: int) -> None:
    low, high = huri_core_range()
    ref = version_tuple(ci_refs()[ref_index])
    assert low <= ref < high


def strip_js_comments(source: str) -> str:
    return JS_COMMENTS.sub("", source)


def test_the_pure_modules_are_found() -> None:
    assert PURE_MODULES, "no static module has a tests/js mirror"
    assert REQUIRED_PURE_MODULES <= set(PURE_MODULES)


@pytest.mark.parametrize("name", PURE_MODULES)
def test_pure_modules_use_no_browser_globals(name: str) -> None:
    path = STATIC / (name + ".js")
    code = strip_js_comments(path.read_text(encoding="utf-8"))
    found = sorted(set(BROWSER_GLOBALS.findall(code)))
    assert not found, "%s uses browser globals: %s" % (path.name, ", ".join(found))


def test_comment_stripping_keeps_code_and_drops_comments() -> None:
    source = "const a = 1; // window\n/* document\n state */ const b = 2;"
    code = strip_js_comments(source)
    assert not BROWSER_GLOBALS.search(code)
    assert "const a" in code and "const b" in code


def yaml_names() -> Set[str]:
    document = OmegaConf.to_container(OmegaConf.load(PACKAGE / "modules.yaml"))
    assert isinstance(document, dict)
    return set(document.get("modules") or {}) | set(document.get("rows") or {})


def string_constants(tree: ast.AST) -> Iterator[Tuple[int, str]]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.lineno, node.value


def named_modules(path: Path) -> List[str]:
    names = yaml_names() | set(CURATED)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [
        "%s:%d %r" % (path.name, line, text)
        for line, text in string_constants(tree)
        if text in names
    ]


@pytest.mark.parametrize("filename", DATA_DRIVEN_PYTHON)
def test_python_code_names_no_module(filename: str) -> None:
    path = PACKAGE / filename
    assert not named_modules(path)


def test_the_module_name_scan_catches_a_module_name(tmp_path: Path) -> None:
    sample = tmp_path / "sample.py"
    sample.write_text("x = 'tts'\ny = 'thinking'\nz = 'other'\n", encoding="utf-8")
    assert len(named_modules(sample)) == 2


def static_sources() -> str:
    return "\n".join(
        path.read_text(encoding="utf-8") for path in sorted(STATIC.glob("*.js"))
    )


@pytest.mark.parametrize("topic", sorted(RENDERED))
def test_every_rendered_topic_is_handled_in_the_page(topic: str) -> None:
    literal = re.compile("[\"'`]" + re.escape(topic) + "[\"'`]")
    assert literal.search(static_sources()), "%s is not handled in static/*.js" % topic
