"""
The LLM prompts edited in the admin panel: validation, storage, and use in
summaries and translations. The translation's JSON contract and Qwen3's
no-think switch stay fixed whatever is edited.
"""
import asyncio
from types import SimpleNamespace

import pytest
from llm_prompts import (
    DEFAULT_SUMMARY_REQUEST,
    DEFAULT_SUMMARY_SYSTEM_PROMPT,
    EUROPEAN_PORTUGUESE_RULE,
    QWEN3_NO_THINK,
    TRANSLATION_OUTPUT_CONTRACT,
)
from pydantic import ValidationError
from runtime_settings import (
    PROMPT_FIELDS,
    RuntimeSettings,
    merge_stored,
    storable_settings,
)
from services.summary_service import SummaryService

TRANSCRIPT = (
    "SPEAKER_00: Bom dia, fala a Ana do apoio ao cliente, em que posso ajudar hoje?\n"
    "SPEAKER_01: Bom dia, o meu nome é João Silva e a minha encomenda não chegou."
)


def _settings(**prompts):
    return RuntimeSettings(whisper_model_name="large-v3", **prompts)


class _Runtime:
    """Stands in for RuntimeSettingsService."""

    def __init__(self, settings):
        self.settings = settings

    async def get(self):
        return self.settings


class _Response:
    def __init__(self, content):
        self._content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self._content}, "finish_reason": "stop"}]}


class _Client:
    def __init__(self, content="# Resumo"):
        self.content = content
        self.payloads = []

    async def post(self, url, headers=None, json=None, timeout=None):
        self.payloads.append(json)
        return _Response(self.content)


def _service(client, runtime=None, model="qwen3:1.7b"):
    config = SimpleNamespace(
        llm_api_url="http://fake-llm", llm_model_name=model, llm_api_key=None, llm_timeout=60.0
    )
    return SummaryService(client, config, runtime)


def _messages(client):
    system, user = client.payloads[-1]["messages"]
    return system["content"], user["content"]


# --- Validation and storage ---------------------------------------------------


def test_defaults_are_the_built_in_prompts():
    settings = _settings()
    assert settings.llm_summary_system_prompt == DEFAULT_SUMMARY_SYSTEM_PROMPT
    assert settings.llm_language_rule == EUROPEAN_PORTUGUESE_RULE


@pytest.mark.parametrize("blank", ["", "   \n ", None])
def test_a_blank_prompt_means_the_default(blank):
    assert _settings(llm_summary_request=blank).llm_summary_request == DEFAULT_SUMMARY_REQUEST


def test_prompts_are_trimmed_with_unix_line_endings():
    settings = _settings(llm_summary_request="  Linha 1\r\nLinha 2\r\n ")
    assert settings.llm_summary_request == "Linha 1\nLinha 2"


def test_overlong_prompts_are_rejected():
    with pytest.raises(ValidationError):
        _settings(llm_summary_system_prompt="x" * 8001)


def test_only_edited_prompts_are_stored():
    defaults = _settings()
    edited = _settings(llm_language_reminder="Responde em PT-PT.")

    stored = storable_settings(edited, defaults)

    assert stored["llm_language_reminder"] == "Responde em PT-PT."
    assert not set(PROMPT_FIELDS) - {"llm_language_reminder"} & set(stored)
    assert stored["beam_size"] == 5  # other settings are stored as before
    # Unstored prompts come back as the (possibly newer) defaults.
    assert merge_stored(defaults, stored) == edited


# --- Summaries -----------------------------------------------------------------


def test_the_summary_uses_the_saved_prompts():
    client = _Client()
    runtime = _Runtime(
        _settings(
            llm_summary_system_prompt="Sistema editado.",
            llm_summary_request="Pedido editado.",
            llm_language_rule="Regra editada.",
            llm_language_reminder="Lembrete editado.",
        )
    )

    asyncio.run(_service(client, runtime).summarize(TRANSCRIPT))

    system, user = _messages(client)
    assert system == "Sistema editado.\n\nRegra editada."
    assert user == (
        f"Pedido editado.\n\n{TRANSCRIPT}\n\nLembrete editado.\n\n{QWEN3_NO_THINK}"
    )


def test_an_edit_applies_to_the_next_summary():
    client = _Client()
    runtime = _Runtime(_settings())
    service = _service(client, runtime)

    asyncio.run(service.summarize(TRANSCRIPT))
    assert _messages(client)[0].startswith(DEFAULT_SUMMARY_SYSTEM_PROMPT)

    runtime.settings = _settings(llm_summary_system_prompt="Novo sistema.")
    asyncio.run(service.summarize(TRANSCRIPT))
    assert _messages(client)[0].startswith("Novo sistema.")


def test_a_per_request_prompt_still_gets_the_saved_language_rule():
    client = _Client()
    runtime = _Runtime(_settings(llm_language_rule="Regra editada."))

    asyncio.run(
        _service(client, runtime).summarize(
            TRANSCRIPT, custom_prompt="Pedido do pedido.", system_prompt="Sistema do pedido."
        )
    )

    system, user = _messages(client)
    assert system == "Sistema do pedido.\n\nRegra editada."
    assert user.startswith(f"Pedido do pedido.\n\n{TRANSCRIPT}")


def test_without_saved_settings_the_defaults_are_used():
    client = _Client()
    asyncio.run(_service(client).summarize(TRANSCRIPT))

    system, user = _messages(client)
    assert system == f"{DEFAULT_SUMMARY_SYSTEM_PROMPT}\n\n{EUROPEAN_PORTUGUESE_RULE}"
    assert user.startswith(f"{DEFAULT_SUMMARY_REQUEST}\n\n{TRANSCRIPT}")


# --- Translations --------------------------------------------------------------


def test_the_translation_keeps_its_fixed_contract_around_edited_instructions():
    client = _Client('[{"i": 0, "text": "Bom dia"}]')
    runtime = _Runtime(
        _settings(
            llm_translation_instructions="Traduz para português europeu.",
            llm_language_rule="Regra editada.",
        )
    )

    result = asyncio.run(
        _service(client, runtime).translate_segments([{"speaker": "A", "text": "Good morning"}])
    )

    system, user = _messages(client)
    assert system == (
        f"Traduz para português europeu. {TRANSLATION_OUTPUT_CONTRACT}\n\nRegra editada."
    )
    assert user.endswith(QWEN3_NO_THINK)
    assert result == [{"speaker": "A", "text": "Bom dia"}]
