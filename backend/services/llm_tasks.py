"""
Summaries and translations in the background.

Neither waits in an HTTP request any more: the page queues a task (see
repositories/llm_task_repository.py) and polls it, and one worker here runs
the tasks one at a time, since the language model serves one request at a
time anyway. A proxy in front of the app (Cloudflare cuts requests after
~100 s) can therefore no longer break a long summary or translation, and the
page can be closed meanwhile.

Translations still go to the model in blocks, each saved as it completes, so
a failed or interrupted task resumes where it stopped. They are made by the
engine the admin panel selects: the language model, or NLLB-200 offline
(services/nllb_translator.py); each engine has its own cache. A transcript edited
while its summary or translation is being produced makes the task start over
on the new text instead of saving a stale result.
"""
import asyncio
import hashlib
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Optional

import aiofiles
import aiofiles.os
import httpx
from fastapi import HTTPException
from utils.file_utils import get_transcript_path
from utils.formatters import format_transcript_for_llm

from services.nllb_translator import BLOCK_SIZE as NLLB_BLOCK_SIZE
from services.nllb_translator import (
    NllbSegmentTranslator,
    NllbUnavailableError,
    UnsupportedLanguageError,
    get_nllb_engine,
    nllb_code,
)

logger = logging.getLogger(__name__)

# Translations always target European Portuguese.
TRANSLATION_TARGET = "pt-PT"
# Segments sent to the LLM per call: small enough for a small model on CPU to
# answer completely and within LLM_TIMEOUT.
TRANSLATION_BLOCK_SIZE = 15
# Translation engines: the language model, or NLLB-200 offline.
ENGINES = ("llm", "nllb")
# How often a task starts over because its transcript keeps changing.
MAX_RESTARTS = 5
# How long an idle worker waits before looking at the queue again, in case a
# wake-up was missed (new tasks normally wake it straight away).
IDLE_POLL_SECONDS = 30


class TranscriptChangedError(Exception):
    """The transcript was edited while the task worked on it."""


class TranscriptMissingError(Exception):
    """The audio has no transcript (yet)."""


async def _read_json(path: str):
    async with aiofiles.open(path, "r", encoding="utf-8") as f:
        return json.loads(await f.read())


async def _write_json(path: str, data) -> None:
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(data, indent=4, ensure_ascii=False))


def base_name_of(job: dict) -> str:
    return os.path.splitext(job["file_name"])[0]


async def read_transcript(settings, job: dict) -> tuple[str, str]:
    """The transcript's JSON text (edited version first) and a digest of it."""
    try:
        path = await get_transcript_path(
            base_name_of(job), settings.transcript_dir, settings.transcript_edited_dir
        )
    except FileNotFoundError as e:
        raise TranscriptMissingError(job["uuid"]) from e
    async with aiofiles.open(path, "r", encoding="utf-8") as f:
        text = await f.read()
    return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


async def transcript_digest(settings, job: dict) -> Optional[str]:
    try:
        return (await read_transcript(settings, job))[1]
    except TranscriptMissingError:
        return None


def translation_paths(settings, job: dict, engine: str = "llm") -> tuple[str, str]:
    """The complete translation cache and the partial (per block) one."""
    base = base_name_of(job)
    # Keyed by the variant, so translations cached before European Portuguese
    # was enforced (`<name>.pt.json`) are not reused, and by the engine
    # (`<name>.pt-PT.nllb.json` for NLLB), so switching engines never serves
    # the other engine's translation as this one's.
    name = TRANSLATION_TARGET if engine == "llm" else f"{TRANSLATION_TARGET}.{engine}"
    return (
        os.path.join(settings.translation_dir, f"{base}.{name}.json"),
        os.path.join(settings.translation_dir, f"{base}.{name}.partial.json"),
    )


async def transcript_language(job_repo, job: dict) -> Optional[str]:
    """The language Whisper transcribed the audio in."""
    transcription = await job_repo.get_transcription(str(job["uuid"]))
    return transcription.get("language") if transcription else None


async def is_portuguese(job_repo, job: dict) -> bool:
    return await transcript_language(job_repo, job) == "pt"


async def available_translation(settings, job_repo, job: dict, engine: str = "llm"):
    """
    The transcript in European Portuguese if it exists without the model:
    ("original", segments) for a Portuguese transcript, ("cached", segments)
    for a complete translation, or (None, segments of the transcript).
    """
    text, _ = await read_transcript(settings, job)
    segments = json.loads(text)
    if await is_portuguese(job_repo, job):
        return "original", segments
    cache_path, _ = translation_paths(settings, job, engine)
    if await aiofiles.os.path.exists(cache_path):
        cached = await _read_json(cache_path)
        if len(cached) == len(segments):
            return "cached", cached
    return None, segments


