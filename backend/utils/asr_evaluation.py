"""
Measuring transcription reliability against reference transcripts.

A benchmark folder holds audio files, each optionally next to a reference
transcript (``<name>.txt``) and the language it is in (``<name>.lang``, an
ISO 639-1 code such as ``pt``). Each audio is transcribed with the same code
and settings the pipeline uses, then scored:

- WER/CER: word and character error rates against the reference (case and
  punctuation ignored, accents kept: "e" and "é" are different words);
- language: whether the detected language is the expected one, and with
  what probability.

The report records the model and settings, so a run can be repeated and
compared after a change (a model switch, a new setting, a new version).
"""
import csv
import io
import re
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

AUDIO_EXTENSIONS = frozenset({
    ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".amr", ".aac", ".wma", ".webm",
})


@dataclass(frozen=True)
class Sample:
    """One benchmark audio and what it should produce."""

    name: str
    audio_path: Path
    reference: Optional[str] = None
    expected_language: Optional[str] = None


@dataclass
class SampleResult:  # pylint: disable=too-many-instance-attributes
    """How one audio was transcribed and scored."""

    name: str
    duration: Optional[float] = None
    seconds: Optional[float] = None
    language: Optional[str] = None
    language_probability: Optional[float] = None
    expected_language: Optional[str] = None
    segments: int = 0
    low_confidence: int = 0
    removed: int = 0
    ref_words: int = 0
    word_errors: Optional[int] = None
    ref_chars: int = 0
    char_errors: Optional[int] = None
    hypothesis: str = ""
    error: Optional[str] = None
    extra: dict = field(default_factory=dict)

    @property
    def wer(self) -> Optional[float]:
        """Word error rate, or None without a reference."""
        if self.word_errors is None or not self.ref_words:
            return None
        return self.word_errors / self.ref_words

    @property
    def cer(self) -> Optional[float]:
        """Character error rate, or None without a reference."""
        if self.char_errors is None or not self.ref_chars:
            return None
        return self.char_errors / self.ref_chars

    @property
    def language_correct(self) -> Optional[bool]:
        """Whether the detected language is the expected one (None if unknown)."""
        if not self.expected_language or self.error:
            return None
        return self.language == self.expected_language

    @property
    def real_time_factor(self) -> Optional[float]:
        """Processing time over audio duration (below 1 is faster than real time)."""
        if not self.seconds or not self.duration:
            return None
        return self.seconds / self.duration


def _read_text(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    return path.read_text(encoding="utf-8-sig")


def discover_samples(folder: Path) -> list[Sample]:
    """The audio files in ``folder`` with their reference and language, by name."""
    samples = []
    for audio in sorted(folder.iterdir()):
        if not audio.is_file() or audio.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        language = _read_text(audio.with_suffix(".lang"))
        language = next((line.strip().lower() for line in (language or "").splitlines()
                         if line.strip()), None)
        samples.append(Sample(
            name=audio.name,
            audio_path=audio,
            reference=_read_text(audio.with_suffix(".txt")),
            expected_language=language,
        ))
    return samples


def normalize_for_scoring(text: str) -> str:
    """Lowercase, drop punctuation and collapse whitespace, keeping accents."""
    text = unicodedata.normalize("NFC", text.lower())
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def edit_distance(reference: Sequence, hypothesis: Sequence) -> int:
    """Levenshtein distance (substitutions, insertions and deletions)."""
    if len(reference) < len(hypothesis):
        reference, hypothesis = hypothesis, reference
    previous = list(range(len(hypothesis) + 1))
    for i, ref_item in enumerate(reference, start=1):
        current = [i]
        for j, hyp_item in enumerate(hypothesis, start=1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (ref_item != hyp_item),
            ))
        previous = current
    return previous[-1]


def error_counts(reference: str, hypothesis: str) -> dict[str, int]:
    """Reference sizes and edit distances, in words and in characters."""
    ref = normalize_for_scoring(reference)
    hyp = normalize_for_scoring(hypothesis)
    ref_words, hyp_words = ref.split(), hyp.split()
    return {
        "ref_words": len(ref_words),
        "word_errors": edit_distance(ref_words, hyp_words),
        "ref_chars": len(ref),
        "char_errors": edit_distance(ref, hyp),
    }


