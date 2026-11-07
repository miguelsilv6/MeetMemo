"""
How long processing and AI tasks still take, estimated from this server's own
timings (they depend on the hardware and on the models chosen in the admin
panel, so nothing else would do).

Each processing step's speed is the median, over its latest runs with the
same model, of the seconds it took per second of audio (see
``database.update_workflow_state``, which records them). An audio still to
process takes that speed times its length for each step it has left. The
step under way counts what it has left: the transcription by its own pace
once it is under way (its progress follows the audio), the other steps by
their expected time less the time already spent.

AI tasks take the median time of their latest runs of the same kind (and
translation engine); a translation under way goes by its own pace.

Without the timings an estimate needs, there is none (None): the page says
it is still being worked out.
"""
from datetime import datetime, timedelta
from typing import Optional

from database import get_db

# Latest runs each speed is the median of.
HISTORY = 20
# The steps an audio has left, by its workflow state.
STEPS_LEFT = {
    "uploaded": ("transcribing", "diarizing", "aligning"),
    "transcribing": ("transcribing", "diarizing", "aligning"),
    "transcribed": ("diarizing", "aligning"),
    "diarizing": ("diarizing", "aligning"),
    "diarized": ("aligning",),
    "aligning": ("aligning",),
}
# The transcription's progress runs between these (see transcription_service).
TRANSCRIPTION_PROGRESS = (10, 90)
# Share of the audio transcribed before the transcription's own pace is trusted.
MIN_TRANSCRIBED = 0.05


async def load_step_rates() -> dict[tuple[str, str], float]:
    """Each step and model's median seconds of processing per second of audio."""
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT step, model,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds / audio_seconds)
                          AS rate
               FROM (SELECT step, model, seconds, audio_seconds,
                            row_number() OVER (PARTITION BY step, model
                                               ORDER BY finished_at DESC, id DESC) AS n
                     FROM step_timings) latest
               WHERE n <= $1
               GROUP BY step, model""",
            HISTORY,
        )
    return {(row["step"], row["model"]): row["rate"] for row in rows}


def step_model(step: str, job: dict, runtime) -> str:
    """What runs (or will run) a step of an audio, which its speed is kept by."""
    if job.get("workflow_state") == step and job.get("step_model") is not None:
        return job["step_model"]
    if step == "transcribing":
        return job.get("model_name") or runtime.whisper_model_name
    if step == "diarizing":
        return "split" if job.get("channel_mode") == "split" else runtime.diarization_model
    return ""


def _transcribed_share(progress: Optional[int]) -> float:
    start, end = TRANSCRIPTION_PROGRESS
    return min(max(((progress or 0) - start) / (end - start), 0.0), 1.0)


def job_remaining(
    job: dict, rates: dict[tuple[str, str], float], runtime, now: datetime
) -> Optional[float]:
    """Seconds an audio still takes to process, or None when it cannot be told."""
    steps = STEPS_LEFT.get(job.get("workflow_state"))
    if steps is None:
        return None
    length = job.get("audio_seconds")
    total = 0.0
    for step in steps:
        rate = rates.get((step, step_model(step, job, runtime)))
        expected = rate * length if rate is not None and length else None
        if step != job["workflow_state"]:
            if expected is None:
                return None
            total += expected
            continue
        started = job.get("step_started_at")
        elapsed = max((now - started).total_seconds(), 0.0) if started else 0.0
        if step == "transcribing":
            done = _transcribed_share(job.get("current_step_progress"))
            if done >= MIN_TRANSCRIBED and elapsed > 0:
                total += elapsed * (1 - done) / done
                continue
        if expected is None:
            return None
        total += max(expected - elapsed, 0.0)
    return total


def queue_remaining(
    current: Optional[dict],
    queued: list[dict],
    rates: dict[tuple[str, str], float],
    runtime,
    now: datetime,
) -> dict[str, Optional[float]]:
    """
    Seconds until each audio of a queue (``queued``, next first) is processed:
    what the one being processed (``current``) has left, then each audio ahead.
    """
    waiting: Optional[float] = 0.0
    if current is not None:
        waiting = job_remaining(current, rates, runtime, now)
    result: dict[str, Optional[float]] = {}
    for job in queued:
        own = job_remaining(job, rates, runtime, now)
        waiting = None if waiting is None or own is None else waiting + own
        result[str(job["uuid"])] = waiting
    return result


async def load_task_durations() -> dict[tuple[str, str], float]:
    """Each AI task kind (and translation engine)'s median seconds over its latest runs."""
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT kind, engine,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS seconds
               FROM (SELECT kind, engine, seconds,
                            row_number() OVER (PARTITION BY kind, engine
                                               ORDER BY finished_at DESC, id DESC) AS n
                     FROM (SELECT id, kind, finished_at,
                                  CASE WHEN kind = 'translation'
                                       THEN COALESCE(params->>'engine', 'llm')
                                       ELSE '' END AS engine,
                                  EXTRACT(EPOCH FROM finished_at - started_at) AS seconds
                           FROM llm_tasks
                           WHERE status = 'done' AND started_at IS NOT NULL
                             AND finished_at IS NOT NULL) runs) latest
               WHERE n <= $1
               GROUP BY kind, engine""",
            HISTORY,
        )
    return {(row["kind"], row["engine"]): float(row["seconds"]) for row in rows}


def _task_key(task: dict) -> tuple[str, str]:
    if task.get("kind") != "translation":
        return task.get("kind"), ""
    engine = (task.get("params") or {}).get("engine")
    return "translation", engine if engine in ("llm", "nllb") else "llm"


def task_remaining(
    task: dict, durations: dict[tuple[str, str], float], now: datetime
) -> Optional[float]:
    """Seconds an AI task still takes (queued: all of it), or None when it cannot be told."""
    expected = durations.get(_task_key(task))
    if task.get("status") != "running":
        return expected
    started = task.get("started_at")
    elapsed = max((now - started).total_seconds(), 0.0) if started else 0.0
    done, total = task.get("progress_done") or 0, task.get("progress_total") or 0
    if task.get("kind") == "translation" and 0 < done < total and elapsed > 0:
        return elapsed * (total - done) / done
    return None if expected is None else max(expected - elapsed, 0.0)


def task_eta(
    task: dict,
    active: list[dict],
    durations: dict[tuple[str, str], float],
    now: datetime,
) -> Optional[float]:
    """
    Seconds until an AI task is done: a running one, what it has left; a
    queued one, what the running tasks and those queued ahead of it (in
    ``active``) have left, then itself.
    """
    if task.get("status") == "running":
        return task_remaining(task, durations, now)
    if task.get("status") != "queued":
        return None
    total = 0.0
    for other in active:
        ahead = other["status"] == "running" or (
            other["status"] == "queued" and other["id"] < task["id"]
        )
        if ahead or other["id"] == task["id"]:
            left = task_remaining(other, durations, now)
            if left is None:
                return None
            total += left
    return total


def eta_fields(seconds: Optional[float], now: datetime) -> dict:
    """The estimate as the page shows it: seconds left and when it is done (or None)."""
    if seconds is None:
        return {"eta_seconds": None, "eta_at": None}
    return {"eta_seconds": round(seconds), "eta_at": now + timedelta(seconds=seconds)}
