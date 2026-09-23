"""Unit tests for the tolerant translated-segment extraction."""
from services.summary_service import _extract_translated_texts


def test_clean_json_array():
    content = '[{"i": 0, "text": "Ola"}, {"i": 1, "text": "Mundo"}]'
    assert _extract_translated_texts(content, 2) == ["Ola", "Mundo"]


def test_json_fenced_code_block():
    content = 'Sure!\n```json\n[{"i": 0, "text": "Ola"}]\n```\nHope that helps.'
    assert _extract_translated_texts(content, 1) == ["Ola"]


def test_plain_fenced_code_block():
    content = '```\n[{"i": 0, "text": "Ola"}, {"i": 1, "text": "Mundo"}]\n```'
    assert _extract_translated_texts(content, 2) == ["Ola", "Mundo"]


def test_array_embedded_in_prose():
    content = 'Here is the translation: [{"i": 0, "text": "Ola"}] — done.'
    assert _extract_translated_texts(content, 1) == ["Ola"]


def test_out_of_order_indices_are_reordered():
    content = '[{"i": 1, "text": "Mundo"}, {"i": 0, "text": "Ola"}]'
    assert _extract_translated_texts(content, 2) == ["Ola", "Mundo"]


def test_wrong_count_returns_none():
    content = '[{"i": 0, "text": "Ola"}]'
    assert _extract_translated_texts(content, 2) is None


def test_missing_index_returns_none():
    content = '[{"i": 0, "text": "Ola"}, {"i": 2, "text": "Mundo"}]'
    assert _extract_translated_texts(content, 2) is None


def test_unparseable_returns_none():
    assert _extract_translated_texts("I could not translate this.", 1) is None
    assert _extract_translated_texts("", 1) is None
    assert _extract_translated_texts("[not valid json]", 1) is None


def test_prefers_valid_array_over_earlier_non_matching_array():
    content = 'Config: [1, 2, 3]\nTranslation: [{"i": 0, "text": "Ola"}]'
    assert _extract_translated_texts(content, 1) == ["Ola"]
