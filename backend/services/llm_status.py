"""
State of the LLM server, for the admin panel: whether it answers, the model
configured for summaries and translations and whether the server has it, and
(on Ollama) which models are loaded in memory right now.

Only status endpoints are called, each with a short timeout: nothing is
generated, so checking never makes Ollama load a model. Ollama is recognised
by /api/version; any other OpenAI-compatible server (llama.cpp, vLLM, ...)
is asked for /v1/models only, and what is loaded is then unknown.
"""
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

STATUS_TIMEOUT = 5.0


def display_url(url: str) -> str:
    """The server's URL without any credentials in it."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme, host, parts.path, "", ""))


def _same_model(configured: str, name: str) -> bool:
    """Ollama names a model without a tag "<name>:latest"."""
    def normal(model: str) -> str:
        return model if ":" in model else f"{model}:latest"
    return normal(configured) == normal(name)


def _problem(error: Exception) -> dict[str, Any]:
    """What went wrong: a code the panel translates, plus the English text."""
    if isinstance(error, httpx.TimeoutException):
        return {"error_code": "timeout",
                "error": f"No answer within {STATUS_TIMEOUT:.0f} seconds."}
    if isinstance(error, httpx.ConnectError):
        return {"error_code": "unreachable", "error": "Connection refused or host unreachable."}
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        return {"error_code": "http", "error_status": code,
                "error": f"HTTP {code} from the server."}
    return {"error_code": "other", "error": str(error) or type(error).__name__}


async def llm_status(client, settings) -> dict[str, Any]:
    """Ask the LLM server how it is. Never raises: problems are reported."""
    base = settings.llm_api_url.rstrip("/")
    configured = settings.llm_model_name
    headers = {}
    if getattr(settings, "llm_api_key", None):
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    status: dict[str, Any] = {
        "url": display_url(base),
        "configured_model": configured,
        "reachable": False,
        "server": None,
        "version": None,
        "latency_ms": None,
        "model_available": None,
        "model_loaded": None,
        "available_models": [],
        "loaded_models": None,
        "error": None,
        "error_code": None,  # timeout | unreachable | http | other
        "error_status": None,  # the HTTP status, for "http"
    }

    async def get(path: str) -> Any:
        response = await client.get(f"{base}{path}", headers=headers, timeout=STATUS_TIMEOUT)
        response.raise_for_status()
        return response.json()

    started = time.monotonic()
    try:
        version = await get("/api/version")
        status.update(server="ollama", version=version.get("version"))
    except Exception:  # pylint: disable=broad-exception-caught
        version = None
    try:
        if version is not None:
            status["latency_ms"] = round((time.monotonic() - started) * 1000)
            status["reachable"] = True  # it answered, even if a listing fails below
            tags = await get("/api/tags")
            status["available_models"] = [
                {
                    "name": model.get("name") or model.get("model"),
                    "size": model.get("size"),
                    "parameter_size": (model.get("details") or {}).get("parameter_size"),
                    "quantization": (model.get("details") or {}).get("quantization_level"),
                }
                for model in tags.get("models", [])
            ]
            running = await get("/api/ps")
            status["loaded_models"] = [
                {
                    "name": model.get("name") or model.get("model"),
                    "size": model.get("size"),
                    "size_vram": model.get("size_vram"),
                    "expires_at": model.get("expires_at"),
                }
                for model in running.get("models", [])
            ]
            status["model_loaded"] = any(
                _same_model(configured, model["name"] or "")
                for model in status["loaded_models"]
            )
        else:
            models = await get("/v1/models")
            status["latency_ms"] = round((time.monotonic() - started) * 1000)
            status["server"] = "openai"
            status["available_models"] = [
                {"name": model.get("id"), "size": None, "parameter_size": None,
                 "quantization": None}
                for model in models.get("data", [])
            ]
        status["reachable"] = True
        status["model_available"] = any(
            _same_model(configured, model["name"] or "")
            for model in status["available_models"]
        )
    except Exception as e:  # pylint: disable=broad-exception-caught
        status.update(_problem(e))
    return status
