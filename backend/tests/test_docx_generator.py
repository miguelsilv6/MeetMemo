"""Tests for the DOCX transcript export generator."""
from types import SimpleNamespace

import pytest

pytest.importorskip("docx")

from docx import Document
from utils.docx_generator import generate_transcript_docx

# generated_on is always passed explicitly below, so settings.timezone is
# never touched; this stub avoids needing a fully-configured Settings()
# (which requires DATABASE_URL, LLM_API_URL, etc. from the environment).
_STUB_SETTINGS = SimpleNamespace()


def _paragraph_texts(buffer):
    document = Document(buffer)
    return [p.text for p in document.paragraphs]


def test_generates_one_dialogue_line_per_segment():
    transcript = [
        {"speaker": "SPEAKER_00", "text": "Ola", "start": "0.00", "end": "1.00"},
        {"speaker": "SPEAKER_01", "text": "Boa tarde", "start": "1.00", "end": "2.00"},
    ]

    buffer = generate_transcript_docx(
        "Team Meeting", transcript, generated_on="Jan 1, 2026", settings=_STUB_SETTINGS
    )

    texts = _paragraph_texts(buffer)
    assert "Speaker 1: Ola" in texts
    assert "Speaker 2: Boa tarde" in texts


def test_preserves_chronological_order_and_repeated_speakers():
    transcript = [
        {"speaker": "SPEAKER_00", "text": "Como estas?", "start": "0.00", "end": "1.00"},
        {"speaker": "SPEAKER_01", "text": "Estou bem, e tu?", "start": "1.00", "end": "2.00"},
        {"speaker": "SPEAKER_01", "text": "Estas a trabalhar?", "start": "2.00", "end": "3.00"},
    ]

    buffer = generate_transcript_docx(
        "Team Meeting", transcript, generated_on="Jan 1, 2026", settings=_STUB_SETTINGS
    )

    texts = [t for t in _paragraph_texts(buffer) if t]
    dialogue_lines = texts[-3:]
    assert dialogue_lines == [
        "Speaker 1: Como estas?",
        "Speaker 2: Estou bem, e tu?",
        "Speaker 2: Estas a trabalhar?",
    ]


def test_respects_manually_renamed_speakers():
    transcript = [{"speaker": "Moderator", "text": "Welcome", "start": "0.00", "end": "1.00"}]

    buffer = generate_transcript_docx(
        "Team Meeting", transcript, generated_on="Jan 1, 2026", settings=_STUB_SETTINGS
    )

    assert "Moderator: Welcome" in _paragraph_texts(buffer)


def test_skips_empty_text_segments():
    transcript = [
        {"speaker": "SPEAKER_00", "text": "", "start": "0.00", "end": "1.00"},
        {"speaker": "SPEAKER_00", "text": "Hello", "start": "1.00", "end": "2.00"},
    ]

    buffer = generate_transcript_docx(
        "Team Meeting", transcript, generated_on="Jan 1, 2026", settings=_STUB_SETTINGS
    )

    texts = [t for t in _paragraph_texts(buffer) if t]
    assert texts.count("Speaker 1: Hello") == 1
    assert not any(t.startswith("Speaker 1: ") and t != "Speaker 1: Hello" for t in texts)
