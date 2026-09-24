"""Tests for post-transcription hallucination filtering."""
from utils.hallucination_filter import (
    filter_segments,
    is_known_hallucination,
    is_low_confidence,
    normalize_text,
)


def test_normalize_strips_accents_punctuation_and_case():
    assert normalize_text("  Não, se ESQUEÇA!  ") == "nao se esqueca"


def test_detects_amara_credit_in_any_form():
    assert is_known_hallucination("Legendas pela comunidade Amara.org")
    assert is_known_hallucination("Sous-titres réalisés par la communauté d'Amara.org")


def test_detects_whole_segment_sign_offs():
    assert is_known_hallucination("Obrigado por assistir!")
    assert is_known_hallucination("Inscreva-se no canal.")
    assert is_known_hallucination("Thanks for watching.")


def test_detects_subtitle_credit_lines():
    assert is_known_hallucination("Legendado por Maria Silva")
    assert is_known_hallucination("Tradução e legendas por João")


def test_keeps_genuine_speech_that_only_resembles_a_hallucination():
    # Plain courtesy words are real speech in a call, not artifacts.
    assert not is_known_hallucination("Obrigado.")
    assert not is_known_hallucination("Obrigado por ter ligado, até amanhã.")
    assert not is_known_hallucination("Legendas, por favor.")
    assert not is_known_hallucination("Então fica combinado para quinta.")


def test_low_confidence_from_any_decoder_quality_signal():
    assert is_low_confidence({"avg_logprob": -1.5, "no_speech_prob": 0.1, "compression_ratio": 1.2})
    assert is_low_confidence({"avg_logprob": -0.2, "no_speech_prob": 0.9, "compression_ratio": 1.2})
    assert is_low_confidence({"avg_logprob": -0.2, "no_speech_prob": 0.1, "compression_ratio": 3.1})
    assert not is_low_confidence({"avg_logprob": -0.2, "no_speech_prob": 0.1, "compression_ratio": 1.2})


def test_low_confidence_ignores_missing_signals():
    assert not is_low_confidence({})


def test_filter_removes_hallucinations_and_empty_segments_and_flags_the_rest():
    segments = [
        {"text": " Bom dia, fala o Carlos.", "avg_logprob": -0.3, "no_speech_prob": 0.05, "compression_ratio": 1.1},
        {"text": " Legendas pela comunidade Amara.org", "avg_logprob": -0.4, "no_speech_prob": 0.8, "compression_ratio": 1.0},
        {"text": " ...", "avg_logprob": -0.9, "no_speech_prob": 0.7, "compression_ratio": 1.0},
        {"text": " Não percebi bem.", "avg_logprob": -1.4, "no_speech_prob": 0.2, "compression_ratio": 1.3},
    ]

    kept, removed = filter_segments(segments)

    assert [s["text"] for s in kept] == [" Bom dia, fala o Carlos.", " Não percebi bem."]
    assert [s["low_confidence"] for s in kept] == [False, True]
    assert [s["removed_reason"] for s in removed] == ["known_hallucination", "empty"]
