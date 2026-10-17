"""
Speakers word by word: a segment is split where the speaker changes, a run
too short to trust joins its neighbour, words in a pause go with the words
around them, and a segment without words (or with one speaker) stays whole.
"""
from utils.word_alignment import speaker_runs, split_by_speaker

TURNS = [{"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"},
         {"start": 2.0, "end": 5.0, "speaker": "SPEAKER_01"}]


def _words(*spec):
    return [{"start": s, "end": e, "word": w, "probability": 0.9} for s, e, w in spec]


def test_a_segment_is_split_where_the_speaker_changes():
    segment = {"start": 0.2, "end": 4.0, "text": " Está? Sim, sou eu.", "low_confidence": True,
               "words": _words((0.2, 0.8, " Está"), (0.8, 1.6, "?"), (2.2, 2.6, " Sim,"),
                               (2.6, 3.2, " sou"), (3.2, 4.0, " eu."))}

    parts = split_by_speaker(segment, TURNS)

    assert [(p["speaker"], p["text"], p["start"], p["end"]) for p in parts] == [
        ("SPEAKER_00", "Está?", 0.2, 1.6), ("SPEAKER_01", "Sim, sou eu.", 2.2, 4.0)]
    assert [len(p["words"]) for p in parts] == [2, 3]
    assert all(p["low_confidence"] for p in parts)


def test_a_single_stray_word_joins_its_neighbours():
    turns = TURNS + [{"start": 5.0, "end": 9.0, "speaker": "SPEAKER_00"}]
    # " ok" falls inside SPEAKER_01's turn, but one short word is not a turn.
    words = _words((4.6, 4.9, " ok"), (5.0, 5.5, " Então"), (5.5, 6.0, " amanhã"),
                   (6.0, 6.3, " às"), (6.3, 6.6, " dez"))
    runs = speaker_runs(words, turns, "SPEAKER_00")
    assert [r["speaker"] for r in runs] == ["SPEAKER_00"]
    assert len(runs[0]["words"]) == 5


def test_words_in_a_pause_go_with_the_words_around_them():
    turns = [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_01"},
             {"start": 3.0, "end": 6.0, "speaker": "SPEAKER_01"}]
    words = _words((0.2, 0.8, " Bom"), (1.5, 2.5, " dia"), (3.2, 3.8, " a"), (3.8, 4.2, " todos"))
    assert [r["speaker"] for r in speaker_runs(words, turns, "SPEAKER_00")] == ["SPEAKER_01"]


def test_one_speaker_or_no_words_keeps_the_segment_whole():
    one = {"start": 0.0, "end": 1.9, "text": " Está bem.",
           "words": _words((0.1, 0.9, " Está"), (0.9, 1.8, " bem."))}
    assert split_by_speaker(one, TURNS) == [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.9,
                                             "text": "Está bem.", "words": one["words"]}]
    bare = {"start": 1.0, "end": 4.0, "text": " Sem palavras."}
    assert split_by_speaker(bare, TURNS) == [{"speaker": "SPEAKER_01", "start": 1.0, "end": 4.0,
                                              "text": "Sem palavras.", "words": []}]
    assert split_by_speaker(bare, [])[0]["speaker"] == "SPEAKER_00"
