"""Shared "salvage a JSON object out of an LLM's text reply" helper — small
models (local or cloud) sometimes wrap JSON in prose or a markdown fence
despite being told not to. Used by both llm_chat_engine.py (local) and
cloud_llm_engine.py (OpenRouter) so the two don't duplicate the same regex.
"""

import json
import re


def parse_json_object(raw: str) -> dict | None:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None
