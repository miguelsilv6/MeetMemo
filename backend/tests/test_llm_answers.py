"""
How LLM answers are requested and read: Qwen3's thinking is switched off,
reasoning is never taken for the answer, and an unusable answer says why.

The empty-answer case reproduces what Ollama returned for qwen3:1.7b: the
whole 500-token budget spent on `reasoning`, `content` empty and
`finish_reason: "length"`.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from services.summary_service import QWEN3_NO_THINK, UNDETERMINED_SPEAKER, SummaryService

TRANSCRIPT = (
    "SPEAKER_00: Bom dia, fala a Ana do apoio ao cliente, em que posso ajudar hoje?\n"
    "SPEAKER_01: Bom dia, o meu nome é João Silva e a minha encomenda não chegou."
)


def _settings(model="qwen3:1.7b"):
    return SimpleNamespace(
        llm_api_url="http://fake-llm",
        llm_model_name=model,
        llm_api_key=None,
        llm_json_mode=True,
        llm_timeout=60.0,
    )


class _Response:
    def __init__(self, message, finish_reason):
        self._data = {"choices": [{"message": message, "finish_reason": finish_reason}]}

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class _Client:
    """Returns a canned chat completion and records each request payload."""

    def __init__(self, content, finish_reason="stop", reasoning=None):
        self.message = {"role": "assistant", "content": content}
        if reasoning is not None:
            self.message["reasoning"] = reasoning
        self.finish_reason = finish_reason
        self.payloads = []

    async def post(self, url, headers=None, json=None, timeout=None):
        self.payloads.append(json)
        return _Response(self.message, self.finish_reason)


def _user_prompt(client):
    return client.payloads[-1]["messages"][-1]["content"]


# --- Qwen3 thinking ------------------------------------------------------------


@pytest.mark.parametrize("model", ["qwen3:1.7b", "Qwen3-8B-Instruct"])
def test_qwen3_requests_switch_thinking_off(model):
    client = _Client('{"SPEAKER_00": "Ana"}')
    service = SummaryService(client, _settings(model))

    asyncio.run(service.identify_speakers(TRANSCRIPT))
    asyncio.run(service.summarize(TRANSCRIPT))
    client.message["content"] = '[{"i": 0, "text": "Bom dia"}]'
    asyncio.run(service.translate_segments([{"speaker": "A", "text": "Good morning"}]))

    assert len(client.payloads) == 3
    for payload in client.payloads:
        assert payload["messages"][-1]["content"].endswith(QWEN3_NO_THINK)


def test_other_models_get_no_qwen_switch():
    client = _Client('{"SPEAKER_00": "Ana"}')
    asyncio.run(SummaryService(client, _settings("llama3.1:8b")).identify_speakers(TRANSCRIPT))

    assert QWEN3_NO_THINK not in _user_prompt(client)


# --- Speaker identification ----------------------------------------------------


def test_budget_spent_on_reasoning_explains_the_cut_off():
    # What Ollama returned for qwen3:1.7b.
    client = _Client("", finish_reason="length", reasoning="Okay, let's see. The user...")
    result = asyncio.run(SummaryService(client, _settings()).identify_speakers(TRANSCRIPT))

    assert result["status"] == "error"
    assert result["message"] == (
        "Could not read speaker suggestions: the model's answer was cut off because it "
        "reached its output limit before finishing."
    )


def test_an_empty_answer_is_reported_as_such():
    client = _Client("")
    result = asyncio.run(SummaryService(client, _settings()).identify_speakers(TRANSCRIPT))

    assert result["message"] == "Could not read speaker suggestions: the model returned an empty answer."


def test_inline_reasoning_is_ignored_even_when_it_contains_json():
    # The reasoning quotes a wrong mapping before the real answer.
    client = _Client(
        '<think>Maybe {"SPEAKER_00": "John"}? No, she says she is Ana.</think>\n'
        '{"SPEAKER_00": "Ana (apoio ao cliente)", "SPEAKER_01": "João Silva"}'
    )
    result = asyncio.run(SummaryService(client, _settings()).identify_speakers(TRANSCRIPT))

    assert result == {
        "status": "success",
        "suggestions": {"SPEAKER_00": "Ana (apoio ao cliente)", "SPEAKER_01": "João Silva"},
    }


def test_identification_prompt_asks_for_names_from_the_transcript_only():
    client = _Client('{"SPEAKER_00": "Ana"}')
    asyncio.run(SummaryService(client, _settings()).identify_speakers(TRANSCRIPT))

    payload = client.payloads[-1]
    system, user = payload["messages"][0]["content"], payload["messages"][1]["content"]
    prompts = system + user
    # No placeholder names for a small model to copy.
    assert "John" not in prompts and "Sarah" not in prompts
    assert "Never invent or guess names" in system
    assert f'"{UNDETERMINED_SPEAKER}"' in system
    assert f'"SPEAKER_01": "{UNDETERMINED_SPEAKER}"' in user
    assert payload["max_tokens"] == 2000


# --- Summary and translation ---------------------------------------------------


def test_summary_never_contains_reasoning():
    client = _Client("<think>\n\n</think>\n\n# Resumo\n\nA Ana atendeu o João.")
    summary = asyncio.run(SummaryService(client, _settings()).summarize(TRANSCRIPT))

    assert summary == "# Resumo\n\nA Ana atendeu o João."


def test_an_empty_summary_is_an_error_not_a_blank_summary():
    client = _Client("", finish_reason="length", reasoning="Thinking...")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(SummaryService(client, _settings()).summarize(TRANSCRIPT))

    assert excinfo.value.status_code == 502
    assert "cut off" in excinfo.value.detail


def test_a_translation_cut_off_mid_reasoning_says_so():
    client = _Client("<think>Let me translate each line carefully", finish_reason="length")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            SummaryService(client, _settings()).translate_segments(
                [{"speaker": "A", "text": "Good morning"}]
            )
        )

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == (
        "Could not read the translated transcript: the model's answer was cut off because "
        "it reached its output limit before finishing."
    )
