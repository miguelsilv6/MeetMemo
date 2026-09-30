"""
Projects without a database: what the project page shows for each audio,
uploads with per-project duplicate detection, and complete deletion of every
file an audio produced.
"""
import asyncio
import io
import os
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from services.job_files import remove_job_files, translation_files
from services.project_service import ProjectService, audio_status, overall_progress
from utils.asr_audio import asr_audio_path

NOW = datetime(2026, 9, 27, tzinfo=timezone.utc)


def _settings(tmp_path):
    dirs = {}
    for name in ("upload", "transcript", "summary", "translation", "export"):
        dirs[f"{name}_dir"] = str(tmp_path / name)
        os.makedirs(dirs[f"{name}_dir"])
    dirs["transcript_edited_dir"] = str(tmp_path / "transcript" / "edited")
    os.makedirs(dirs["transcript_edited_dir"])
    return SimpleNamespace(**dirs)


def _touch(path):
    with open(path, "w", encoding="utf-8") as f:
        f.write("x")
    return path


# --- Status shown per audio ------------------------------------------------------


@pytest.mark.parametrize(
    "state, step, expected",
    [
        ("uploaded", 0, 0),
        ("transcribing", 50, 15),
        ("transcribed", 100, 30),
        ("diarizing", 50, 60),
        ("aligning", 100, 100),
        ("completed", 100, 100),
        ("error", 0, 0),
    ],
)
def test_overall_progress_spans_the_three_steps(state, step, expected):
    assert overall_progress(state, step) == expected


def _row(uuid, state, **extra):
    return {"uuid": uuid, "file_name": f"{uuid}.wav", "workflow_state": state,
            "current_step_progress": 0, "created_at": NOW, **extra}


def test_audio_status_distinguishes_queued_processing_done_and_failed():
    queue = ["b", "c"]
    assert audio_status(_row("a", "transcribing"), "a", queue)["status"] == "processing"
    # Between two steps the audio being processed is still "processing".
    assert audio_status(_row("a", "transcribed"), "a", queue)["status"] == "processing"
    queued = audio_status(_row("c", "uploaded"), "a", queue)
    assert (queued["status"], queued["queue_position"]) == ("queued", 2)
    failed = audio_status(_row("d", "error", error_message="boom"), None, queue)
    assert (failed["status"], failed["error_message"]) == ("error", "boom")
    done = audio_status(_row("e", "completed", error_message="old"), None, queue)
    assert (done["status"], done["progress"], done["error_message"]) == ("completed", 100, None)


def test_audio_status_carries_the_detected_language_and_import_date():
    done = audio_status(
        _row("e", "completed", detected_language="en", language_probability=0.42), None, []
    )
    assert (done["detected_language"], done["language_probability"]) == ("en", 0.42)
    assert done["created_at"] == NOW
    waiting = audio_status(_row("f", "uploaded"), None, ["f"])
    assert (waiting["detected_language"], waiting["language_probability"]) == (None, None)


# --- Files of a job --------------------------------------------------------------


def test_translation_files_belong_to_exactly_one_audio(tmp_path):
    for name in ("call.pt-PT.json", "call.pt-PT.partial.json", "call.pt.json",
                 "call.pt-PT.nllb.json", "call.pt-PT.nllb.partial.json",
                 "call.v2.pt-PT.json", "call.v2.pt-PT.nllb.json", "callback.pt-PT.json",
                 "call.txt"):
        _touch(tmp_path / name)

    found = sorted(os.path.basename(p) for p in translation_files(str(tmp_path), "call"))

    assert found == [
        "call.pt-PT.json", "call.pt-PT.nllb.json", "call.pt-PT.nllb.partial.json",
        "call.pt-PT.partial.json", "call.pt.json",
    ]
    # The caches of "call" are not files of an audio named "call.pt-PT".
    assert translation_files(str(tmp_path), "call.pt-PT") == []


def test_removing_a_job_deletes_every_file_it_produced(tmp_path):
    s = _settings(tmp_path)
    export = _touch(os.path.join(s.export_dir, "export.docx"))
    os.makedirs(os.path.dirname(asr_audio_path(s.upload_dir, "job1")))
    mine = [
        _touch(os.path.join(s.upload_dir, "call.wav")),
        _touch(asr_audio_path(s.upload_dir, "job1")),
        _touch(os.path.join(s.transcript_dir, "call.json")),
        _touch(os.path.join(s.transcript_edited_dir, "call.json")),
        _touch(os.path.join(s.summary_dir, "job1.txt")),
        _touch(os.path.join(s.translation_dir, "call.pt-PT.json")),
        export,
    ]
    other = [
        _touch(os.path.join(s.upload_dir, "call2.wav")),
        _touch(os.path.join(s.transcript_dir, "call.v2.json")),
        _touch(os.path.join(s.translation_dir, "call.v2.pt-PT.json")),
    ]

    removed = asyncio.run(remove_job_files(s, "job1", "call.wav", [export]))

    assert sorted(removed) == sorted(mine)
    assert all(os.path.exists(p) for p in other)


