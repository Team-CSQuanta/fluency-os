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
        raise EngineUnavailable(f"OpenRouter request failed ({err.code}): {detail}") from err
    except urllib.error.URLError as err:
        raise EngineUnavailable(f"Couldn't reach OpenRouter: {err.reason}") from err

    try:
        return str(data["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError) as err:
        raise EngineUnavailable("OpenRouter returned an unexpected response shape") from err


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


def generate_report(
    transcript: list[tuple[str, str]], target_words: list[str], *, api_key: str | None, model: str
) -> dict:
    """Mirrors llm_chat_engine.generate_report's prompt exactly, so the
    Conversation report shape is identical regardless of which LLM produced
    it — only the underlying call differs."""
    transcript_text = "\n".join(f"{role}: {text}" for role, text in transcript)
    words_list = ", ".join(target_words) if target_words else "(none)"
    system_prompt = (
        "You are a strict, structured language-learning analyst. Given a conversation "
        "transcript and a list of target vocabulary words the learner was meant to "
        "practice, respond with ONLY a JSON object (no prose, no markdown fences) of "
        'the shape: {"word_usage": {"<word>": "spontaneous"|"prompted"|"incorrect"|"avoided"}, '
        '"accuracy_notes": [string, ...], "summary": string}. '
        '"spontaneous" = the learner used the word correctly and unprompted. '
        '"prompted" = used correctly only after the AI said or hinted the word. '
        '"incorrect" = attempted but used wrongly. "avoided" = never used at all.'
    )
    user_prompt = f"Target words: {words_list}\n\nTranscript:\n{transcript_text}"
    return generate_json(system_prompt, user_prompt, api_key=api_key, model=model, max_tokens=600, temperature=0.2)
