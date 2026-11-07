"""How long processing and AI tasks still take, from this server's own timings."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from services.eta import (
    eta_fields,
    job_remaining,
    queue_remaining,
    step_model,
    task_eta,
    task_remaining,
)

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)
RUNTIME = SimpleNamespace(whisper_model_name="large-v3", diarization_model="pyannote/3.1")
# Seconds of processing per second of audio, by step and model.
RATES = {
    ("transcribing", "large-v3"): 0.5,
    ("diarizing", "pyannote/3.1"): 0.2,
    ("diarizing", "split"): 0.0,
    ("aligning", ""): 0.01,
}


def job(state, **extra):
    return {"uuid": extra.pop("uuid", "j1"), "workflow_state": state, "audio_seconds": 600,
            "current_step_progress": 0, "step_started_at": None, "step_model": None,
            "model_name": None, "channel_mode": None, **extra}


def test_an_audio_not_started_takes_every_step_for_its_length():
    # 600 s of audio: 300 s transcribing, 120 s diarizing, 6 s aligning.
    assert job_remaining(job("uploaded"), RATES, RUNTIME, NOW) == 426


def test_the_transcription_goes_by_its_own_pace_once_under_way():
    # Half the audio transcribed (progress 50 of 10-90) in 100 s: 100 s more.
    running = job("transcribing", current_step_progress=50,
                  step_started_at=NOW - timedelta(seconds=100), step_model="large-v3")
    assert job_remaining(running, RATES, RUNTIME, NOW) == 100 + 120 + 6


def test_a_transcription_just_started_goes_by_the_history():
    starting = job("transcribing", current_step_progress=10,
                   step_started_at=NOW - timedelta(seconds=20), step_model="large-v3")
    assert job_remaining(starting, RATES, RUNTIME, NOW) == 280 + 120 + 6


def test_a_step_taking_longer_than_expected_has_nothing_left_but_the_next():
    late = job("diarizing", step_started_at=NOW - timedelta(seconds=500),
               step_model="pyannote/3.1")
    assert job_remaining(late, RATES, RUNTIME, NOW) == 6
    on_time = job("diarizing", step_started_at=NOW - timedelta(seconds=20),
                  step_model="pyannote/3.1")
    assert job_remaining(on_time, RATES, RUNTIME, NOW) == 100 + 6


def test_a_call_split_by_channel_is_diarized_at_the_split_speed():
    assert step_model("diarizing", job("transcribed", channel_mode="split"), RUNTIME) == "split"
    assert job_remaining(job("transcribed", channel_mode="split"), RATES, RUNTIME, NOW) == 6


def test_each_step_keeps_its_own_model():
    assert step_model("transcribing", job("uploaded", model_name="turbo"), RUNTIME) == "turbo"
    assert step_model("transcribing", job("uploaded"), RUNTIME) == "large-v3"
    assert step_model("diarizing", job("diarizing", step_model="other"), RUNTIME) == "other"
    assert step_model("aligning", job("diarized"), RUNTIME) == ""


def test_there_is_no_estimate_without_the_timings_or_the_length():
    assert job_remaining(job("uploaded", model_name="turbo"), RATES, RUNTIME, NOW) is None
    assert job_remaining(job("uploaded", audio_seconds=None), RATES, RUNTIME, NOW) is None
    assert job_remaining(job("completed"), RATES, RUNTIME, NOW) is None
    assert job_remaining(job("error"), RATES, RUNTIME, NOW) is None


def test_a_queued_audio_waits_for_the_one_processed_and_those_ahead():
    current = job("diarizing", uuid="c", step_started_at=NOW - timedelta(seconds=20),
                  step_model="pyannote/3.1")  # 106 s left
    queued = [job("uploaded", uuid="a"), job("uploaded", uuid="b", audio_seconds=60)]
    assert queue_remaining(current, queued, RATES, RUNTIME, NOW) == {
        "a": 106 + 426,
        "b": 106 + 426 + 42.6,
    }


def test_after_an_audio_without_an_estimate_the_queue_has_none():
    queued = [job("uploaded", uuid="a", model_name="turbo"), job("uploaded", uuid="b")]
    assert queue_remaining(None, queued, RATES, RUNTIME, NOW) == {"a": None, "b": None}


def task(task_id, kind, status, **extra):
    return {"id": task_id, "kind": kind, "status": status, "params": extra.pop("params", {}),
            "progress_done": 0, "progress_total": 0, "started_at": None, **extra}


DURATIONS = {("summary", ""): 90.0, ("translation", "llm"): 300.0}


def test_an_ai_task_takes_the_median_of_its_kind():
    assert task_remaining(task(1, "summary", "queued"), DURATIONS, NOW) == 90
    running = task(1, "summary", "running", started_at=NOW - timedelta(seconds=30))
    assert task_remaining(running, DURATIONS, NOW) == 60
    assert task_remaining(task(1, "translation", "queued", params={"engine": "nllb"}),
                          DURATIONS, NOW) is None


def test_a_translation_under_way_goes_by_its_own_pace():
    running = task(1, "translation", "running", progress_done=10, progress_total=40,
                   started_at=NOW - timedelta(seconds=50))
    assert task_remaining(running, DURATIONS, NOW) == 150


def test_a_queued_ai_task_waits_for_those_ahead():
    active = [
        task(1, "summary", "running", started_at=NOW - timedelta(seconds=30)),  # 60 s
        task(2, "translation", "queued"),  # 300 s
        task(3, "summary", "queued"),  # 90 s
        task(4, "summary", "queued"),  # after it: not counted
    ]
    assert task_eta(active[2], active, DURATIONS, NOW) == 60 + 300 + 90
    assert task_eta(active[0], active, DURATIONS, NOW) == 60
    assert task_eta(task(5, "summary", "done"), active, DURATIONS, NOW) is None


def test_the_estimate_says_seconds_left_and_when_it_is_done():
    assert eta_fields(90.4, NOW) == {"eta_seconds": 90, "eta_at": NOW + timedelta(seconds=90.4)}
    assert eta_fields(None, NOW) == {"eta_seconds": None, "eta_at": None}
