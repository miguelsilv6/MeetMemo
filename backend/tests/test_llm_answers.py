"""
How LLM answers are requested and read: Qwen3's thinking is switched off,
reasoning is never taken for the answer, and an unusable answer says why.

The cut-off cases reproduce what Ollama returned for qwen3:1.7b: the whole
token budget spent on `reasoning`, `content` empty and
`finish_reason: "length"`.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from services.summary_service import QWEN3_NO_THINK, SummaryService

TRANSCRIPT = (
    "SPEAKER_00: Bom dia, fala a Ana do apoio ao cliente, em que posso ajudar hoje?\n"
    "SPEAKER_01: Bom dia, o meu nome é João Silva e a minha encomenda não chegou."
)


def _settings(model="qwen3:1.7b"):
    return SimpleNamespace(
        llm_api_url="http://fake-llm",
        llm_model_name=model,
        llm_api_key=None,
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
    client = _Client("# Resumo")
    service = SummaryService(client, _settings(model))

    asyncio.run(service.summarize(TRANSCRIPT))
    client.message["content"] = '[{"i": 0, "text": "Bom dia"}]'
    asyncio.run(service.translate_segments([{"speaker": "A", "text": "Good morning"}]))

    assert len(client.payloads) == 2
    for payload in client.payloads:
        assert payload["messages"][-1]["content"].endswith(QWEN3_NO_THINK)


def test_other_models_get_no_qwen_switch():
    client = _Client("# Resumo")
    asyncio.run(SummaryService(client, _settings("llama3.1:8b")).summarize(TRANSCRIPT))

    assert QWEN3_NO_THINK not in _user_prompt(client)


# --- Summary and translation ---------------------------------------------------


def test_summary_never_contains_reasoning():
    client = _Client("<think>\n\n</think>\n\n# Resumo\n\nA Ana atendeu o João.")
    summary = asyncio.run(SummaryService(client, _settings()).summarize(TRANSCRIPT))

    assert summary == "# Resumo\n\nA Ana atendeu o João."


def test_an_empty_summary_is_reported_as_such():
    client = _Client("")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(SummaryService(client, _settings()).summarize(TRANSCRIPT))

    assert excinfo.value.detail == (
        "Could not generate the summary: the model returned an empty answer."
    )


def test_a_translation_with_inline_reasoning_uses_only_the_answer():
    # The reasoning quotes a wrong translation before the real answer.
    client = _Client(
        '<think>Maybe [{"i": 0, "text": "Bom dia, pá"}]? No.</think>\n'
        '[{"i": 0, "text": "Bom dia"}]'
    )
    result = asyncio.run(
        SummaryService(client, _settings()).translate_segments(
            [{"speaker": "A", "text": "Good morning"}]
        )
    )

    assert result == [{"speaker": "A", "text": "Bom dia"}]


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


# --- Summary wrapped in a code block ---------------------------------------------

FENCED_SUMMARY = """```markdown
# Resumo da Reunião

**Participantes:**
- **Yuri**
- **Restaurante**

1. **Yuri** marcou uma mesa para **nove pessoas**.

```"""


def test_a_summary_wrapped_in_a_code_block_is_unwrapped():
    # What qwen3:1.7b returned, which the UI showed as raw code.
    client = _Client(FENCED_SUMMARY)
    summary = asyncio.run(SummaryService(client, _settings()).summarize(TRANSCRIPT))

    assert summary.startswith("# Resumo da Reunião")
    assert "```" not in summary
    assert summary.endswith("1. **Yuri** marcou uma mesa para **nove pessoas**.")


def test_code_blocks_inside_a_summary_are_kept():
    answer = "# Resumo\n\nComando referido:\n\n```\nls -la\n```\n\nFim."
    summary = asyncio.run(SummaryService(_Client(answer), _settings()).summarize(TRANSCRIPT))

    assert summary == answer


def test_cached_summaries_from_before_are_unwrapped_when_read(tmp_path):
    (tmp_path / "job1.txt").write_text(FENCED_SUMMARY, encoding="utf-8")
    settings = _settings()
    settings.summary_path = tmp_path

    cached = asyncio.run(SummaryService(_Client(""), settings).get_cached_summary("job1"))

    assert cached.startswith("# Resumo da Reunião")
    assert "```" not in cached
