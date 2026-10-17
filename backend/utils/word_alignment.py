"""
Speakers word by word.

A Whisper segment can span a change of speaker ("— Está? — Sim, sou eu."), and
giving the whole segment the speaker that overlaps it most puts the second
speaker's words in the first speaker's mouth. Each word is given the speaker
whose diarization turn overlaps it most, and the segment is split where the
speaker changes. A run too short to trust (fewer than two words or half a
second) joins its neighbour, since a single word assigned elsewhere is more
often a diarization boundary that is slightly off than a real interjection.
"""
from typing import Optional

MIN_RUN_WORDS = 2
MIN_RUN_SECONDS = 0.5


def speaker_at(start: float, end: float, turns: list[dict]) -> Optional[str]:
    """The speaker whose turn overlaps [start, end] most, or None if none does."""
    best, best_overlap = None, 0.0
    for turn in turns:
        overlap = min(end, turn["end"]) - max(start, turn["start"])
        if overlap > best_overlap:
            best, best_overlap = turn["speaker"], overlap
    return best


def _too_short(run: dict) -> bool:
    words = run["words"]
    return len(words) < MIN_RUN_WORDS or words[-1]["end"] - words[0]["start"] < MIN_RUN_SECONDS


def _merge_adjacent(runs: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for run in runs:
        if merged and merged[-1]["speaker"] == run["speaker"]:
            merged[-1]["words"] += run["words"]
        else:
            merged.append({"speaker": run["speaker"], "words": list(run["words"])})
    return merged


def speaker_runs(words: list[dict], turns: list[dict], fallback: str) -> list[dict]:
    """Consecutive words of one speaker: ``[{"speaker", "words"}]``."""
    labels = [speaker_at(w["start"], w["end"], turns) for w in words]
    # A word outside every turn (a pause) belongs with the words around it.
    for i, label in enumerate(labels):
        if label is None:
            labels[i] = labels[i - 1] if i else None
    nxt = next((label for label in labels if label), fallback)
    labels = [label or nxt for label in labels]

    runs = _merge_adjacent([{"speaker": s, "words": [w]} for s, w in zip(labels, words)])
    # Fold the shortest unreliable run into a neighbour until none is left.
    while len(runs) > 1:
        short = [i for i, run in enumerate(runs) if _too_short(run)]
        if not short:
            break
        i = min(short, key=lambda k: len(runs[k]["words"]))
        target = i - 1 if i > 0 else i + 1
        runs[target]["words"] = (runs[target]["words"] + runs[i]["words"] if target < i
                                 else runs[i]["words"] + runs[target]["words"])
        del runs[i]
        runs = _merge_adjacent(runs)
    return runs


def split_by_speaker(segment: dict, turns: list[dict], fallback: str = "SPEAKER_00") -> list[dict]:
    """
    The parts of a transcription segment, one per speaker, in order.

    Each part: ``{"speaker", "start", "end", "text", "words"}`` plus the
    segment's ``low_confidence``. A segment without words (or with one
    speaker) stays whole, with the speaker that overlaps it most.
    """
    words = segment.get("words") or []
    if not words:
        speaker = speaker_at(segment["start"], segment["end"], turns) or fallback
        return [{**_base(segment), "speaker": speaker, "start": segment["start"],
                 "end": segment["end"], "text": (segment.get("text") or "").strip(),
                 "words": []}]

    runs = speaker_runs(words, turns, speaker_at(segment["start"], segment["end"], turns)
                        or fallback)
    if len(runs) == 1:
        return [{**_base(segment), "speaker": runs[0]["speaker"], "start": segment["start"],
                 "end": segment["end"], "text": (segment.get("text") or "").strip(),
                 "words": words}]
    return [
        {**_base(segment), "speaker": run["speaker"], "start": run["words"][0]["start"],
         "end": run["words"][-1]["end"],
         "text": "".join(w["word"] for w in run["words"]).strip(), "words": run["words"]}
        for run in runs
    ]


def _base(segment: dict) -> dict:
    return {"low_confidence": True} if segment.get("low_confidence") else {}
