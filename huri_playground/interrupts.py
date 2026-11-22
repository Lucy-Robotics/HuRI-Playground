import re
from typing import Any, Collection, Dict, List, Mapping, Sequence

MIN_CORE_WITH_EVENT_POLICY = (0, 5)
CORE_VERSION_PATTERN = re.compile(r"([0-9]+)\.([0-9]+)")


def session_interrupts(
    rules: Mapping[str, Sequence[str]],
    topics: Collection[str],
    produced: Collection[str],
) -> Dict[str, List[str]]:
    kept = {
        trigger: [target for target in targets if target in produced]
        for trigger, targets in rules.items()
        if trigger in topics
    }
    return {trigger: targets for trigger, targets in kept.items() if targets}


def takes_interrupts(core_version: Any) -> bool:
    if not isinstance(core_version, str):
        return False
    parsed = CORE_VERSION_PATTERN.match(core_version)
    if parsed is None:
        return False
    return (int(parsed[1]), int(parsed[2])) >= MIN_CORE_WITH_EVENT_POLICY