async def translate(
    settings, job_repo, translator, job: dict, progress,
    engine: str = "llm", block_size: int = TRANSLATION_BLOCK_SIZE,
) -> None:
    """
    Translate the whole transcript into the engine's cache, block by block.

    Blocks already translated (a partial cache from an interrupted run) are
    not sent again. ``progress(done, total)`` is awaited after each block.

    Raises:
        TranscriptChangedError: The transcript was edited meanwhile; nothing
            stale was kept (editing clears the translation caches).
    """
    text, digest = await read_transcript(settings, job)
    segments = json.loads(text)
    total = len(segments)
    if await is_portuguese(job_repo, job):
        await progress(total, total)
        return
    cache_path, partial_path = translation_paths(settings, job, engine)
    if await aiofiles.os.path.exists(cache_path) and len(await _read_json(cache_path)) == total:
        await progress(total, total)
        return

    partial: dict[str, str] = (
        await _read_json(partial_path) if await aiofiles.os.path.exists(partial_path) else {}
    )
    missing = [i for i in range(total) if str(i) not in partial]
    await progress(total - len(missing), total)
    os.makedirs(settings.translation_dir, exist_ok=True)

    async def unchanged() -> bool:
        return await transcript_digest(settings, job) == digest

    for offset in range(0, len(missing), block_size):
        block = missing[offset:offset + block_size]
        translated = await translator.translate_segments([segments[i] for i in block])
        if not await unchanged():
            raise TranscriptChangedError(job["uuid"])
        for index, segment in zip(block, translated):
            partial[str(index)] = segment.get("text", "")
        await _write_json(partial_path, partial)
        await progress(total - len(missing) + offset + len(block), total)

    full = [{**segment, "text": partial[str(i)]} for i, segment in enumerate(segments)]
    await _write_json(cache_path, full)
    if os.path.exists(partial_path):
        os.remove(partial_path)
    if not await unchanged():
        # Edited between the last check and the write: drop what was written.
        for path in (cache_path, partial_path):
            if os.path.exists(path):
                os.remove(path)
        raise TranscriptChangedError(job["uuid"])


async def summarize(settings, summary_service, job: dict, params: dict) -> None:
    """
    Summarize the transcript into the summary cache.

    Raises:
        TranscriptChangedError: The transcript was edited meanwhile.
    """
    text, digest = await read_transcript(settings, job)
    summary = await summary_service.summarize(
        format_transcript_for_llm(text),
        params.get("custom_prompt"),
        params.get("system_prompt"),
    )
    if await transcript_digest(settings, job) != digest:
        raise TranscriptChangedError(job["uuid"])
    job_uuid = str(job["uuid"])
    await summary_service.save_summary(job_uuid, summary)
    if await transcript_digest(settings, job) != digest:
        await summary_service.delete_summary(job_uuid)
        raise TranscriptChangedError(job["uuid"])


def classify_error(error: Exception) -> tuple[str, str]:
    """A short code the page can explain, and the technical detail."""
    if isinstance(error, HTTPException):
        detail = str(error.detail)
        if isinstance(error.__cause__, httpx.TimeoutException):
            return "timeout", detail
        if error.status_code == 503:
            return "unavailable", detail
        if error.status_code == 502:
            return "unusable", detail
        return "internal", detail
    if isinstance(error, TranscriptMissingError):
        return "transcript_missing", "The audio has no transcript."
    if isinstance(error, TranscriptChangedError):
        return "transcript_changed", "The transcript kept changing while it was processed."
    if isinstance(error, UnsupportedLanguageError):
        return "unsupported_language", str(error)
    if isinstance(error, NllbUnavailableError):
        return "engine_unavailable", str(error)
    return "internal", str(error) or type(error).__name__


def task_info(task: Optional[dict]) -> Optional[dict]:
    """What the page needs to know about a task."""
    if task is None:
        return None
    return {key: task.get(key) for key in (
        "id", "kind", "status", "progress_done", "progress_total", "queue_position",
        "error_code", "error",
    )}


def task_engine(task: Optional[dict]) -> str:
    """The engine a translation task translates with."""
    engine = ((task or {}).get("params") or {}).get("engine")
    return engine if engine in ENGINES else "llm"


