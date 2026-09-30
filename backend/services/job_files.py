"""
Every file a job leaves on disk, so that deleting a job removes all of it.

A job's files are found by its UUID (ASR audio, summary) or by the base name
of its audio file (transcripts and translations), plus the export files
recorded for it in the database.
"""
import logging
import os
from collections.abc import Iterable

import aiofiles.os
from config import Settings
from utils.asr_audio import asr_audio_path

logger = logging.getLogger(__name__)


def translation_files(translation_dir: str, base_name: str) -> list[str]:
    """Cached translations of a transcript (complete and partial, any target and engine)."""
    if not base_name or not os.path.isdir(translation_dir):
        return []
    prefix = f"{base_name}."
    matches = []
    for entry in os.listdir(translation_dir):
        if not (entry.startswith(prefix) and entry.endswith(".json")):
            continue
        # "<base>.<target>[.nllb][.partial].json" (".nllb": translated by
        # NLLB-200); a further dot means the file belongs to another audio,
        # e.g. "<base>.v2.pt-PT.json" to "<base>.v2"; and the caches of "<base>"
        # ("<base>.pt-PT.nllb.json", "<base>.pt-PT.partial.json") are never
        # targets "nllb" or "partial" of an audio "<base>.pt-PT".
        name = entry[len(prefix):-len(".json")].removesuffix(".partial")
        target = name.removesuffix(".nllb")
        if target and "." not in target and name not in ("nllb", "partial"):
            matches.append(os.path.join(translation_dir, entry))
    return matches


def derived_file_paths(
    settings: Settings,
    job_uuid: str,
    file_name: str,
    export_paths: Iterable[str] = (),
) -> list[str]:
    """
    Paths of what was made from the audio's transcript (existing or not):
    transcripts, summary, translations and exports. The audio itself and its
    ASR copy are not among them.
    """
    base_name = os.path.splitext(file_name)[0]
    return [
        os.path.join(settings.summary_dir, f"{job_uuid}.txt"),
        os.path.join(settings.transcript_dir, f"{base_name}.json"),
        os.path.join(settings.transcript_edited_dir, f"{base_name}.json"),
        *translation_files(settings.translation_dir, base_name),
        *[path for path in export_paths if path],
    ]


async def remove_files(paths: Iterable[str], job_uuid: str) -> list[str]:
    """Delete the files that exist, logging (not raising) individual failures."""
    removed = []
    for path in paths:
        try:
            if await aiofiles.os.path.exists(path):
                await aiofiles.os.remove(path)
                removed.append(path)
        except OSError as e:
            logger.error("Failed to delete %s of job %s: %s", path, job_uuid, e)
    return removed


def job_file_paths(
    settings: Settings,
    job_uuid: str,
    file_name: str,
    export_paths: Iterable[str] = (),
) -> list[str]:
    """Paths of every file the job may have created (existing or not)."""
    paths = [
        asr_audio_path(settings.upload_dir, str(job_uuid)),
        os.path.join(settings.summary_dir, f"{job_uuid}.txt"),
    ]
    if file_name:
        base_name = os.path.splitext(file_name)[0]
        paths += [
            os.path.join(settings.upload_dir, file_name),
            os.path.join(settings.transcript_dir, f"{base_name}.json"),
            os.path.join(settings.transcript_edited_dir, f"{base_name}.json"),
            *translation_files(settings.translation_dir, base_name),
        ]
    paths += [path for path in export_paths if path]
    return paths


async def remove_job_files(
    settings: Settings,
    job_uuid: str,
    file_name: str,
    export_paths: Iterable[str] = (),
) -> list[str]:
    """
    Delete every file of a job, logging (not raising) individual failures.

    Returns:
        The paths that were deleted.
    """
    return await remove_files(
        job_file_paths(settings, job_uuid, file_name, export_paths), job_uuid
    )
