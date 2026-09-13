"""Cloud LLM chat generation via Google AI Studio's Gemini API
(https://ai.google.dev) — a second opt-in cloud provider alongside
cloud_llm_engine.py's OpenRouter path. Same stdlib-only (urllib) choice, same
"no load step, every call is live" readiness model — see cloud_llm_engine.py
for the shared reasoning.

Gemini's REST shape differs from OpenRouter's OpenAI-compatible one: chat
history uses role "model" instead of "assistant", the system prompt is a
separate `system_instruction` field rather than a message, and JSON output
is requested via `generationConfig.responseMimeType` rather than prompt
instructions alone (kept as a belt-and-suspenders backup via
parse_json_object, in case a model ignores it).
"""

import json
import urllib.error
import urllib.request

from app.services.voice import engine_health
from app.services.voice.errors import EngineUnavailable
from app.services.voice.json_utils import parse_json_object

_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-2.0-flash"

# Gemini's thinking models (2.5 onward) charge internal reasoning tokens
# against maxOutputTokens *before* emitting any visible text, so a budget
# sized for the answer alone gets spent on reasoning and the reply comes back
# chopped mid-sentence — or empty. Thinking gets its own headroom on top of
# whatever the caller asked for; how long the answer actually runs is steered
# by the prompt, not by this ceiling.
_THINKING_HEADROOM_TOKENS = 2048


def _history_to_contents(history: list[tuple[str, str]]) -> list[dict]:
    return [{"role": "model" if role == "assistant" else "user", "parts": [{"text": text}]} for role, text in history]


def _request(
    system_prompt: str,
    contents: list[dict],
    *,
    api_key: str | None,
    model: str,
    max_tokens: int,
    temperature: float,
    json_mode: bool = False,
) -> str:
    if not api_key:
        raise EngineUnavailable(
            "No Gemini API key configured — add one in Settings (AI → Cloud) to use the cloud AI."
        )
    generation_config: dict = {
        "maxOutputTokens": max_tokens + _THINKING_HEADROOM_TOKENS,
        "temperature": temperature,
    }
    if json_mode:
        generation_config["responseMimeType"] = "application/json"
    body = json.dumps(
        {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": generation_config,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{_API_BASE}/{model}:generateContent",
        data=body,
        method="POST",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")[:300]
        message = f"Gemini request failed ({err.code}): {detail}"
        engine_health.record_failure("gemini", model, message)
        raise EngineUnavailable(message) from err
    except urllib.error.URLError as err:
        message = f"Couldn't reach Gemini: {err.reason}"
        engine_health.record_failure("gemini", model, message)
        raise EngineUnavailable(message) from err
    # The service answered — that, and only that, is what a verified key means.
    engine_health.record_success("gemini", model)

    try:
        candidate = data["candidates"][0]
        parts = (candidate.get("content") or {}).get("parts") or []
        # A thinking model can return its reasoning as parts flagged
        # "thought" — those are not the reply and must never be shown as it.
        text = "".join(str(p.get("text", "")) for p in parts if not p.get("thought")).strip()
    except (KeyError, IndexError, TypeError) as err:
        raise EngineUnavailable("Gemini returned an unexpected response shape") from err

    finish_reason = candidate.get("finishReason")
    if finish_reason == "MAX_TOKENS":
        # Storing the fragment would be worse than failing: it becomes part of
        # the conversation history and every later turn is built on it.
        raise EngineUnavailable(
            f"{model} ran out of output budget before finishing its reply. Thinking models spend that "
            f"budget on reasoning first — switch to a non-thinking model such as {DEFAULT_MODEL} in "
            "Settings (AI → Cloud) for short conversational replies."
        )
    if not text:
        raise EngineUnavailable(f"Gemini returned an empty reply (finishReason={finish_reason or 'unknown'})")
    return text


def generate_reply(
    system_prompt: str,
    history: list[tuple[str, str]],
    *,
    api_key: str | None,
    model: str,
    max_tokens: int = 220,
) -> str:
    return _request(
        system_prompt,
        _history_to_contents(history),
        api_key=api_key,
        model=model,
        max_tokens=max_tokens,
        temperature=0.7,
    )


def verify(*, api_key: str | None, model: str) -> None:
    """One real, minimal request — the only thing that can actually establish
    that a key works. Raises EngineUnavailable with the real reason if not."""
    _request(
        "Reply with the single word OK.",
        [{"role": "user", "parts": [{"text": "ping"}]}],
        api_key=api_key,
        model=model,
        max_tokens=8,
        temperature=0.0,
    )


def generate_json(
    system_prompt: str,
    user_prompt: str,
    *,
    api_key: str | None,
    model: str,
    max_tokens: int = 300,
    temperature: float = 0.4,
) -> dict:
    raw = _request(
        system_prompt,
        [{"role": "user", "parts": [{"text": user_prompt}]}],
        api_key=api_key,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        json_mode=True,
    )
    parsed = parse_json_object(raw)
    if parsed is None:
        raise EngineUnavailable("Gemini's response wasn't valid JSON")
    return parsed

