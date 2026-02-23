"""
Anthropic Claude client via Cloudflare AI Gateway.

Replaces all @cf/meta/llama-3-8b-instruct calls with Claude Sonnet
routed through the AI Gateway for caching, logging, and cost tracking.

Usage:
    client = AnthropicClient(env)
    text = await client.complete("Summarize this article...")
    data = await client.extract_json("Return JSON with keywords...")
"""

import json

# TODO: confirm exact AI Gateway FFI API shape once pywrangler docs stabilise
# The pattern below follows the universal gateway.run() interface from
# worker-configuration.d.ts (AIGatewayUniversalRequest)

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
MAX_RETRIES = 2


class AnthropicClient:
    """Wrapper for Anthropic Claude calls via Cloudflare AI Gateway."""

    def __init__(self, env, model: str = DEFAULT_MODEL):
        self.env = env
        self.model = model
        # AI Gateway ID from env vars (set in wrangler.jsonc)
        self.gateway_id = getattr(env, "AI_GATEWAY_ID", "mukoko-gateway")

    async def complete(self, prompt: str, max_tokens: int = 1024, system: str | None = None) -> str:
        """
        Send a prompt to Claude via AI Gateway and return the text response.

        Falls back to empty string on failure so callers can use their own
        fallback logic (matching the existing TS pattern).
        """
        messages = [{"role": "user", "content": prompt}]

        request_body = {
            "provider": "anthropic",
            "endpoint": "messages",
            "headers": {
                "x-api-key": self.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            "query": {
                "model": self.model,
                "max_tokens": max_tokens,
                "messages": messages,
            },
        }

        if system:
            request_body["query"]["system"] = system

        try:
            gateway = self.env.AI.gateway(self.gateway_id)
            result = await gateway.run([request_body])

            # TODO: verify response shape from AI Gateway FFI
            # Expected: result.content[0].text (Anthropic Messages API shape)
            if hasattr(result, "content") and len(result.content) > 0:
                return result.content[0].text
            # Fallback: may come back as dict
            if isinstance(result, dict):
                content = result.get("content", [])
                if content and len(content) > 0:
                    return content[0].get("text", "")
            return str(result)

        except Exception as e:
            print(f"[AI_CLIENT] Anthropic call failed: {e}")
            return ""

    async def extract_json(self, prompt: str, max_tokens: int = 1024) -> dict | None:
        """
        Call Claude and parse JSON from the response.

        Claude is much more reliable at structured output than Llama-3-8b,
        so we need fewer fallback paths than the current TS implementation.
        """
        text = await self.complete(prompt, max_tokens=max_tokens)
        if not text:
            return None

        try:
            # Try direct parse first
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Claude sometimes wraps JSON in markdown code blocks
        if "```json" in text:
            try:
                json_str = text.split("```json")[1].split("```")[0].strip()
                return json.loads(json_str)
            except (IndexError, json.JSONDecodeError):
                pass

        if "```" in text:
            try:
                json_str = text.split("```")[1].split("```")[0].strip()
                return json.loads(json_str)
            except (IndexError, json.JSONDecodeError):
                pass

        # Try to find JSON object in the text
        try:
            start = text.index("{")
            end = text.rindex("}") + 1
            return json.loads(text[start:end])
        except (ValueError, json.JSONDecodeError):
            pass

        print(f"[AI_CLIENT] Failed to parse JSON from response: {text[:200]}")
        return None


async def get_embedding(text: str, env) -> list[float] | None:
    """
    Generate a vector embedding using Workers AI (baai/bge-base-en-v1.5).

    This stays on Workers AI (not Anthropic) because Vectorize requires
    a specific embedding model for index compatibility.
    """
    try:
        result = await env.AI.run("@cf/baai/bge-base-en-v1.5", {"text": text})
        if result and hasattr(result, "data") and len(result.data) > 0:
            return list(result.data[0])
        if isinstance(result, dict) and "data" in result:
            data = result["data"]
            if data and len(data) > 0:
                return list(data[0])
        return None
    except Exception as e:
        print(f"[AI_CLIENT] Embedding generation failed: {e}")
        return None
