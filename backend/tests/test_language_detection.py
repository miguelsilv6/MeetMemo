"""
Choosing the windows of speech the language is detected from (spread over the
whole recording, never repeating each other) and combining their results
into one decision with flags a reviewer can act on.
"""
import pytest
from utils.language_detection import WINDOW_SAMPLES, aggregate, speech_windows

S = 16000  # samples per second


def _length(spans):
    return sum(end - start for start, end in spans)


def test_no_speech_gives_no_window():
    assert speech_windows([], 4) == []
    assert speech_windows([{"start": 5, "end": 5}], 4) == []


def test_speech_that_fits_in_one_window_is_one_window():
    speech = [{"start": 0, "end": 5 * S}, {"start": 10 * S, "end": 20 * S}]
    assert speech_windows(speech, 4) == [[(0, 5 * S), (10 * S, 20 * S)]]


def test_windows_are_spread_from_the_start_to_the_end_of_the_speech():
    speech = [{"start": 0, "end": 600 * S}]  # ten minutes
    windows = speech_windows(speech, 4)
    assert [w[0][0] // S for w in windows] == [0, 190, 380, 570]
    assert all(_length(w) == WINDOW_SAMPLES for w in windows)


def test_there_are_no_more_windows_than_fit_apart():
    windows = speech_windows([{"start": 0, "end": 45 * S}], 8)
    assert len(windows) == 2
    assert windows[-1][-1][1] == 45 * S  # the last one ends where the speech ends


def test_a_window_is_made_of_speech_only_across_chunks():
    # Three 20-second turns with silences between them.
    speech = [{"start": 0, "end": 20 * S}, {"start": 50 * S, "end": 70 * S},
              {"start": 100 * S, "end": 120 * S}]
    windows = speech_windows(speech, 2)
    assert windows[0] == [(0, 20 * S), (50 * S, 60 * S)]
    assert windows[1] == [(60 * S, 70 * S), (100 * S, 120 * S)]


def _window(start, probs, speech=30.0):
    return {"start": start, "end": start + 30, "speech": speech, "probs": probs}


def test_windows_are_averaged_into_one_decision():
    result = aggregate([
        _window(0, [("es", 0.55), ("pt", 0.40), ("gl", 0.05)]),
        _window(100, [("pt", 0.95), ("es", 0.03), ("gl", 0.02)]),
        _window(200, [("pt", 0.93), ("gl", 0.05), ("es", 0.02)]),
    ])
    assert result["language"] == "pt"
    assert result["probability"] == pytest.approx((0.40 + 0.95 + 0.93) / 3, abs=1e-4)
    assert [c[0] for c in result["candidates"]] == ["pt", "es", "gl"]
    assert [w["language"] for w in result["windows"]] == ["es", "pt", "pt"]
    assert result["agreement"] == pytest.approx(2 / 3, abs=1e-4)
    assert result["flags"] == []


def test_windows_with_more_speech_weigh_more():
    result = aggregate([_window(0, [("ro", 0.9), ("pt", 0.1)], speech=5),
                        _window(30, [("pt", 0.8), ("ro", 0.2)], speech=30)])
    assert result["language"] == "pt"


def test_two_confident_languages_are_flagged_as_mixed():
    result = aggregate([_window(0, [("pt", 0.95)]), _window(30, [("ar", 0.9)])])
    assert "mixed_languages" in result["flags"]


def test_weak_evidence_is_flagged():
    # What creole tends to look like: Portuguese, but never with conviction.
    result = aggregate([_window(0, [("pt", 0.42), ("es", 0.3)]),
                        _window(30, [("pt", 0.45), ("gl", 0.3)])])
    assert result["language"] == "pt"
    assert result["flags"] == ["uncertain", "possibly_unsupported"]


def test_nothing_to_decide_from():
    assert aggregate([]) is None
    assert aggregate([{"start": 0, "end": 30, "speech": 30, "probs": []}]) is None
