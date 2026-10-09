"""
The server-side project queue and the pipeline it runs: audios are processed
one at a time, oldest first, resume where a restart left them, and a failure
never blocks the rest of the queue.
"""
import asyncio

import pytest
from runtime_settings import RuntimeSettings
from services.pipeline import JobPipeline, resolve_transcription_options
from services.project_queue import ProjectQueue


class FakeQueueRepo:
    def __init__(self, jobs):
        self.jobs = list(jobs)
        self.errors = {}
        self.requeued = 0

    async def next_queued_job(self):
        for job in self.jobs:
            if job["workflow_state"] in ("uploaded", "transcribed", "diarized"):
                return job
        return None

    async def mark_error(self, job_uuid, message):
        for job in self.jobs:
            if job["uuid"] == job_uuid and job["workflow_state"] != "error":
                job["workflow_state"] = "error"
                self.errors[job_uuid] = message

    async def requeue_interrupted(self):
        self.requeued += 1
        return 0


def _job(uuid, state="uploaded"):
    return {"uuid": uuid, "file_name": f"{uuid}.wav", "workflow_state": state}


def test_audios_are_processed_one_at_a_time_in_order():
    repo = FakeQueueRepo([_job("a"), _job("b")])
    seen = []

    async def run_job(job):
        seen.append((job["uuid"], queue.current_job))
        job["workflow_state"] = "completed"

    queue = ProjectQueue(repo, run_job)

    async def drain():
        results = [await queue.run_next() for _ in range(3)]
        return results

    assert asyncio.run(drain()) == [True, True, False]
    assert seen == [("a", "a"), ("b", "b")]
    assert queue.current_job is None


def test_a_failure_before_any_step_marks_the_audio_failed_and_moves_on():
    repo = FakeQueueRepo([_job("a"), _job("b")])

    async def run_job(job):
        if job["uuid"] == "a":
            raise ValueError("Unsupported model: x")
        job["workflow_state"] = "completed"

    queue = ProjectQueue(repo, run_job)
    asyncio.run(queue.run_next())
    asyncio.run(queue.run_next())

    assert repo.errors == {"a": "Unsupported model: x"}
    assert [j["workflow_state"] for j in repo.jobs] == ["error", "completed"]


def test_the_worker_requeues_interrupted_audios_and_wakes_on_notify():
    repo = FakeQueueRepo([])
    done = []

    async def run_job(job):
        job["workflow_state"] = "completed"
        done.append(job["uuid"])

    async def scenario():
        queue = ProjectQueue(repo, run_job, idle_seconds=60)
        queue.start()
        await asyncio.sleep(0.01)  # worker is now idle, waiting
        repo.jobs.append(_job("late"))
        queue.notify()
        for _ in range(100):
            if done:
                break
            await asyncio.sleep(0.01)
        await queue.stop()

    asyncio.run(scenario())
    assert repo.requeued == 1
    assert done == ["late"]  # picked up long before the 60 s idle poll


# --- Pipeline ------------------------------------------------------------------


def _runtime(**values):
    return RuntimeSettings(whisper_model_name="large-v3", **values)


def test_transcription_options_prefer_the_job_then_request_then_settings():
    runtime = _runtime(default_language="pt")
    allowed = ["large-v3", "turbo"]

    assert resolve_transcription_options({}, runtime, allowed) == ("large-v3", "pt")
    assert resolve_transcription_options({}, runtime, allowed, "turbo", "en") == ("turbo", "en")
    assert resolve_transcription_options(
        {"model_name": "turbo", "language": "auto"}, runtime, allowed, "large-v3", "en"
    ) == ("turbo", None)


@pytest.mark.parametrize(
    "job, requested",
    [({"model_name": "someone/evil"}, None), ({"language": "xx"}, None), ({}, "evil/model")],
)
def test_transcription_options_reject_unknown_models_and_languages(job, requested):
    with pytest.raises(ValueError):
        resolve_transcription_options(job, _runtime(), ["large-v3"], requested)


class _Recorder:
    def __init__(self, calls):
        self.calls = calls

    async def ensure_asr_audio(self, job_uuid, source, highpass, loudnorm):
        self.calls.append(("asr", source, highpass, loudnorm))
        return f"{source}.asr"

    async def transcribe(self, job_uuid, path, model, language, runtime):
        self.calls.append(("transcribe", path, model, language))

    async def diarize(self, job_uuid, path, model_name=None):
        self.calls.append(("diarize", path))
        self.diarization_models = [*getattr(self, "diarization_models", []), model_name]

    async def align(self, job_uuid, base_name):
        self.calls.append(("align", base_name))


class _Runtime:
    def __init__(self, settings):
        self.settings = settings

    async def get(self):
        return self.settings

    def allowed_models(self):
        return ["large-v3"]


class _Settings:
    upload_dir = "uploads"


@pytest.mark.parametrize(
    "state, steps",
    [
        ("uploaded", ["transcribe", "diarize", "align"]),
        ("transcribed", ["diarize", "align"]),
        ("diarized", ["align"]),
        ("completed", []),
    ],
)
def test_the_pipeline_runs_only_the_remaining_steps(state, steps):
    calls = []
    recorder = _Recorder(calls)
    pipeline = JobPipeline(
        _Settings(), recorder, recorder, recorder, recorder,
        _Runtime(_runtime(audio_loudnorm=False, default_language="pt",
                          diarization_model="pyannote/speaker-diarization-community-1")),
    )
    job = {"uuid": "u1", "file_name": "call.v2.wav", "workflow_state": state, "language": None}

    asyncio.run(pipeline.run_remaining(job))

    assert [c[0] for c in calls if c[0] != "asr"] == steps
    if "transcribe" in steps:
        assert ("transcribe", "uploads/call.v2.wav.asr", "large-v3", "pt") in calls
        assert ("asr", "uploads/call.v2.wav", True, False) in calls
    if "diarize" in steps:
        # The diarization model chosen in the admin panel.
        assert recorder.diarization_models == ["pyannote/speaker-diarization-community-1"]
    if "align" in steps:
        assert ("align", "call.v2") in calls
