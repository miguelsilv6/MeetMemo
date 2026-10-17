"""
ASR-optimized audio derivative.

Transcription and diarization run on a separate copy of each upload that is
resampled to 16 kHz mono and, unless disabled in the admin panel, high-pass
filtered and loudness-normalized. Phone recordings are often quiet,
narrowband (8 kHz) and stereo or mu-law/A-law encoded; a quiet recording in
particular makes Whisper classify whole windows
as "no speech" and drop them, or hallucinate text over them. The original
upload is never modified, so playback and any evidential copy stay intact.

No denoising is applied on purpose: its artifacts tend to increase Whisper
hallucinations rather than reduce them.
"""
import json
import os
import subprocess

ASR_SUBDIR = "asr"

# 80 Hz high-pass removes mains hum/rumble below the speech band; loudnorm
# (EBU R128) lifts quiet recordings to a consistent speech level.
HIGHPASS_FILTER = "highpass=f=80"
LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"


def asr_audio_filter(highpass: bool = True, loudnorm: bool = True) -> str | None:
    """The ffmpeg -af chain for the enabled steps, or None if none are."""
    steps = [f for f, enabled in ((HIGHPASS_FILTER, highpass), (LOUDNORM_FILTER, loudnorm)) if enabled]
    return ",".join(steps) or None


def asr_audio_path(upload_dir: str, job_uuid: str) -> str:
    """Path of a job's ASR derivative, keyed by UUID so renames never break it."""
    return os.path.join(upload_dir, ASR_SUBDIR, f"{job_uuid}.wav")


def build_asr_ffmpeg_command(
    input_path: str, output_path: str, highpass: bool = True, loudnorm: bool = True
) -> list[str]:
    """ffmpeg arguments that produce the 16 kHz mono (optionally filtered) derivative."""
    audio_filter = asr_audio_filter(highpass, loudnorm)
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", input_path,
        "-vn",
        *(["-af", audio_filter] if audio_filter else []),
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        output_path,
    ]


def prepare_asr_audio(
    input_path: str, output_path: str, highpass: bool = True, loudnorm: bool = True
) -> None:
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
            build_asr_ffmpeg_command(input_path, tmp_path, highpass, loudnorm),
            check=True,
            capture_output=True,
        )
        os.replace(tmp_path, output_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


# --- One derivative per channel (stereo calls with one speaker per channel) --

CHANNELS = 2
# The channels are compared on a light copy: 8 kHz, every 4th frame read.
PROBE_RATE = 8000
PROBE_STEP = 4


def channel_asr_path(upload_dir: str, job_uuid: str, channel: int) -> str:
    """Path of one channel's ASR derivative."""
    return os.path.join(upload_dir, ASR_SUBDIR, f"{job_uuid}.ch{channel}.wav")


def channel_analysis_path(upload_dir: str, job_uuid: str) -> str:
    """Path of the saved decision on how to transcribe the job's channels."""
    return os.path.join(upload_dir, ASR_SUBDIR, f"{job_uuid}.channels.json")


def build_probe_command(input_path: str, output_path: str) -> list[str]:
    """ffmpeg arguments for the two-channel copy the channels are compared on.

    A mono input comes out as two identical channels, which reads as mono.
    """
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", input_path, "-vn",
        "-ac", str(CHANNELS), "-ar", str(PROBE_RATE), "-c:a", "pcm_s16le",
        output_path,
    ]


def build_channel_asr_command(
    input_path: str, output_paths: list[str], highpass: bool = True, loudnorm: bool = True
) -> list[str]:
    """ffmpeg arguments for one 16 kHz mono derivative per channel.

    Each channel is filtered on its own, so loudness normalization lifts a
    quiet side instead of leaving it under the louder one.
    """
    audio_filter = asr_audio_filter(highpass, loudnorm)
    branches = [
        f"[s{n}]pan=mono|c0=c{n}" + (f",{audio_filter}" if audio_filter else "") + f"[o{n}]"
        for n in range(len(output_paths))
    ]
    split = "".join(f"[s{n}]" for n in range(len(output_paths)))
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", input_path, "-vn",
        "-filter_complex", f"[0:a]asplit={len(output_paths)}{split};" + ";".join(branches),
    ]
    for n, output_path in enumerate(output_paths):
        command += ["-map", f"[o{n}]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    output_path]
    return command


def prepare_channel_asr_audio(
    input_path: str,
    output_paths: list[str],
    analysis_path: str,
    highpass: bool = True,
    loudnorm: bool = True,
) -> dict:
    """
    Decide whether ``input_path`` has one speaker per channel and, if so,
    write one ASR derivative per channel to ``output_paths``.

    The decision (``utils.channels.analyze_channels``) is saved as JSON at
    ``analysis_path`` and returned, with ``"paths"`` when the channels are
    to be transcribed separately.

    Raises:
        subprocess.CalledProcessError: If ffmpeg fails.
    """
    # Imported here so the mono path does not need numpy loaded.
    # pylint: disable=import-outside-toplevel
    from utils.channels import analyze_channels, read_wav_samples

    os.makedirs(os.path.dirname(analysis_path), exist_ok=True)
    probe = f"{analysis_path}.probe.wav"
    try:
        subprocess.run(build_probe_command(input_path, probe), check=True, capture_output=True)
        analysis = analyze_channels(read_wav_samples(probe, PROBE_STEP))
    finally:
        if os.path.exists(probe):
            os.remove(probe)

    if analysis["mode"] == "split":
        tmp_paths = [f"{path}.tmp.wav" for path in output_paths]
        try:
            subprocess.run(
                build_channel_asr_command(input_path, tmp_paths, highpass, loudnorm),
                check=True,
                capture_output=True,
            )
            for tmp, path in zip(tmp_paths, output_paths):
                os.replace(tmp, path)
        finally:
            for tmp in tmp_paths:
                if os.path.exists(tmp):
                    os.remove(tmp)
        analysis["paths"] = list(output_paths)

    tmp_json = f"{analysis_path}.tmp"
    with open(tmp_json, "w", encoding="utf-8") as f:
        json.dump(analysis, f)
    os.replace(tmp_json, analysis_path)
    return analysis
