"""
The LLM server's state for the admin panel: Ollama is recognised and reports
its version, installed models and the ones loaded in memory; another
OpenAI-compatible server reports its models; a server that is down or slow is
reported as such; the configured model is matched (with Ollama's implicit
":latest"); no credentials leave the backend.
"""
import asyncio
from types import SimpleNamespace

import httpx
from services.llm_status import display_url, llm_status

OLLAMA = {
    "/api/version": {"version": "0.12.3"},
    "/api/tags": {"models": [
        {"name": "qwen3:1.7b", "size": 1_400_000_000,
         "details": {"parameter_size": "2.0B", "quantization_level": "Q4_K_M"}},
        {"name": "llama3.2:latest", "size": 2_000_000_000, "details": {}},
    ]},
    "/api/ps": {"models": [
        {"name": "qwen3:1.7b", "size": 2_100_000_000, "size_vram": 2_100_000_000,
         "expires_at": "2026-10-09T01:10:00Z"},
    ]},
}


def _settings(model="qwen3:1.7b", url="http://ollama:11434", key=None):
    return SimpleNamespace(llm_api_url=url, llm_model_name=model, llm_api_key=key)


def _run(routes, settings, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        # The server may sit under a base path (e.g. https://host/base).
        body = next((value for path, value in routes.items()
                     if request.url.path.endswith(path)), None)
        if isinstance(body, Exception):
            raise body
        if body is None:
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json=body)

    async def call():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await llm_status(client, settings)

    return asyncio.run(call())


def test_ollama_reports_version_models_and_what_is_loaded():
    status = _run(OLLAMA, _settings())

    assert (status["reachable"], status["server"], status["version"]) == (True, "ollama", "0.12.3")
    assert status["configured_model"] == "qwen3:1.7b"
    assert (status["model_available"], status["model_loaded"]) == (True, True)
    assert [m["name"] for m in status["available_models"]] == ["qwen3:1.7b", "llama3.2:latest"]
    assert status["available_models"][0]["parameter_size"] == "2.0B"
    assert status["loaded_models"] == [{
        "name": "qwen3:1.7b", "size": 2_100_000_000, "size_vram": 2_100_000_000,
        "expires_at": "2026-10-09T01:10:00Z",
    }]
    assert isinstance(status["latency_ms"], int)
    assert (status["error"], status["error_code"], status["error_status"]) == (None, None, None)


def test_a_model_without_tag_matches_latest_and_a_missing_one_is_flagged():
    assert _run(OLLAMA, _settings("llama3.2"))["model_available"] is True
    missing = _run(OLLAMA, _settings("mistral:7b"))
    assert (missing["model_available"], missing["model_loaded"]) == (False, False)


def test_another_openai_compatible_server_reports_its_models():
    routes = {"/v1/models": {"data": [{"id": "qwen3-1.7b-instruct"}]}}
    status = _run(routes, _settings("qwen3-1.7b-instruct", url="http://llama:8080"))

    assert (status["reachable"], status["server"]) == (True, "openai")
    assert status["model_available"] is True
    assert status["loaded_models"] is None  # unknown outside Ollama
    assert status["model_loaded"] is None


def test_a_server_that_is_down_or_slow_is_reported():
    down = _run({"/api/version": httpx.ConnectError("refused"),
                 "/v1/models": httpx.ConnectError("refused")}, _settings())
    assert (down["reachable"], down["server"]) == (False, None)
    assert "refused" in down["error"].lower()
    assert (down["error_code"], down["error_status"]) == ("unreachable", None)

    slow = _run({"/api/version": httpx.ReadTimeout("slow"),
                 "/v1/models": httpx.ReadTimeout("slow")}, _settings())
    assert slow["reachable"] is False
    assert "5 seconds" in slow["error"]
    assert slow["error_code"] == "timeout"


def test_an_http_error_carries_its_status():
    status = _run({"/api/version": {"version": "0.12.3"}, "/api/tags": {"models": []}}, _settings())
    assert status["reachable"] is True  # /api/ps answers 404 below
    assert (status["error_code"], status["error_status"]) == ("http", 404)
    assert status["error"] == "HTTP 404 from the server."


def test_ollama_answering_but_failing_a_listing_is_still_reachable():
    routes = {**OLLAMA, "/api/ps": httpx.ReadTimeout("slow")}
    status = _run(routes, _settings())
    assert status["reachable"] is True
    assert status["error_code"] == "timeout"


def test_no_credentials_are_shown_and_the_key_is_only_sent_to_the_server():
    status = _run(OLLAMA, _settings(url="https://user:secret@llm.example:8443/base/"))
    assert status["url"] == "https://llm.example:8443/base"
    assert "secret" not in str(status)

    seen = []
    status = _run(OLLAMA, _settings(url="https://llm.example:8443/base/", key="sk-123"), seen)
    assert "sk-123" not in str(status)
    assert all(r.headers["Authorization"] == "Bearer sk-123" for r in seen)
    # Only status endpoints: nothing that would make Ollama load a model.
    assert {r.url.path for r in seen} <= {"/base/api/version", "/base/api/tags", "/base/api/ps"}
    assert all(r.method == "GET" for r in seen)


def test_display_url_keeps_scheme_host_port_and_path():
    assert display_url("http://ollama:11434") == "http://ollama:11434"
    assert display_url("http://u:p@10.0.0.5/v1") == "http://10.0.0.5/v1"
