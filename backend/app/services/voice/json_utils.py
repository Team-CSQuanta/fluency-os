"""Getting a JSON object out of what a small language model actually returns.

Every AI feature in the app asks for JSON and a 1B model obliges most of the
time. The rest of the time it is *nearly* JSON, and the difference between
salvaging that and refusing it is the difference between a working feature
and a 503 the learner can do nothing about.

These are the failures observed in practice, not hypotheticals — the repair
below exists because of output like this, from gemma-3-1b:

    ```json
    {"examples": ["one.", "two.", "three."}}
    ```

which never closes the array and then closes the object twice.
"""

import json
import re

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
# A trailing comma before a closing bracket — legal in JavaScript, not JSON,
# and something models emit constantly.
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def parse_json_object(raw: str) -> dict | None:
    """The model's JSON object, or None if nothing usable can be recovered.

    Only ever returns a dict: every caller expects keyed fields, and quietly
    handing back a list would push the failure into their .get() calls."""
    value = parse_json_value(raw)
    return value if isinstance(value, dict) else None


def parse_json_value(raw: str) -> dict | list | None:
    """As above but also accepts a bare array, which models return when the
    requested object has exactly one list-valued key."""
    if not raw:
        return None
    text = _FENCE.sub("", raw.strip()).strip()

    for candidate in _candidates(text):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _candidates(text: str):
    """Progressively more aggressive readings of the same text, cheapest
    first. Each is handed to the real parser — nothing here decides that a
    string is valid, it only proposes what to try."""
    yield text
    yield _TRAILING_COMMA.sub(r"\1", text)

    # The model often wraps its JSON in a sentence or two. Start at the first
    # opening bracket and let the balancer decide where it ends.
    start = min(
        (i for i in (text.find("{"), text.find("[")) if i != -1),
        default=-1,
    )
    if start == -1:
        return
    body = text[start:]
    repaired = _balance(body)
    if repaired is not None:
        yield repaired
        yield _TRAILING_COMMA.sub(r"\1", repaired)


def _balance(text: str) -> str | None:
    """Closes brackets the model left open, and cuts off anything after the
    structure it actually finished.

    Walks the text tracking whether we are inside a string (and whether the
    previous character escaped the next), so a brace inside a quoted sentence
    is never mistaken for structure. Two repairs come out of it:

    * extra closers — stop at the point the stack would underflow, which is
      the `}}` case above;
    * missing closers — append what is still open, in reverse, which also
      rescues a response cut short by hitting max_tokens.
    """
    stack: list[str] = []
    in_string = False
    escaped = False
    end = None

    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if not stack or stack[-1] != ch:
                # A closer that does not match what is open. Everything from
                # here on is noise; keep what was well-formed.
                end = i
                break
            stack.pop()
            if not stack:
                end = i + 1
                break

    body = text if end is None else text[:end]
    if not body.strip():
        return None

    if in_string:
        body += '"'
    # A value left dangling after its comma ("a", ) parses once the comma
    # goes, which _TRAILING_COMMA handles on the next candidate.
    return body + "".join(reversed(stack))
