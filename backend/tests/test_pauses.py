"""Segments are cut where two words are far apart (a pause the VAD removed)."""
from utils.pauses import split_at_pauses, split_segments_at_pauses


def _word(start, end, word, probability=0.9):
    return {"start": start, "end": end, "word": word, "probability": probability}


def _segment(words, **fields):
    return {"id": 1, "start": words[0]["start"] if words else 0.0,
            "end": words[-1]["end"] if words else 5.0,
            "text": "".join(w["word"] for w in words) or " sem palavras",
            "avg_logprob": -0.3, "no_speech_prob": 0.05, "compression_ratio": 1.1,
            "words": words, **fields}


def test_a_segment_across_a_long_pause_is_cut_there():
    segment = _segment([_word(10.0, 10.4, " Sim."), _word(29.6, 29.9, " Está"),
                        _word(29.9, 30.2, " bem.")])

    parts = split_at_pauses(segment)

    assert [(p["start"], p["end"], p["text"]) for p in parts] == [
        (10.0, 10.4, " Sim."), (29.6, 30.2, " Está bem.")]
    assert [len(p["words"]) for p in parts] == [1, 2]
    # The decoding metrics stay with every part (low-confidence flags use them).
    assert all(p["avg_logprob"] == -0.3 and p["no_speech_prob"] == 0.05
               and p["compression_ratio"] == 1.1 for p in parts)


def test_short_pauses_keep_the_segment_whole():
    segment = _segment([_word(1.0, 1.5, " Bom"), _word(3.4, 3.8, " dia.")])

    assert split_at_pauses(segment) == [segment]


def test_a_segment_without_words_is_kept_as_it_is():
    segment = _segment([])

    assert split_at_pauses(segment) == [segment]


def test_the_parts_are_numbered_in_order():
    segments = [
        _segment([_word(0.0, 0.5, " Olá."), _word(8.0, 8.5, " Sim.")], id=1),
        _segment([_word(9.0, 9.5, " Pois."), _word(9.6, 10.0, " Claro.")], id=2),
    ]

    parts = split_segments_at_pauses(segments)

    assert [(p["id"], p["text"]) for p in parts] == [
        (1, " Olá."), (2, " Sim."), (3, " Pois. Claro.")]
