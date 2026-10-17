"""
Scoring transcription reliability: WER/CER against a reference (case and
punctuation ignored, accents kept), language hits, benchmark discovery, and a
report that records failures instead of stopping the run.
"""
import csv
import io
from itertools import count

import pytest
from utils.asr_evaluation import (
    Sample,
    discover_samples,
    edit_distance,
    error_counts,
    evaluate_sample,
    normalize_for_scoring,
    render_csv,
    render_markdown,
    summarize,
)


def test_scoring_ignores_case_and_punctuation_but_not_accents():
    assert normalize_for_scoring("Olá, João!  Está?") == "olá joão está"
    assert error_counts("Olá, João!", "olá joão")["word_errors"] == 0
    assert error_counts("ele é", "ele e")["word_errors"] == 1


def test_edit_distance_counts_substitutions_insertions_and_deletions():
    assert edit_distance("kitten", "sitting") == 3
    assert edit_distance([], ["a"]) == 1
    assert edit_distance(["a", "b", "c"], ["a", "c"]) == 1
    assert edit_distance(["a"], ["a", "b", "c"]) == 2


def test_word_and_character_errors():
    counts = error_counts("o carro é azul", "o carro azul claro")
    assert (counts["ref_words"], counts["word_errors"]) == (4, 2)
    assert counts["ref_chars"] == len("o carro é azul")


def test_samples_are_found_with_their_reference_and_language(tmp_path):
    (tmp_path / "b.mp3").write_bytes(b"x")
    (tmp_path / "a.wav").write_bytes(b"x")
    (tmp_path / "a.txt").write_text("﻿Bom dia.", encoding="utf-8")
    (tmp_path / "a.lang").write_text("\n PT \n", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("not audio", encoding="utf-8")
    (tmp_path / "results").mkdir()

    samples = discover_samples(tmp_path)

    assert [s.name for s in samples] == ["a.wav", "b.mp3"]
    assert (samples[0].reference, samples[0].expected_language) == ("Bom dia.", "pt")
    assert (samples[1].reference, samples[1].expected_language) == (None, None)


def _clock(step=2.0):
    ticks = count()
    return lambda: next(ticks) * step


TRANSCRIPT = {
    "segments": [
        {"text": " Bom dia,", "low_confidence": False},
        {"text": " como está?", "low_confidence": True},
    ],
    "removed_segments": [{"text": " Obrigado por assistir."}],
    "language": "pt",
    "language_probability": 0.93,
    "duration": 10.0,
}


def test_a_sample_is_transcribed_and_scored():
    sample = Sample("call.wav", None, reference="Bom dia, como estás?", expected_language="pt")
    result = evaluate_sample(sample, lambda s: TRANSCRIPT, clock=_clock())

    assert result.hypothesis == "Bom dia, como está?"
    assert (result.ref_words, result.word_errors) == (4, 1)
    assert result.wer == pytest.approx(0.25)
    assert result.language_correct is True
    assert (result.segments, result.low_confidence, result.removed) == (2, 1, 1)
    assert (result.seconds, result.real_time_factor) == (2.0, 0.2)


def test_a_failure_is_recorded_and_the_run_goes_on():
    def broken(_sample):
        raise RuntimeError("ffmpeg failed")

    failed = evaluate_sample(Sample("bad.wav", None, expected_language="pt"), broken,
                             clock=_clock())
    good = evaluate_sample(Sample("ok.wav", None, reference="bom dia como está",
                                  expected_language="ro"), lambda s: TRANSCRIPT, clock=_clock())

    assert failed.error == "ffmpeg failed"
    assert failed.language_correct is None
    assert good.language_correct is False  # detected pt, expected ro

    summary = summarize([failed, good])
    assert (summary["files"], summary["failed"], summary["scored"]) == (2, 1, 1)
    assert summary["wer"] == pytest.approx(0.0)
    assert (summary["language_checked"], summary["language_correct"]) == (1, 0)

    report = render_markdown([failed, good], summary, {"Model": "large-v3"})
    assert "- **Model:** large-v3" in report
    assert "**error:** ffmpeg failed" in report
    assert "| ok.wav | 10.0s | 2.0s | 0.20 | ro | pt (93%) | ✗ | 0.0% |" in report


def test_corpus_wer_weights_files_by_reference_length():
    short = evaluate_sample(Sample("s.wav", None, reference="um dois"),
                            lambda s: {"segments": [{"text": "um"}]})
    long = evaluate_sample(Sample("l.wav", None, reference="um dois três quatro cinco seis"),
                           lambda s: {"segments": [{"text": "um dois três quatro cinco seis"}]})
    assert short.wer == pytest.approx(0.5)
    assert summarize([short, long])["wer"] == pytest.approx(1 / 8)


def test_csv_has_one_row_per_file():
    result = evaluate_sample(Sample("call.wav", None, reference="bom dia como está",
                                    expected_language="pt"),
                             lambda s: TRANSCRIPT, clock=_clock())
    rows = list(csv.DictReader(io.StringIO(render_csv([result]))))
    assert len(rows) == 1
    assert rows[0]["file"] == "call.wav"
    assert rows[0]["language_correct"] == "1"
    assert float(rows[0]["wer"]) == 0.0
