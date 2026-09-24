"""
ASR-optimized audio derivative.

Transcription and diarization run on a separate copy of each upload that is
resampled to 16 kHz mono, high-pass filtered and loudness-normalized. Phone
recordings are often quiet, narrowband (8 kHz) and stereo or mu-law/A-law
encoded; a quiet recording in particular makes Whisper classify whole windows
as "no speech" and drop them, or hallucinate text over them. The original
upload is never modified, so playback and any evidential copy stay intact.

No denoising is applied on purpose: its artifacts tend to increase Whisper
hallucinations rather than reduce them.
"""
import os
import subprocess

ASR_SUBDIR = "asr"

# 80 Hz high-pass removes mains hum/rumble below the speech band; loudnorm
# (EBU R128) lifts quiet recordings to a consistent speech level.
ASR_AUDIO_FILTER = "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11"


def asr_audio_path(upload_dir: str, job_uuid: str) -> str:
    """Path of a job's ASR derivative, keyed by UUID so renames never break it."""
    return os.path.join(upload_dir, ASR_SUBDIR, f"{job_uuid}.wav")


def build_asr_ffmpeg_command(input_path: str, output_path: str) -> list[str]:
    """ffmpeg arguments that produce the 16 kHz mono, normalized derivative."""
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", input_path,
        "-vn",
        "-af", ASR_AUDIO_FILTER,
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        output_path,
    ]


def prepare_asr_audio(input_path: str, output_path: str) -> None:
    """
    Write the ASR derivative of ``input_path`` to ``output_path``.

    Writes to a temporary file first and renames it into place, so a
    concurrent reader never sees a half-written file.

    Raises:
        subprocess.CalledProcessError: If ffmpeg fails.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    tmp_path = f"{output_path}.tmp.wav"
    try:
        subprocess.run(
            build_asr_ffmpeg_command(input_path, tmp_path),
            check=True,
            capture_output=True,
        )
        os.replace(tmp_path, output_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
