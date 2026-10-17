"""
Aligning speakers onto the transcript: a segment transcribed from one channel
keeps its channel's speaker; any other segment takes the speaker that
overlaps it most.
"""
import asyncio
import json
from types import SimpleNamespace

from services import alignment_service
from services.alignment_service import AlignmentService


class _Repo:
    def __init__(self, transcription, diarization):
        self.transcription, self.diarization = transcription, diarization
        self.states = []

    async def update_workflow_state(self, job_uuid, state, progress):
        self.states.append(state)

    async def update_step_progress(self, job_uuid, progress):
        pass

    async def get_transcription(self, job_uuid):
        return self.transcription

    async def get_diarization(self, job_uuid):
        return self.diarization


def _align(monkeypatch, tmp_path, transcription, diarization):
    async def update_status(job_uuid, code):
        pass

    monkeypatch.setattr(alignment_service, "update_status", update_status)
    settings = SimpleNamespace(transcript_dir=str(tmp_path))
    repo = _Repo(transcription, diarization)
    asyncio.run(AlignmentService(settings, repo).align("job", "call"))
    assert repo.states[-1] == "completed"
    return json.loads((tmp_path / "call.json").read_text(encoding="utf-8"))


def test_channel_speakers_are_kept_even_when_both_sides_talk_at_once(monkeypatch, tmp_path):
    segments = [
        {"start": 0.0, "end": 5.0, "text": " Estou a explicar", "speaker": "SPEAKER_00"},
        # The other side interrupts inside the first one's turn.
        {"start": 1.0, "end": 2.0, "text": " Não!", "speaker": "SPEAKER_01"},
    ]
    diarization = {"segments": [{"start": s["start"], "end": s["end"], "speaker": s["speaker"]}
                                for s in segments]}
    aligned = _align(monkeypatch, tmp_path, {"segments": segments}, diarization)
    assert [(s["speaker"], s["text"]) for s in aligned] == [
        ("SPEAKER_00", "Estou a explicar"), ("SPEAKER_01", "Não!")]


def test_other_segments_take_the_speaker_that_overlaps_most(monkeypatch, tmp_path):
    transcription = {"segments": [{"start": 0.0, "end": 4.0, "text": " Bom dia."}]}
    diarization = {"segments": [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"},
                                {"start": 1.0, "end": 4.0, "speaker": "SPEAKER_01"}]}
    aligned = _align(monkeypatch, tmp_path, transcription, diarization)
    assert aligned[0]["speaker"] == "SPEAKER_01"


def test_a_segment_with_a_change_of_speaker_is_split_and_keeps_its_words(monkeypatch,
                                                                         tmp_path):
    words = [{"start": 0.2, "end": 0.8, "word": " Está", "probability": 0.4},
             {"start": 0.8, "end": 1.4, "word": " lá?", "probability": 0.9},
             {"start": 2.2, "end": 2.8, "word": " Sim,", "probability": 0.95},
             {"start": 2.8, "end": 3.6, "word": " estou.", "probability": 0.97}]
    transcription = {"segments": [{"start": 0.2, "end": 3.6, "text": " Está lá? Sim, estou.",
                                   "words": words}]}
    diarization = {"segments": [{"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"},
                                {"start": 2.0, "end": 4.0, "speaker": "SPEAKER_01"}]}

    aligned = _align(monkeypatch, tmp_path, transcription, diarization)

    assert [(s["speaker"], s["text"], s["start"], s["end"]) for s in aligned] == [
        ("SPEAKER_00", "Está lá?", "0.20", "1.40"), ("SPEAKER_01", "Sim, estou.", "2.20", "3.60")]
    assert aligned[0]["words"] == words[:2] and aligned[1]["words"] == words[2:]


def test_channel_segments_keep_their_words(monkeypatch, tmp_path):
    words = [{"start": 0.0, "end": 1.0, "word": " Olá", "probability": 0.3}]
    transcription = {"segments": [{"start": 0.0, "end": 1.0, "text": " Olá",
                                   "speaker": "SPEAKER_01", "words": words}]}
    aligned = _align(monkeypatch, tmp_path, transcription, {"segments": []})
    assert aligned == [{"speaker": "SPEAKER_01", "text": "Olá", "start": "0.00", "end": "1.00",
                        "words": words}]
