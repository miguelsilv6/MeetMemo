"""How an audio was processed, as the administrator sees it."""
from runtime_settings import RuntimeSettings
from services.processing_info import TRANSCRIPTION_SETTINGS, processing_info

JOB = {"file_name": "chamada.wav", "model_name": "turbo", "num_speakers": 2,
       "audio_seconds": 61.5}


def stored_settings(**changes):
    """The copy of the settings a transcription keeps (runtime.model_dump())."""
    return RuntimeSettings(whisper_model_name="large-v3", **changes).model_dump()


def test_it_says_what_made_the_transcription_and_the_diarization():
    transcription = {
        "model_name": "large-v3", "duration": 60.2, "language": "pt",
        "language_probability": 0.93, "language_detection": {"windows": 4},
        "channel_mode": "mono", "settings": stored_settings(beam_size=7),
    }
    diarization = {"model": "nvidia/Nemotron-3-Diarization", "segments": []}

    info = processing_info(JOB, transcription, diarization)

    assert info["file_name"] == "chamada.wav"
    assert info["whisper_model"] == "large-v3"  # the one that ran, not the job's request
    assert info["diarization_model"] == "nvidia/Nemotron-3-Diarization"
    assert info["diarization_by_channels"] is False
    assert info["language"] == {"code": "pt", "probability": 0.93, "forced": False}
    assert info["channel_mode"] == "mono"
    assert info["num_speakers"] == 2
    assert info["duration_seconds"] == 60.2
    assert info["settings"]["beam_size"] == 7


def test_only_the_transcription_settings_are_shown():
    info = processing_info(JOB, {"settings": stored_settings()}, None)

    shown = info["settings"]
    assert set(shown) == set(TRANSCRIPTION_SETTINGS) | {"hallucination_phrases_count"}
    assert shown["hallucination_phrases_count"] > 0  # a count: the list itself is long
    assert not {"llm_summary_system_prompt", "job_retention_hours", "max_upload_mb",
                "default_daily_tokens", "hallucination_phrases"} & set(shown)


def test_a_forced_language_is_marked_and_a_call_split_by_channel_has_no_model():
    transcription = {"language": "en", "language_detection": {"forced": True},
                     "channel_mode": "split"}

    info = processing_info(JOB, transcription, {"model": "channels", "segments": []})

    assert info["language"]["forced"] is True
    assert info["diarization_by_channels"] is True
    assert info["diarization_model"] == "channels"


def test_an_audio_processed_before_the_settings_were_kept_shows_what_it_has():
    info = processing_info(JOB, {"model_name": "small", "language": "pt"}, None)

    assert info["settings"] is None
    assert info["whisper_model"] == "small"
    assert info["diarization_model"] is None
    assert info["diarization_by_channels"] is False
    assert info["duration_seconds"] == 61.5  # from the upload when not transcribed with one


def test_an_audio_not_processed_yet_has_only_what_the_upload_gave():
    info = processing_info(JOB, None, None)

    assert info["whisper_model"] == "turbo"
    assert info["language"] is None
    assert info["settings"] is None
    assert info["channel_mode"] is None


def test_it_says_which_model_detected_the_language_when_the_portuguese_one_transcribed():
    ep = "inesc-id/WhisperLv3-EP-X-CPP"
    transcription = {"model_name": ep, "detection_model": "large-v3", "language": "pt",
                     "settings": stored_settings(portuguese_whisper_model=ep)}

    info = processing_info(JOB, transcription, None)

    assert (info["whisper_model"], info["whisper_models"]) == (ep, [ep])
    assert info["detection_model"] == "large-v3"
    assert info["settings"]["portuguese_whisper_model"] == ep


def test_a_call_split_by_channel_lists_every_model_that_transcribed_it():
    ep = "inesc-id/WhisperLv3-EP-X-CPP"
    transcription = {"model_name": ep, "language": "pt", "language_detection": {"channels": [
        {"speaker": "SPEAKER_00", "model_name": ep},
        {"speaker": "SPEAKER_01", "model_name": "large-v3"}]}}

    info = processing_info(JOB, transcription, None)

    assert info["whisper_models"] == [ep, "large-v3"]
    assert info["detection_model"] is None


def test_an_audio_with_no_transcription_lists_the_model_it_was_given():
    assert processing_info(JOB, None, None)["whisper_models"] == ["turbo"]
    assert processing_info({**JOB, "model_name": None}, None, None)["whisper_models"] == []
