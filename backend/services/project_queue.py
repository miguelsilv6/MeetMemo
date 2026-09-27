"""
Server-side queue for project audios.

Audios uploaded to a project are processed one at a time, oldest first, with
no browser involved: closing the page does not stop them. The queue lives in
the database (an audio's workflow state), so a restart loses nothing; audios
left mid-step by a restart are put back before that step.
"""
import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

# How long an idle worker waits before looking at the queue again, in case a
# wake-up was missed (uploads normally wake it straight away).
IDLE_POLL_SECONDS = 30


class ProjectQueue:
    """Processes queued project audios sequentially in a background task."""

    def __init__(
        self,
        repo,
        run_job: Callable[[dict], Awaitable[None]],
        idle_seconds: float = IDLE_POLL_SECONDS,
    ):
        """
        Args:
            repo: ProjectRepository (or anything with the same queue methods).
            run_job: Runs every remaining step of one audio.
            idle_seconds: Wait between looks at an empty queue.
        """
        self.repo = repo
        self.run_job = run_job
        self.idle_seconds = idle_seconds
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._running = False
        #: UUID of the audio being processed now, if any.
        self.current_job: str | None = None

    def notify(self) -> None:
        """Wake the worker: new audios are waiting."""
        self._wake.set()

    async def run_next(self) -> bool:
        """
        Process the next queued audio, if any.

        Returns:
            True if an audio was processed (successfully or not).
        """
        job = await self.repo.next_queued_job()
        if job is None:
            return False

        job_uuid = str(job["uuid"])
        logger.info(
            "Project queue: processing %s (%s) from state %s",
            job_uuid, job["file_name"], job["workflow_state"],
        )
        self.current_job = job_uuid
        try:
            await self.run_job(job)
            logger.info("Project queue: %s completed", job_uuid)
        except Exception as e:  # pylint: disable=broad-exception-caught
            # The steps record their own failures; this covers a failure
            # before a step starts, which would otherwise be retried forever.
            logger.error("Project queue: %s failed: %s", job_uuid, e)
            await self.repo.mark_error(job_uuid, str(e) or type(e).__name__)
        finally:
            self.current_job = None
        return True

    async def _worker(self) -> None:
        try:
            requeued = await self.repo.requeue_interrupted()
            if requeued:
                logger.info("Project queue: resuming %d interrupted audio(s)", requeued)
        except Exception as e:  # pylint: disable=broad-exception-caught
            logger.error("Project queue: could not requeue interrupted audios: %s", e)

        while self._running:
            self._wake.clear()
            try:
                worked = await self.run_next()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pylint: disable=broad-exception-caught
                logger.error("Project queue error: %s", e, exc_info=True)
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
        logger.info("Project queue started")

    async def stop(self) -> None:
        """Stop the worker, interrupting the current audio (it resumes on restart)."""
        if self._task is None:
            return
        self._running = False
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        logger.info("Project queue stopped")
