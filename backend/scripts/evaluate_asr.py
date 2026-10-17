"""
Evaluate transcription reliability on a benchmark folder.

Every audio in the folder is transcribed with the same preprocessing, model and
settings as the pipeline (the admin-panel settings, unless overridden), and
scored against ``<name>.txt`` (reference transcript) and ``<name>.lang``
(expected language code) when they exist. See docs/EVALUATION.md.

Run inside the backend container, ideally while it is idle:

    docker cp ./benchmark meetmemo-backend:/app/benchmark
    docker exec meetmemo-backend python scripts/evaluate_asr.py /app/benchmark
    docker cp meetmemo-backend:/app/benchmark/results ./results
"""
import argparse
import asyncio
import logging
import os
import platform
import sys
import tempfile
import time
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

# Run as a plain script from the backend folder: make its modules importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# pylint: disable=wrong-import-position
from config import get_settings  # noqa: E402
from runtime_settings import (  # noqa: E402
    RuntimeSettings,
    allowed_whisper_models,
    resolve_language,
)
from utils.asr_audio import prepare_asr_audio  # noqa: E402
from utils.asr_evaluation import (  # noqa: E402
    Sample,
    discover_samples,
    evaluate_sample,
    render_csv,
    render_markdown,
    summarize,
)

logger = logging.getLogger("evaluate_asr")


def parse_args(argv=None) -> argparse.Namespace:
    """Command-line options."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", maxsplit=1)[0])
    parser.add_argument("folder", type=Path, help="Folder with the audios, .txt and .lang files")
    parser.add_argument("--model", help="Whisper model to use instead of the panel's")
    parser.add_argument(
        "--language",
        help="Force this language code (or 'auto') instead of the panel's default",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="Folder for the report (default: <folder>/results/<date-time>)",
    )
    parser.add_argument(
        "--defaults",
        action="store_true",
        help="Ignore the panel settings saved in the database; use the defaults",
    )
    return parser.parse_args(argv)


async def load_runtime(settings, use_database: bool) -> RuntimeSettings:
    """The admin-panel settings, or the defaults if the database is not reachable."""
    # pylint: disable=import-outside-toplevel
    from services.runtime_settings_service import RuntimeSettingsService

    service = RuntimeSettingsService(settings)
    if not use_database:
        return service.defaults()
    import database

    try:
        await database.init_database()
        return await service.get()
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.warning("Panel settings unavailable (%s); using the defaults", e)
        return service.defaults()
    finally:
        await database.close_database()


def package_version(name: str) -> str:
    """Installed version of a package, for the report."""
    try:
        return version(name)
    except PackageNotFoundError:
        return "not installed"


def main(argv=None) -> int:  # pylint: disable=too-many-locals
    """Run the evaluation and write the report."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(argv)
    folder = args.folder.resolve()
    samples = discover_samples(folder)
    if not samples:
        logger.error("No audio files in %s", folder)
        return 2

    settings = get_settings()
    runtime = asyncio.run(load_runtime(settings, use_database=not args.defaults))
    model_name = args.model or runtime.whisper_model_name
    if model_name not in allowed_whisper_models(settings.whisper_model_name):
        logger.error("Unsupported model: %s", model_name)
        return 2
    language = resolve_language(args.language, runtime.default_language)

    # pylint: disable=import-outside-toplevel
    from repositories.job_repository import JobRepository
    from services.transcription_service import TranscriptionService

    service = TranscriptionService(settings, JobRepository())
    started = time.perf_counter()
    service.get_model(model_name)
    load_seconds = time.perf_counter() - started

    with tempfile.TemporaryDirectory(prefix="meetmemo-eval-") as tmp:

        def transcribe(sample: Sample) -> dict:
            # The same 16 kHz derivative the pipeline transcribes.
            asr_path = os.path.join(tmp, "asr.wav")
            prepare_asr_audio(
                str(sample.audio_path), asr_path, runtime.audio_highpass, runtime.audio_loudnorm
            )
            return service.transcribe_file(asr_path, model_name, language, runtime)

        results = []
        for index, sample in enumerate(samples, start=1):
            logger.info("[%d/%d] %s", index, len(samples), sample.name)
            results.append(evaluate_sample(sample, transcribe))

    summary = summarize(results)
    context = {
        "Date": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "Folder": str(folder),
        "Model": f"{model_name} ({settings.compute_type} on {settings.device}, "
                 f"loaded in {load_seconds:.1f}s)",
        "Language": language or "auto-detect",
        "Settings": "panel" if not args.defaults else "defaults",
        "Decoding": f"beam {runtime.beam_size}, temperature fallback "
                    f"{'on' if runtime.temperature_fallback else 'off'}, VAD "
                    f"{'on' if runtime.vad_filter else 'off'}",
        "Audio": f"high-pass {'on' if runtime.audio_highpass else 'off'}, loudnorm "
                 f"{'on' if runtime.audio_loudnorm else 'off'}",
        "Versions": f"faster-whisper {package_version('faster-whisper')}, "
                    f"ctranslate2 {package_version('ctranslate2')}, Python "
                    f"{platform.python_version()}",
        "Host": f"{platform.machine()}, {os.cpu_count()} CPUs",
    }

    out = args.out or folder / "results" / datetime.now().strftime("%Y%m%d-%H%M%S")
    (out / "transcripts").mkdir(parents=True, exist_ok=True)
    (out / "report.md").write_text(render_markdown(results, summary, context), encoding="utf-8")
    (out / "results.csv").write_text(render_csv(results), encoding="utf-8")
    for result in results:
        (out / "transcripts" / f"{Path(result.name).stem}.txt").write_text(
            result.hypothesis + "\n", encoding="utf-8"
        )
    logger.info("Report written to %s", out)
    print(render_markdown(results, summary, context))
    return 1 if summary["failed"] == summary["files"] else 0


if __name__ == "__main__":
    sys.exit(main())
