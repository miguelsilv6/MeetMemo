"""
Renaming speakers: names are applied to the transcript as it is now (the
edited copy, with its earlier edits and renames), never to the original, and
the channels of a call transcribed per channel follow the new names while
keeping the label they were transcribed with.
"""
import asyncio
import json
from types import SimpleNamespace

from services.speaker_service import SpeakerService, rename_channel_speakers

ORIGINAL = [
    {"speaker": "SPEAKER_00", "start": "0.00", "end": "2.00", "text": "Bom dia."},
    {"speaker": "SPEAKER_01", "start": "2.00", "end": "4.00", "text": "Olá."},
]


def _service(tmp_path, edited=None):
    transcripts = tmp_path / "transcripts"
    edited_dir = transcripts / "edited"
    edited_dir.mkdir(parents=True)
    (transcripts / "call.json").write_text(json.dumps(ORIGINAL), encoding="utf-8")
    if edited is not None:
        (edited_dir / "call.json").write_text(json.dumps(edited), encoding="utf-8")
    settings = SimpleNamespace(transcript_dir=str(transcripts),
                               transcript_edited_dir=str(edited_dir))
    return SpeakerService(settings), transcripts


def _rename(service, mapping):
    return asyncio.run(service.update_speaker_names("job1", "call", mapping))


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_renaming_keeps_the_earlier_edits(tmp_path):
    edited = [dict(ORIGINAL[0], text="Bom dia, fala a Ana."), ORIGINAL[1]]
    service, transcripts = _service(tmp_path, edited)

    renamed = _rename(service, {"SPEAKER_00": "Ana"})

    assert [(s["speaker"], s["text"]) for s in renamed] == [
        ("Ana", "Bom dia, fala a Ana."), ("SPEAKER_01", "Olá.")]
    assert _read(transcripts / "edited" / "call.json") == renamed
    assert _read(transcripts / "call.json") == ORIGINAL  # never written


def test_a_second_rename_applies_to_the_first(tmp_path):
    service, transcripts = _service(tmp_path)

    _rename(service, {"SPEAKER_00": "Ana"})
    renamed = _rename(service, {"Ana": "Ana Silva", "SPEAKER_01": "Bruno"})

    assert [s["speaker"] for s in renamed] == ["Ana Silva", "Bruno"]
    assert _read(transcripts / "call.json") == ORIGINAL


def test_without_an_edited_copy_the_original_is_renamed_into_one(tmp_path):
    service, transcripts = _service(tmp_path)

    _rename(service, {"SPEAKER_01": "Bruno"})

    assert [s["speaker"] for s in _read(transcripts / "edited" / "call.json")] == [
        "SPEAKER_00", "Bruno"]


def test_channels_show_the_new_names_and_keep_their_label():
    data = {"language_detection": {"channels": [
        {"channel": 0, "speaker": "SPEAKER_00", "language": "pt"},
        {"channel": 1, "speaker": "SPEAKER_01", "language": "ro"},
    ]}}

    assert rename_channel_speakers(data, {"SPEAKER_00": "Ana"}) is True
    assert rename_channel_speakers(data, {"Ana": "Ana Silva", "SPEAKER_01": "SPEAKER_01"})
    channels = data["language_detection"]["channels"]
    assert [(c["speaker"], c.get("display_name")) for c in channels] == [
        ("SPEAKER_00", "Ana Silva"), ("SPEAKER_01", None)]
    # Nothing to rename, or a call not transcribed per channel.
    assert rename_channel_speakers(data, {"Carlos": "Rui"}) is False
    assert rename_channel_speakers({"language_detection": {}}, {"SPEAKER_00": "Ana"}) is False
    assert rename_channel_speakers(None, {"SPEAKER_00": "Ana"}) is False