def wake_llm_queue(request) -> None:
    """Tell the worker a task was queued (it also looks every IDLE_POLL_SECONDS)."""
    queue = getattr(request.app.state, "llm_queue", None)
    if queue is not None:
        queue.notify()


class LlmTaskRunner:
    """Runs one task: its summary or its translation."""

    def __init__(self, settings, tasks, job_repo, summary_service, nllb_engine=None):
        self.settings = settings
        self.tasks = tasks
        self.job_repo = job_repo
        self.summary_service = summary_service
        self._nllb_engine = nllb_engine

    @property
    def nllb_engine(self):
        """The NLLB engine, created on first use (the model loads later still)."""
        if self._nllb_engine is None:
            self._nllb_engine = get_nllb_engine(self.settings)
        return self._nllb_engine

    async def _translate(self, job: dict, engine: str, progress) -> None:
        if engine != "nllb":
            await translate(self.settings, self.job_repo, self.summary_service, job, progress)
            return
        language = await transcript_language(self.job_repo, job)
        if language != "pt":
            nllb_code(language)  # an unsupported language fails before any download
            nllb = self.nllb_engine
            if not nllb.loaded:
                # Shown as "preparing": the first use downloads and converts it.
                await progress(0, 0)
                await asyncio.to_thread(nllb.load)
        await translate(
            self.settings, self.job_repo, NllbSegmentTranslator(self.nllb_engine, language),
            job, progress, engine, NLLB_BLOCK_SIZE,
        )

    async def run(self, task: dict) -> None:
        task_id = task["id"]
        job = await self.job_repo.get(task["job_uuid"])
        if job is None:
            await self.tasks.fail(task_id, "internal", "The audio no longer exists.")
            return

        async def progress(done: int, total: int) -> None:
            await self.tasks.set_progress(task_id, done, total)

        try:
            for attempt in range(MAX_RESTARTS):
                try:
                    if task["kind"] == "summary":
                        await progress(0, 1)
                        await summarize(
                            self.settings, self.summary_service, job, task["params"] or {}
                        )
                    else:
                        await self._translate(job, task_engine(task), progress)
                    break
                except TranscriptChangedError:
                    if attempt == MAX_RESTARTS - 1:
                        raise
                    logger.info("Task %s: transcript edited meanwhile, starting over", task_id)
            await self.tasks.finish(task_id)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # pylint: disable=broad-exception-caught
            code, detail = classify_error(e)
            level = logging.ERROR if code == "internal" else logging.WARNING
            logger.log(level, "Task %s (%s) failed: %s", task_id, task["kind"], detail,
                       exc_info=code == "internal")
            await self.tasks.fail(task_id, code, detail)


class LlmTaskQueue:
    """Runs queued summary/translation tasks one at a time in a background task."""

    def __init__(
        self,
        tasks,
        run_task: Callable[[dict], Awaitable[None]],
        idle_seconds: float = IDLE_POLL_SECONDS,
    ):
        self.tasks = tasks
        self.run_task = run_task
        self.idle_seconds = idle_seconds
        self._wake = asyncio.Event()
        self._task: Optional[asyncio.Task] = None
        self._running = False

    def notify(self) -> None:
        """Wake the worker: a task was queued."""
        self._wake.set()

    async def run_next(self) -> bool:
        """Run the next queued task, if any. Returns whether one ran."""
        task = await self.tasks.claim_next()
        if task is None:
            return False
        logger.info("LLM task %s: %s for %s", task["id"], task["kind"], task["job_uuid"])
        await self.run_task(task)
        return True

    async def _worker(self) -> None:
        try:
            requeued = await self.tasks.requeue_interrupted()
            if requeued:
                logger.info("LLM tasks: resuming %d interrupted task(s)", requeued)
        except Exception as e:  # pylint: disable=broad-exception-caught
            logger.error("LLM tasks: could not requeue interrupted tasks: %s", e)

        while self._running:
            self._wake.clear()
            try:
                worked = await self.run_next()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pylint: disable=broad-exception-caught
                logger.error("LLM task queue error: %s", e, exc_info=True)
                worked = False
            if not worked:
                try:
                    await asyncio.wait_for(self._wake.wait(), self.idle_seconds)
                except asyncio.TimeoutError:
                    pass

    def start(self) -> None:
        """Start the worker; call from within the running event loop."""
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._worker())
        logger.info("LLM task queue started")

    async def stop(self) -> None:
        """Stop the worker (a task being run is resumed on restart)."""
        if self._task is None:
            return
        self._running = False
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        logger.info("LLM task queue stopped")
