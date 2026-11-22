import hashlib
import re
import secrets
from typing import Any

USER_ID_PREFIX = "playground-"
USER_ID_HASH_CHARS = 32
ONE_OFF_ID_BYTES = 16
VISITOR_ID_PATTERN = re.compile(r"[0-9a-f]{32}")


def is_visitor_id(visitor: Any) -> bool:
    return (
        isinstance(visitor, str) and VISITOR_ID_PATTERN.fullmatch(visitor) is not None
    )


def huri_user_id(visitor: Any) -> str:
    if is_visitor_id(visitor):
        return _stable_user_id(visitor)
    return USER_ID_PREFIX + secrets.token_hex(ONE_OFF_ID_BYTES)


def _stable_user_id(visitor: str) -> str:
    digest = hashlib.sha256(visitor.encode()).hexdigest()
    return USER_ID_PREFIX + digest[:USER_ID_HASH_CHARS]
