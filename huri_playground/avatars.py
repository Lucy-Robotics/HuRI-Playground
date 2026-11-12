"""avatars.yaml: the avatars the page shows, and the body they give modules.

The page measures its avatar's body from the model (static/avatar.js) and
sends it with the session; the gateway checks it, lays the config's
overrides over it and hands it to the modules that take one (`body_args`),
such as huri-module-think, which solves its thinking poses on it. A body is
only numbers in a fixed shape: the page never sends args.
"""

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping

from .files import load_mapping

AVATARS_PATH = Path(__file__).parent / "avatars.yaml"

# huri-module-think's Body: each field and its number of values (1: a
# length, which must be > 0). Metres, from the pelvis, SMPL-X axes.
BODY_FIELDS = {
    "shoulder": 3,
    "upper_arm": 1,
    "forearm": 1,
    "hand": 1,
    "chin": 2,
    "chest": 3,
    "waist": 3,
    "hip": 2,
}
# Anything bigger is not a body measured in metres.
MAX_M = 3.0

CAMERA_SHOTS = ("head", "chest", "waist", "knees", "full")


class InvalidBody(ValueError):
    pass


def check_body(values: Any, partial: bool = False) -> Dict[str, Any]:
    """A body as plain numbers; ``partial``: fields may be left out."""
    if not isinstance(values, Mapping):
        raise InvalidBody("body must be a mapping")
    unknown = sorted(set(values) - set(BODY_FIELDS))
    if unknown:
        raise InvalidBody(f"body has no {', '.join(map(str, unknown))}")
    missing = sorted(set(BODY_FIELDS) - set(values))
    if missing and not partial:
        raise InvalidBody(f"body lacks {', '.join(missing)}")
    clean: Dict[str, Any] = {}
    for name, value in values.items():
        size = BODY_FIELDS[name]
        numbers = [value] if size == 1 else value
        if not isinstance(numbers, list) or len(numbers) != size:
            raise InvalidBody(f"body.{name} must be {size} number(s)")
        for x in numbers:
            if (
                isinstance(x, bool)
                or not isinstance(x, (int, float))
                or not math.isfinite(x)
                or abs(x) > MAX_M
            ):
                raise InvalidBody(f"body.{name} must be metres")
        if size == 1 and numbers[0] <= 0:
            raise InvalidBody(f"body.{name} must be > 0")
        clean[name] = float(numbers[0]) if size == 1 else [float(x) for x in numbers]
    return clean


@dataclass(frozen=True)
class AvatarsConfig:
    # Name -> what the page needs to show it, in the order it tries them.
    avatars: Mapping[str, Mapping[str, Any]]
    # Module -> the arg its avatar body goes in.
    body_args: Mapping[str, str] = field(default_factory=dict)

    def public(self) -> List[Dict[str, Any]]:
        return [{"name": name, **entry} for name, entry in self.avatars.items()]

    def body(self, avatar: Any, measured: Any) -> Dict[str, Any] | None:
        """The body of the session's avatar: the page's measurement, checked,
        under the config's overrides; None when there is neither."""
        entry = self.avatars.get(avatar) if isinstance(avatar, str) else None
        if entry is None:
            return None
        body = check_body(measured) if measured is not None else {}
        body.update(entry.get("body") or {})
        return body or None

    def module_args(self, avatar: Any, measured: Any) -> Dict[str, Dict[str, Any]]:
        """Args to add, module -> {arg: body}."""
        body = self.body(avatar, measured)
        if body is None:
            return {}
        return {module: {arg: body} for module, arg in self.body_args.items()}


def load_avatars_config(path: Path = AVATARS_PATH) -> AvatarsConfig:
    raw = load_mapping(path)
    avatars = raw.get("avatars") or {}
    for name, entry in avatars.items():
        if not entry.get("model"):
            raise ValueError(f"{path}: {name} has no model")
        for when, shot in (entry.get("camera") or {}).items():
            if shot not in CAMERA_SHOTS:
                raise ValueError(
                    f"{path}: {name}.camera.{when} must be one of {CAMERA_SHOTS}"
                )
        if entry.get("body") is not None:
            try:
                check_body(entry["body"], partial=True)
            except InvalidBody as e:
                raise ValueError(f"{path}: {name}: {e}") from None
    return AvatarsConfig(avatars=avatars, body_args=raw.get("body_args") or {})