def evaluate_sample(
    sample: Sample,
    transcribe: Callable[[Sample], dict],
    clock: Callable[[], float] = time.perf_counter,
) -> SampleResult:
    """Transcribe one sample and score it; a failure is recorded, not raised."""
    result = SampleResult(name=sample.name, expected_language=sample.expected_language)
    started = clock()
    try:
        data = transcribe(sample)
    except Exception as e:  # pylint: disable=broad-exception-caught
        result.seconds = clock() - started
        result.error = str(e) or type(e).__name__
        return result
    result.seconds = clock() - started

    segments = data.get("segments") or []
    result.hypothesis = " ".join((s.get("text") or "").strip() for s in segments).strip()
    result.duration = data.get("duration")
    result.language = data.get("language")
    result.language_probability = data.get("language_probability")
    result.segments = len(segments)
    result.low_confidence = sum(1 for s in segments if s.get("low_confidence"))
    result.removed = len(data.get("removed_segments") or [])
    if sample.reference is not None:
        counts = error_counts(sample.reference, result.hypothesis)
        result.ref_words = counts["ref_words"]
        result.word_errors = counts["word_errors"]
        result.ref_chars = counts["ref_chars"]
        result.char_errors = counts["char_errors"]
    return result


def summarize(results: list[SampleResult]) -> dict[str, Any]:
    """Totals over the run: corpus WER/CER (errors over reference size), language hits."""
    scored = [r for r in results if r.word_errors is not None and r.ref_words]
    ref_words = sum(r.ref_words for r in scored)
    ref_chars = sum(r.ref_chars for r in scored)
    with_language = [r for r in results if r.language_correct is not None]
    return {
        "files": len(results),
        "failed": sum(1 for r in results if r.error),
        "scored": len(scored),
        "wer": sum(r.word_errors for r in scored) / ref_words if ref_words else None,
        "cer": sum(r.char_errors for r in scored) / ref_chars if ref_chars else None,
        "language_checked": len(with_language),
        "language_correct": sum(1 for r in with_language if r.language_correct),
        "audio_seconds": sum(r.duration or 0 for r in results),
        "processing_seconds": sum(r.seconds or 0 for r in results),
    }


def _percent(value: Optional[float]) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def _seconds(value: Optional[float]) -> str:
    return "—" if value is None else f"{value:.1f}s"


def render_markdown(
    results: list[SampleResult], summary: dict[str, Any], context: dict[str, Any]
) -> str:
    """A report to read and keep with the case notes."""
    lines = ["# ASR evaluation", ""]
    lines += [f"- **{key}:** {value}" for key, value in context.items()]
    lines += [
        "",
        "## Summary",
        "",
        f"- Files: {summary['files']} ({summary['failed']} failed)",
        f"- WER: {_percent(summary['wer'])} over {summary['scored']} file(s) with a reference",
        f"- CER: {_percent(summary['cer'])}",
        f"- Language: {summary['language_correct']}/{summary['language_checked']} correct",
        f"- Audio: {_seconds(summary['audio_seconds'])}, processing: "
        f"{_seconds(summary['processing_seconds'])}",
        "",
        "WER/CER ignore case and punctuation and keep accents. Lower is better.",
        "",
        "## Files",
        "",
        "| File | Duration | Time | RTF | Expected | Detected | OK | WER | CER "
        "| Low confidence | Removed |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        if r.error:
            lines.append(f"| {r.name} | | {_seconds(r.seconds)} | | {r.expected_language or ''} "
                         f"| **error:** {r.error} | | | | | |")
            continue
        detected = r.language or "—"
        if r.language_probability is not None:
            detected += f" ({r.language_probability * 100:.0f}%)"
        ok = {True: "✓", False: "✗", None: ""}[r.language_correct]
        rtf = "—" if r.real_time_factor is None else f"{r.real_time_factor:.2f}"
        lines.append(
            f"| {r.name} | {_seconds(r.duration)} | {_seconds(r.seconds)} | {rtf} "
            f"| {r.expected_language or ''} | {detected} | {ok} | {_percent(r.wer)} "
            f"| {_percent(r.cer)} | {r.low_confidence}/{r.segments} | {r.removed} |"
        )
    return "\n".join(lines) + "\n"


CSV_COLUMNS = (
    "file", "duration_s", "processing_s", "rtf", "expected_language", "language",
    "language_probability", "language_correct", "wer", "cer", "ref_words", "word_errors",
    "segments", "low_confidence", "removed", "error",
)


def render_csv(results: list[SampleResult]) -> str:
    """One row per file, for a spreadsheet or for comparing runs."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for r in results:
        writer.writerow([
            r.name, r.duration, r.seconds, r.real_time_factor, r.expected_language or "",
            r.language or "", r.language_probability,
            "" if r.language_correct is None else int(r.language_correct),
            r.wer, r.cer, r.ref_words, r.word_errors, r.segments, r.low_confidence,
            r.removed, r.error or "",
        ])
    return out.getvalue()