# --- Uploads ---------------------------------------------------------------------


class FakeProjectRepo:
    def __init__(self):
        self.jobs = {}
        self.deleted = []

    async def find_job_by_hash(self, project_uuid, file_hash):
        for job in self.jobs.values():
            if job["project_uuid"] == project_uuid and job["file_hash"] == file_hash:
                return job
        return None

    async def add_job(self, uuid, project_uuid, file_name, file_hash, language):
        self.jobs[uuid] = {"uuid": uuid, "project_uuid": project_uuid, "file_name": file_name,
                           "file_hash": file_hash, "language": language}

    async def files(self, project_uuid):
        return [{"uuid": j["uuid"], "file_name": j["file_name"], "export_paths": []}
                for j in self.jobs.values() if j["project_uuid"] == project_uuid]

    async def delete(self, project_uuid):
        self.deleted.append(project_uuid)
        return True

    async def delete_job(self, project_uuid, job_uuid):
        return self.jobs.pop(job_uuid, None) is not None

    async def job_exists(self, job_uuid):
        return job_uuid in self.jobs


class FakeAudioService:
    """Stores uploads like AudioService, without size limits or ffmpeg."""

    def __init__(self, settings):
        self.settings = settings
        self.converted = []

    async def upload_audio(self, job_uuid, file):
        data = await file.read()
        name = file.filename
        with open(os.path.join(self.settings.upload_dir, name), "wb") as f:
            f.write(data)
        return name, f"hash-{data.decode()}"

    async def convert_to_wav_async(self, source, target):
        self.converted.append((source, target))
        _touch(os.path.join(self.settings.upload_dir, target))


def _upload(name, content):
    return UploadFile(file=io.BytesIO(content.encode()), filename=name)


def test_uploads_are_queued_once_per_project(tmp_path):
    s = _settings(tmp_path)
    repo = FakeProjectRepo()
    audio = FakeAudioService(s)
    service = ProjectService(s, repo, audio, runtime_settings=object())

    first = asyncio.run(service.add_audios("p1", [
        _upload("a.wav", "A"), _upload("b.mp3", "B"), _upload("notes.txt", "N"),
    ], "pt"))
    again = asyncio.run(service.add_audios("p1", [_upload("a copy.wav", "A")], None))

    assert [r["status"] for r in first] == ["queued", "queued", "rejected"]
    assert again[0]["status"] == "duplicate" and again[0]["detail"] == "a.wav"
    # The mp3 was converted and only the WAV kept; the duplicate was not kept.
    assert audio.converted == [("b.mp3", "b.wav")]
    assert sorted(os.listdir(s.upload_dir)) == ["a.wav", "b.wav"]
    assert {j["language"] for j in repo.jobs.values()} == {"pt"}

    # The same file is welcome in another project.
    other_project = asyncio.run(service.add_audios("p2", [_upload("a2.wav", "A")], None))
    assert other_project[0]["status"] == "queued"


def test_deleting_a_project_removes_every_audio_file(tmp_path):
    s = _settings(tmp_path)
    repo = FakeProjectRepo()
    service = ProjectService(s, repo, FakeAudioService(s), runtime_settings=object())
    asyncio.run(service.add_audios("p1", [_upload("a.wav", "A")], None))
    job_uuid = next(iter(repo.jobs))
    summary = _touch(os.path.join(s.summary_dir, f"{job_uuid}.txt"))

    assert asyncio.run(service.delete("p1")) is True

    assert repo.deleted == ["p1"]
    assert not os.path.exists(summary)
    assert os.listdir(s.upload_dir) == []


def test_files_written_after_an_audio_was_deleted_are_removed(tmp_path):
    s = _settings(tmp_path)
    repo = FakeProjectRepo()

    class Pipeline:
        async def run_remaining(self, job):
            # The audio is deleted mid-processing; the last step still writes.
            repo.jobs.pop(job["uuid"], None)
            _touch(os.path.join(s.transcript_dir, "late.json"))

    service = ProjectService(s, repo, runtime_settings=object(), pipeline=Pipeline())
    repo.jobs["j1"] = {"uuid": "j1", "project_uuid": "p1", "file_name": "late.wav",
                       "file_hash": "h", "language": None}

    asyncio.run(service.process({"uuid": "j1", "file_name": "late.wav"}))

    assert os.listdir(s.transcript_dir) == ["edited"]
