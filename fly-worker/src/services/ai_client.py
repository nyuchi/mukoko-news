"""Anthropic Claude client for AI processing.

Native anthropic SDK — no Cloudflare AI Gateway needed on Fly.io.
"""

import json

import anthropic
from anthropic.types import TextBlock

from src.config import settings

_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    """Get or create the Anthropic client singleton."""
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def complete(
    prompt: str,
    *,
    system: str | None = None,
    model: str = "claude-sonnet-4-5-20250929",
    max_tokens: int = 1024,
) -> str:
    """Send a prompt to Claude and return the text response."""
    client = get_client()
    try:
        kwargs: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        response = await client.messages.create(**kwargs)  # type: ignore[arg-type]
        block = response.content[0]
        return block.text if isinstance(block, TextBlock) else ""
    except Exception as e:
        print(f"[AI_CLIENT] Anthropic call failed: {e}")
        return ""


async def extract_json(
    prompt: str,
    *,
    system: str | None = None,
    model: str = "claude-sonnet-4-5-20250929",
    max_tokens: int = 1024,
) -> dict | list | None:
    """Send a prompt to Claude and parse the JSON response."""
    text = await complete(prompt, system=system, model=model, max_tokens=max_tokens)
    if not text:
        return None

    # Try to extract JSON from the response
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON in markdown code blocks
    import re
    json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if json_match:
        try:
            return json.loads(json_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try to find any JSON object or array
    for pattern in [r"\{[\s\S]*\}", r"\[[\s\S]*\]"]:
        match = re.search(pattern, text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                continue

    print(f"[AI_CLIENT] Failed to parse JSON from response: {text[:200]}")
    return None
