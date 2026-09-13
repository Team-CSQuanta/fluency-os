"""Cloud LLM chat generation via OpenRouter (https://openrouter.ai) — the
opt-in alternative to the local llama.cpp path in llm_chat_engine.py.

Deliberately the plain stdlib (urllib), same choice download_manager.py
already made over adding an HTTP client dependency for a handful of
requests. There's no "load into memory" concept here (no warm_up/is_ready
singleton) — every call is a real, live network request, so readiness is
just "is an API key configured," checked by the caller (conversation.py)
before generation is attempted.
"""

import json
import urllib.error
import urllib.request

from app.services.voice import engine_health
from app.services.voice.errors import EngineUnavailable
from app.services.voice.json_utils import parse_json_object

_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-4o-mini"


def _chat(messages: list[dict], *, api_key: str | None, model: str, max_tokens: int, temperature: float) -> str:
    if not api_key:
        raise EngineUnavailable(
            "No OpenRouter API key configured — add one in Settings (AI → Cloud) to use the cloud AI."
        )
    body = json.dumps(
        {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    ).encode("utf-8")
    request = urllib.request.Request(
        _API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter's recommended (optional) attribution headers.
            "HTTP-Referer": "https://github.com/Team-CSQuanta/fluency-os",
            "X-Title": "FluencyOS",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")[:300]
        message = f"OpenRouter request failed ({err.code}): {detail}"
        engine_health.record_failure("openrouter", model, message)
        raise EngineUnavailable(message) from err
    except urllib.error.URLError as err:
        message = f"Couldn't reach OpenRouter: {err.reason}"
        engine_health.record_failure("openrouter", model, message)
        raise EngineUnavailable(message) from err
    # The service answered — that, and only that, is what a verified key means.
    engine_health.record_success("openrouter", model)

    try:
        choice = data["choices"][0]
        text = str(choice["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError) as err:
        raise EngineUnavailable("OpenRouter returned an unexpected response shape") from err

    if choice.get("finish_reason") == "length":
        # See gemini_llm_engine for why a truncated reply is refused rather
        # than stored: it would become part of the conversation history.
        raise EngineUnavailable(
            f"{model} ran out of output budget before finishing its reply — if it reasons before "
            "answering, that reasoning spends the same budget. Try a non-reasoning model in Settings."
        )
    return text


def generate_reply(
    system_prompt: str,
    history: list[tuple[str, str]],
    *,
    api_key: str | None,
    model: str,
    max_tokens: int = 220,
) -> str:
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend({"role": role, "content": text} for role, text in history)
    return _chat(messages, api_key=api_key, model=model, max_tokens=max_tokens, temperature=0.7)


def verify(*, api_key: str | None, model: str) -> None:
    """One real, minimal request — the only thing that can actually establish
    that a key works. Raises EngineUnavailable with the real reason if not."""
    _chat(
        [{"role": "user", "content": "ping"}],
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
    raw = _chat(
        [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        api_key=api_key,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    parsed = parse_json_object(raw)
    if parsed is None:
        raise EngineUnavailable("OpenRouter's response wasn't valid JSON")
    return parsed

